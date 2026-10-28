import { SmsError } from '@hexok/sms';
import twilio from 'twilio';
import { describe, expect, it } from 'vitest';
import type { LogSink } from './log-sink.js';
import type { ParkInput, ParkSink } from './park.js';
import {
  type TwilioLike,
  TwilioSmsSender,
  type TwilioSmsSenderConfig,
} from './twilio-sms.js';

function sender(create: TwilioLike['messages']['create']): TwilioSmsSender {
  return new TwilioSmsSender({
    from: '+100',
    client: { messages: { create } },
  });
}

describe('TwilioSmsSender', () => {
  it('sends one recipient from adapter config', async () => {
    let body: unknown;
    const result = await sender(async (input) => {
      body = input;
      return { sid: 'SM1', dateCreated: null };
    }).send({ to: '+1555', body: 'hi' });
    expect(body).toEqual({ to: '+1555', from: '+100', body: 'hi' });
    expect(result.id).toBe('SM1');
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('maps Twilio codes and statuses', async () => {
    const cases: Array<[unknown, string]> = [
      [{ code: 21610 }, 'Unsubscribed'],
      [{ code: 21608 }, 'InvalidRecipient'],
      [{ code: 21211 }, 'InvalidRecipient'],
      [{ code: 21614 }, 'InvalidRecipient'],
      [{ code: 20429 }, 'RateLimited'],
      [{ status: 429 }, 'RateLimited'],
      [{ status: 500 }, 'Unavailable'],
      [{ message: 'down' }, 'Unavailable'],
      [{ status: 400, message: 'no' }, 'Rejected'],
    ];
    for (const [thrown, code] of cases) {
      const error = await sender(async () => {
        throw thrown;
      })
        .send({ to: '+1', body: 'x' })
        .catch((caught) => caught);
      expect(SmsError.is(error)).toBe(true);
      if (!SmsError.is(error)) continue;
      expect(error.code).toBe(code);
      if (code === 'RateLimited' || code === 'Unavailable') {
        expect(error.data).toEqual({ retryAfterMs: 30000 });
      }
    }
  });

  it('parks rate limits and outages and skips an unsubscribe', async () => {
    const parked: ParkInput[] = [];
    const quarantine = {
      async park(input: ParkInput) {
        parked.push(input);
        return { id: 'q1' };
      },
    };
    const cases: Array<[unknown, string, boolean]> = [
      [{ status: 500 }, 'Unavailable', true],
      [{ code: 20429 }, 'RateLimited', true],
      [{ code: 21610 }, 'Unsubscribed', false],
    ];
    for (const [thrown, code, parkedOnce] of cases) {
      const before = parked.length;
      const error = await new TwilioSmsSender({
        from: '+100',
        client: {
          messages: {
            async create() {
              throw thrown;
            },
          },
        },
        quarantine,
      })
        .send({ to: '+1555', body: 'hi' })
        .catch((caught) => caught);
      expect(SmsError.is(error)).toBe(true);
      if (SmsError.is(error)) expect(error.code).toBe(code);
      expect(parked.length).toBe(before + (parkedOnce ? 1 : 0));
    }
    expect(parked[0]?.payload).toEqual({ to: '+1555', body: 'hi' });
    expect(parked[0]?.subject).toBeUndefined();
    expect(parked[0]?.context).toEqual({ adapter: 'twilio' });
  });
});

const destination = '+15551234567';
const otp = '482913';

function providerError(status: number, code: number): Error {
  return Object.assign(
    new Error(
      `The 'To' number ${destination} is not valid. Body: Your code is ${otp}`,
    ),
    { code, status },
  );
}

/**
 * `JSON.stringify(new Error())` is `{}`. This expands `message`, `stack`, and
 * the non-enumerable `cause`, and walks nested causes.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Error) {
      return {
        ...item,
        name: item.name,
        message: item.message,
        stack: item.stack,
        cause: item.cause,
      };
    }
    return item;
  });
}

function spySink(): { sink: LogSink; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([method, ...args]);
    };
  return {
    sink: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
    calls,
  };
}

async function failedSend(
  thrown: Error,
  sensitive: boolean,
  options: Pick<
    TwilioSmsSenderConfig,
    'exposeProviderErrors' | 'quarantine'
  > = {},
): Promise<{ error: unknown; calls: unknown[][]; parked: ParkInput[] }> {
  const { sink, calls } = spySink();
  const parked: ParkInput[] = [];
  const error = await new TwilioSmsSender({
    from: '+100',
    client: {
      messages: {
        async create() {
          throw thrown;
        },
      },
    },
    logger: sink,
    quarantine: {
      async park(input) {
        parked.push(input);
        return { id: 'q1' };
      },
    },
    ...options,
  })
    .send({ to: destination, body: `Your code is ${otp}`, sensitive })
    .catch((caught: unknown) => caught);
  return { error, calls, parked };
}

describe('TwilioSmsSender provider errors', () => {
  const failures: Array<[string, () => Error, string, boolean]> = [
    [
      'an invalid recipient',
      () => providerError(400, 21211),
      'InvalidRecipient',
      false,
    ],
    ['an outage', () => providerError(503, 20500), 'Unavailable', true],
    ['a rejection', () => providerError(400, 21617), 'Rejected', false],
  ];

  for (const sensitive of [false, true]) {
    for (const [name, thrown, code, parks] of failures) {
      it(`keeps the number and code out of ${name} (sensitive: ${sensitive})`, async () => {
        const { error, calls, parked } = await failedSend(thrown(), sensitive);
        expect(SmsError.is(error)).toBe(true);
        if (SmsError.is(error)) expect(error.code).toBe(code);
        expect(parked.length).toBe(parks ? 1 : 0);
        // A non-sensitive message parks `to` and `body` on purpose.
        const stored = sensitive
          ? parked
          : parked.map(({ payload: _payload, ...rest }) => rest);
        for (const leaked of [
          serialize(calls),
          serialize(error),
          serialize(stored),
        ]) {
          expect(leaked).not.toContain(destination);
          expect(leaked).not.toContain(otp);
        }
      });
    }
  }

  it('logs code, status, and attempt', async () => {
    const { calls } = await failedSend(providerError(400, 21211), false);
    expect(calls).toEqual([
      [
        'error',
        'sms: twilio send failed',
        { code: 21211, status: 400, attempt: 1 },
      ],
    ]);
  });

  it('rejects with the catalog message', async () => {
    const { error } = await failedSend(providerError(400, 21617), false);
    expect(SmsError.is(error)).toBe(true);
    if (SmsError.is(error)) {
      expect(error.code).toBe('Rejected');
      expect(error.message).toBe('Message was rejected');
    }
  });

  it('parks a sensitive message without to or body', async () => {
    const { parked } = await failedSend(providerError(503, 20500), true);
    expect(parked.length).toBe(1);
    expect(parked[0]?.payload).toEqual({
      sensitive: true,
      bodyLength: `Your code is ${otp}`.length,
    });
    expect(parked[0]?.error).toEqual({
      name: 'sms.Unavailable',
      message: 'SMS provider is unavailable',
      code: 'Unavailable',
      catalog: 'sms',
    });
    expect(parked[0]?.context).toEqual({ adapter: 'twilio' });
    expect(parked[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('logs the raw error with exposeProviderErrors', async () => {
    const thrown = providerError(400, 21617);
    const { error, calls } = await failedSend(thrown, false, {
      exposeProviderErrors: true,
    });
    expect(calls).toEqual([
      ['error', thrown, { code: 21617, status: 400, attempt: 1 }],
    ]);
    expect(SmsError.is(error)).toBe(true);
    if (SmsError.is(error)) expect(error.message).toBe(thrown.message);
  });

  it('keeps a sensitive message redacted with exposeProviderErrors', async () => {
    for (const [, thrown] of failures) {
      const { error, calls, parked } = await failedSend(thrown(), true, {
        exposeProviderErrors: true,
      });
      for (const leaked of [
        serialize(calls),
        serialize(error),
        serialize(parked),
      ]) {
        expect(leaked).not.toContain(destination);
        expect(leaked).not.toContain(otp);
      }
    }
  });
});

function failingSink(thrown: unknown): ParkSink {
  return {
    async park() {
      throw thrown;
    },
  };
}

function quotedInput(): Error {
  return new Error(
    `park failed {"payload":{"to":"${destination}","body":"Your code is ${otp}"}}`,
  );
}

describe('TwilioSmsSender quarantine failures', () => {
  const failures: Array<[string, () => unknown]> = [
    ['an error that quotes its input', quotedInput],
    [
      'an error whose cause quotes its input',
      () => new Error('park failed', { cause: quotedInput() }),
    ],
    ['a string that quotes its input', () => `${destination} ${otp}`],
  ];

  for (const sensitive of [false, true]) {
    for (const [name, thrown] of failures) {
      it(`keeps ${name} out of the logs (sensitive: ${sensitive})`, async () => {
        const { calls } = await failedSend(
          providerError(500, 20500),
          sensitive,
          {
            quarantine: failingSink(thrown()),
          },
        );
        expect(serialize(calls)).not.toContain(destination);
        expect(serialize(calls)).not.toContain(otp);
      });
    }
  }

  it('logs the park failure name', async () => {
    const cases: Array<[unknown, string]> = [
      [new TypeError(`${destination} ${otp}`), 'TypeError'],
      [`${destination} ${otp}`, 'Error'],
    ];
    for (const [thrown, name] of cases) {
      const { calls } = await failedSend(providerError(500, 20500), false, {
        quarantine: failingSink(thrown),
      });
      expect(calls).toContainEqual([
        'error',
        'quarantine: park failed',
        { name },
      ]);
    }
  });

  it('logs the raw park failure with exposeProviderErrors', async () => {
    const thrown = quotedInput();
    const { calls } = await failedSend(providerError(500, 20500), false, {
      exposeProviderErrors: true,
      quarantine: failingSink(thrown),
    });
    expect(calls).toContainEqual(['error', thrown]);
  });

  it('keeps a sensitive park failure redacted with exposeProviderErrors', async () => {
    for (const [, thrown] of failures) {
      const { calls } = await failedSend(providerError(500, 20500), true, {
        exposeProviderErrors: true,
        quarantine: failingSink(thrown()),
      });
      expect(serialize(calls)).not.toContain(destination);
      expect(serialize(calls)).not.toContain(otp);
    }
  });

  it('accepts the twilio 6 client without a cast', () => {
    const sender = new TwilioSmsSender({
      client: twilio('ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'token'),
      from: '+15550001111',
    });
    expect(sender).toBeInstanceOf(TwilioSmsSender);
  });
});
