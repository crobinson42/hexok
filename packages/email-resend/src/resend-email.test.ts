import { EmailError, type EmailMessage } from '@hexok/email';
import { Resend } from 'resend';
import { describe, expect, it } from 'vitest';
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
});
