import { EmailError, type EmailMessage } from '@hexok/email';
import { Resend } from 'resend';
import { describe, expect, it } from 'vitest';
import type { LogSink } from './log-sink.js';
import type { ParkInput } from './park.js';
import { ResendEmailSender, type ResendLike } from './resend-email.js';
import { retryOptions } from './retry.js';

const base: EmailMessage = {
  to: ['person@example.com'],
  cc: ['cc@example.com'],
  from: { email: 'from@example.com', name: 'From' },
  subject: 'Hello',
  text: 'body',
  idempotencyKey: 'key-1',
  tags: { env: 'test' },
};

const address = 'user@example.com';
const code = '482913';
const providerText = `Cannot send to ${address}: Your code is ${code}`;

const secret: EmailMessage = {
  to: [address],
  cc: ['cc@example.com'],
  from: { email: 'from@example.com' },
  subject: `Your code is ${code}`,
  text: `Your code is ${code}`,
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

function failing(statusCode: number, name: string): ResendLike {
  return {
    emails: {
      async send() {
        return {
          data: null,
          error: { message: providerText, name, statusCode },
        };
      },
    },
  };
}

const noWait = { retries: 1, minTimeout: 0, maxTimeout: 0, randomize: false };

describe('ResendEmailSender', () => {
  it('retries 429 and does not retry 422', async () => {
    let calls = 0;
    const client: ResendLike = {
      emails: {
        async send() {
          calls += 1;
          if (calls < 2) {
            return {
              data: null,
              error: {
                message: 'slow',
                name: 'rate_limit_exceeded',
                statusCode: 429,
              },
            };
          }
          return { data: { id: 'email_1' }, error: null };
        },
      },
    };
    const sender = new ResendEmailSender({
      client,
      retry: retryOptions({ minTimeout: 0, maxTimeout: 0, randomize: false }),
    });
    await expect(sender.send(base)).resolves.toEqual({ id: 'email_1' });
    expect(calls).toBe(2);

    const rejected: ResendLike = {
      emails: {
        async send() {
          return {
            data: null,
            error: {
              message: 'nope',
              name: 'validation_error',
              statusCode: 422,
            },
          };
        },
      },
    };
    const once = new ResendEmailSender({
      client: rejected,
      retry: { retries: 3, minTimeout: 0, maxTimeout: 0, randomize: false },
    });
    await expect(once.send(base)).rejects.toBeInstanceOf(EmailError);
    await expect(once.send(base)).rejects.toMatchObject({ code: 'Rejected' });
  });

  it('rewrites sandbox recipients and keeps from', async () => {
    let payload: unknown;
    let options: unknown;
    const client: ResendLike = {
      emails: {
        async send(body, sendOptions) {
          payload = body;
          options = sendOptions;
          return { data: { id: 'email_2' }, error: null };
        },
      },
    };
    const sender = new ResendEmailSender({
      client,
      sandbox: true,
      retry: { retries: 0, minTimeout: 0, maxTimeout: 0, randomize: false },
    });
    await sender.send(base);
    expect(payload).toMatchObject({
      from: 'From <from@example.com>',
      to: ['delivered@resend.dev'],
      cc: ['delivered@resend.dev'],
      text: 'body',
      tags: [{ name: 'env', value: 'test' }],
    });
    expect(payload).not.toHaveProperty('html');
    expect(options).toEqual({ idempotencyKey: 'key-1' });
  });

  it('sends attachments', async () => {
    let payload: unknown;
    const client: ResendLike = {
      emails: {
        async send(body) {
          payload = body;
          return { data: { id: 'email_3' }, error: null };
        },
      },
    };
    const data = Buffer.from('report');
    await new ResendEmailSender({ client }).send({
      ...base,
      attachments: [
        { data, filename: 'report.txt', contentType: 'text/plain' },
      ],
    });
    expect(payload).toMatchObject({
      attachments: [
        { content: data, filename: 'report.txt', contentType: 'text/plain' },
      ],
    });
  });

  it('parks an exhausted outage once and does not park a rejection', async () => {
    const parked: ParkInput[] = [];
    const quarantine = {
      async park(input: ParkInput) {
        parked.push(input);
        return { id: 'q1' };
      },
    };
    let calls = 0;
    const client: ResendLike = {
      emails: {
        async send() {
          calls += 1;
          return {
            data: null,
            error: {
              message: 'down',
              name: 'internal_server_error',
              statusCode: 500,
            },
          };
        },
      },
    };
    const sender = new ResendEmailSender({
      client,
      quarantine,
      retry: { retries: 1, minTimeout: 0, maxTimeout: 0, randomize: false },
    });
    await expect(
      sender.send({
        ...base,
        attachments: [
          {
            data: Buffer.from('x'),
            filename: 'a.txt',
            contentType: 'text/plain',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'Unavailable' });
    expect(calls).toBe(2);
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({
      source: 'email',
      operation: 'send',
      subject: 'key-1',
      attempts: 2,
      context: { adapter: 'resend' },
      error: { code: 'Unavailable', catalog: 'email' },
    });
    expect(parked[0]?.payload).toMatchObject({
      text: 'body',
      attachmentCount: 1,
    });
    expect(parked[0]?.payload).not.toHaveProperty('attachments');

    const rejected: ResendLike = {
      emails: {
        async send() {
          return {
            data: null,
            error: {
              message: 'nope',
              name: 'validation_error',
              statusCode: 422,
            },
          };
        },
      },
    };
    await expect(
      new ResendEmailSender({
        client: rejected,
        quarantine,
        retry: { retries: 3, minTimeout: 0, maxTimeout: 0, randomize: false },
      }).send(base),
    ).rejects.toMatchObject({ code: 'Rejected' });
    expect(parked).toHaveLength(1);
  });

  it('still throws Unavailable when park throws', async () => {
    const client: ResendLike = {
      emails: {
        async send() {
          return {
            data: null,
            error: {
              message: 'down',
              name: 'internal_server_error',
              statusCode: 500,
            },
          };
        },
      },
    };
    const sender = new ResendEmailSender({
      client,
      quarantine: {
        async park() {
          throw new Error('store down');
        },
      },
      retry: { retries: 0, minTimeout: 0, maxTimeout: 0, randomize: false },
    });
    await expect(sender.send(base)).rejects.toMatchObject({
      code: 'Unavailable',
    });
  });

  it('accepts the resend SDK client without a cast', () => {
    const sender = new ResendEmailSender({ client: new Resend('re_test') });
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it('keeps provider text and a sensitive message out of logs, errors, and quarantine', async () => {
    const cases: Array<[number, string, string]> = [
      [500, 'internal_server_error', 'Unavailable'],
      [429, 'rate_limit_exceeded', 'RateLimited'],
    ];
    for (const [statusCode, name, expected] of cases) {
      const logger = spyLogger();
      const parked: ParkInput[] = [];
      const sender = new ResendEmailSender({
        client: failing(statusCode, name),
        logger,
        quarantine: {
          async park(input) {
            parked.push(input);
            return { id: 'q1' };
          },
        },
        retry: noWait,
      });
      const thrown = await sender.send(secret).catch((error) => error);
      expect(thrown).toMatchObject({ code: expected });
      expect(parked).toHaveLength(1);
      expect(parked[0]).toMatchObject({
        subject: 'key-otp',
        attempts: 2,
        error: { code: expected, catalog: 'email' },
        context: { adapter: 'resend' },
      });
      expect(parked[0]?.payload).toEqual({
        sensitive: true,
        recipientCount: 2,
        attachmentCount: 0,
      });
      expect(logger.calls).toContainEqual([
        'warn',
        'email: resend attempt failed',
        { idempotencyKey: 'key-otp', status: statusCode, attempt: 1 },
      ]);
      for (const leaked of [address, code]) {
        expect(serialize(logger.calls)).not.toContain(leaked);
        expect(serialize(thrown)).not.toContain(leaked);
        expect(serialize(parked)).not.toContain(leaked);
      }
    }
  });

  it('rejects a 4xx with the default message', async () => {
    for (const message of [base, secret]) {
      const logger = spyLogger();
      const thrown = await new ResendEmailSender({
        client: failing(422, 'validation_error'),
        logger,
        retry: noWait,
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
    }
  });

  it('exposes provider text only for a message that is not sensitive', async () => {
    const sender = new ResendEmailSender({
      client: failing(422, 'validation_error'),
      exposeProviderErrors: true,
      retry: noWait,
    });
    await expect(sender.send(base)).rejects.toMatchObject({
      code: 'Rejected',
      message: providerText,
    });
    const thrown = await sender.send(secret).catch((error) => error);
    expect(thrown).toMatchObject({
      code: 'Rejected',
      message: 'Email was rejected',
    });
    expect(serialize(thrown)).not.toContain(address);
    expect(serialize(thrown)).not.toContain(code);
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
      const sender = new ResendEmailSender({
        client: failing(500, 'internal_server_error'),
        logger,
        quarantine: quoting,
        exposeProviderErrors,
        retry: noWait,
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
