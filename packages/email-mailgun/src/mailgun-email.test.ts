import { EmailError, type EmailMessage } from '@hexok/email';
import { describe, expect, it } from 'vitest';
import { MailgunEmailSender, type MailgunLike } from './mailgun-email.js';

const message: EmailMessage = {
  to: ['person@example.com'],
  from: { email: 'from@example.com' },
  subject: 'Hello',
  text: 'body',
  idempotencyKey: 'key-1',
  tags: { env: 'test', idempotencyKey: 'nope' },
};

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
});
