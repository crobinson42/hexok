import { EmailError, type EmailMessage } from '@hexok/email';
import { describe, expect, it } from 'vitest';
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
      tags: [{ name: 'env', value: 'test' }],
    });
    expect(options).toEqual({ idempotencyKey: 'key-1' });
  });
});
