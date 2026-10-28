import { EmailError, type EmailMessage } from '@hexok/email';
import { describe, expect, it } from 'vitest';
import type { LogSink } from './log-sink.js';
import { MailgunEmailSender, type MailgunLike } from './mailgun-email.js';
import type { ParkInput } from './park.js';

const message: EmailMessage = {
  to: ['person@example.com'],
  from: { email: 'from@example.com' },
  subject: 'Hello',
  text: 'body',
  idempotencyKey: 'key-1',
  tags: { env: 'test', idempotencyKey: 'nope' },
};

const address = 'user@example.com';
const code = '482913';
const providerText = `Cannot send to ${address}: Your code is ${code}`;

const secret: EmailMessage = {
  to: [address],
  bcc: ['audit@example.com'],
  from: { email: 'from@example.com' },
  subject: `Your code is ${code}`,
  text: `Your code is ${code}`,
  attachments: [
    { data: Buffer.from('x'), filename: 'a.txt', contentType: 'text/plain' },
  ],
  idempotencyKey: 'key-otp',
  sensitive: true,
};

function spyLogger(): LogSink & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    debug: (...args) => calls.push(['debug', ...args]),
    info: (...args) => calls.push(['info', ...args]),
    warn: (...args) => calls.push(['warn', ...args]),
    error: (...args) => calls.push(['error', ...args]),
  };
}

/** `JSON.stringify(new Error())` is `{}`, so errors and their causes are expanded. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field instanceof Error
      ? {
          ...field,
          name: field.name,
          message: field.message,
          stack: field.stack,
          cause: field.cause,
        }
      : field,
  );
}

function failing(status: number): MailgunLike {
  return {
    messages: {
      async create() {
        throw Object.assign(new Error(providerText), { status });
      },
    },
  };
}

describe('MailgunEmailSender', () => {
  it('sets testmode only in sandbox and stores idempotency as a variable', async () => {
    const calls: unknown[] = [];
    const client: MailgunLike = {
      messages: {
        async create(domain, data) {
          calls.push({ domain, data });
          return { id: '<1>' };
        },
      },
    };
    const live = new MailgunEmailSender({ client, domain: 'mg.example' });
    await live.send(message);
    const sandbox = new MailgunEmailSender({
      client,
      domain: 'mg.example',
      sandbox: true,
    });
    await sandbox.send(message);
    expect(calls).toHaveLength(2);
    const first = calls[0] as { data: Record<string, unknown> };
    const second = calls[1] as { data: Record<string, unknown> };
    expect(first.data['o:testmode']).toBeUndefined();
    expect(second.data['o:testmode']).toBe('yes');
    expect(first.data['v:idempotencyKey']).toBe('key-1');
    expect(first.data['v:env']).toBe('test');
    expect(first.data['v:idempotencyKey']).not.toBe('nope');
  });

  it('does not retry and maps status codes', async () => {
    let calls = 0;
    const client: MailgunLike = {
      messages: {
        async create() {
          calls += 1;
          throw { status: 400, message: 'bad' };
        },
      },
    };
    const sender = new MailgunEmailSender({ client, domain: 'mg.example' });
    await expect(sender.send(message)).rejects.toMatchObject({
      code: 'Rejected',
    });
    expect(calls).toBe(1);
    expect(
      EmailError.is(await sender.send(message).catch((error) => error)),
    ).toBe(true);
  });

  it('parks unavailable and rate limited sends and skips a rejection', async () => {
    const parked: ParkInput[] = [];
    const quarantine = {
      async park(input: ParkInput) {
        parked.push(input);
        return { id: 'q1' };
      },
    };
    const cases: Array<[unknown, string]> = [
      [{ status: 500, message: 'down' }, 'Unavailable'],
      [{ status: 429, message: 'slow' }, 'RateLimited'],
      [{ status: 400, message: 'bad' }, 'Rejected'],
    ];
    for (const [thrown, code] of cases) {
      const sender = new MailgunEmailSender({
        client: {
          messages: {
            async create() {
              throw thrown;
            },
          },
        },
        domain: 'mg.example',
        quarantine,
      });
      await expect(sender.send(message)).rejects.toMatchObject({ code });
    }
    expect(parked.map((item) => item.error.code)).toEqual([
      'Unavailable',
      'RateLimited',
    ]);
    expect(parked[0]?.subject).toBe('key-1');
    expect(parked[0]?.context).toEqual({ adapter: 'mailgun' });
  });

  it('keeps provider text and a sensitive message out of logs, errors, and quarantine', async () => {
    const cases: Array<[number, string]> = [
      [503, 'Unavailable'],
      [429, 'RateLimited'],
      [400, 'Rejected'],
    ];
    for (const [status, expected] of cases) {
      const logger = spyLogger();
      const parked: ParkInput[] = [];
      const sender = new MailgunEmailSender({
        client: failing(status),
        domain: 'mg.example',
        logger,
        quarantine: {
          async park(input) {
            parked.push(input);
            return { id: 'q1' };
          },
        },
      });
      const thrown = await sender.send(secret).catch((error) => error);
      expect(thrown).toMatchObject({ code: expected });
      expect(logger.calls).toEqual([
        ['error', 'email: mailgun send failed', { status, attempt: 1 }],
      ]);
      if (expected === 'Rejected') {
        expect(thrown.message).toBe('Email was rejected');
        expect(parked).toHaveLength(0);
      } else {
        expect(parked).toHaveLength(1);
        expect(parked[0]).toMatchObject({
          subject: 'key-otp',
          error: { code: expected, catalog: 'email' },
          context: { adapter: 'mailgun' },
        });
        expect(parked[0]?.payload).toEqual({
          sensitive: true,
          recipientCount: 2,
          attachmentCount: 1,
        });
      }
      for (const leaked of [address, code]) {
        expect(serialize(logger.calls)).not.toContain(leaked);
        expect(serialize(thrown)).not.toContain(leaked);
        expect(serialize(parked)).not.toContain(leaked);
      }
    }
  });

  it('rejects a message that is not sensitive with the default message', async () => {
    const logger = spyLogger();
    const thrown = await new MailgunEmailSender({
      client: failing(400),
      domain: 'mg.example',
      logger,
    })
      .send(message)
      .catch((error) => error);
    expect(thrown).toMatchObject({
      code: 'Rejected',
      message: 'Email was rejected',
    });
    for (const leaked of [address, code]) {
      expect(serialize(logger.calls)).not.toContain(leaked);
      expect(serialize(thrown)).not.toContain(leaked);
    }
  });

  it('exposes provider text only for a message that is not sensitive', async () => {
    const logger = spyLogger();
    const sender = new MailgunEmailSender({
      client: failing(400),
      domain: 'mg.example',
      logger,
      exposeProviderErrors: true,
    });
    await expect(sender.send(message)).rejects.toMatchObject({
      code: 'Rejected',
      message: providerText,
    });
    expect(serialize(logger.calls)).toContain(providerText);
    expect(logger.calls[0]?.[2]).toEqual({ status: 400, attempt: 1 });

    const quiet = spyLogger();
    const thrown = await new MailgunEmailSender({
      client: failing(400),
      domain: 'mg.example',
      logger: quiet,
      exposeProviderErrors: true,
    })
      .send(secret)
      .catch((error) => error);
    expect(thrown).toMatchObject({
      code: 'Rejected',
      message: 'Email was rejected',
    });
    for (const leaked of [address, code]) {
      expect(serialize(quiet.calls)).not.toContain(leaked);
      expect(serialize(thrown)).not.toContain(leaked);
    }
  });

  it('logs only the error name when park fails', async () => {
    const quoting = {
      async park(): Promise<{ id: string }> {
        throw new Error(`Cannot park ${address}: Your code is ${code}`, {
          cause: new Error(`Duplicate row for ${address}`),
        });
      },
    };
    const plain: EmailMessage = { ...secret, sensitive: false };
    const cases: Array<[EmailMessage, boolean, boolean]> = [
      [plain, false, false],
      [secret, false, false],
      [secret, true, false],
      [plain, true, true],
    ];
    for (const [message, exposeProviderErrors, exposed] of cases) {
      const logger = spyLogger();
      const sender = new MailgunEmailSender({
        client: failing(503),
        domain: 'mg.example',
        logger,
        quarantine: quoting,
        exposeProviderErrors,
      });
      await expect(sender.send(message)).rejects.toMatchObject({
        code: 'Unavailable',
      });
      if (exposed) {
        expect(serialize(logger.calls)).toContain(
          `Duplicate row for ${address}`,
        );
        expect(serialize(logger.calls)).toContain(code);
        continue;
      }
      expect(logger.calls).toContainEqual([
        'error',
        'quarantine: park failed',
        { name: 'Error' },
      ]);
      for (const leaked of [address, code]) {
        expect(serialize(logger.calls)).not.toContain(leaked);
      }
    }
  });
});
