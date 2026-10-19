import { describe, expect, it } from 'vitest';
import { EmailError, type EmailMessage } from './email.js';
import { assertEmailMessage } from './guard.js';

const message = (patch: Partial<EmailMessage>): EmailMessage => ({
  to: ['a@example.com'],
  from: { email: 'from@example.com' },
  subject: 'Hi',
  text: 'body',
  ...patch,
});

describe('assertEmailMessage', () => {
  it('rejects empty recipients and a message with neither text nor html', () => {
    expect(() => assertEmailMessage(message({ to: [] }))).toThrow(EmailError);
    expect(() => assertEmailMessage(message({ to: ['  '] }))).toThrow(
      EmailError.InvalidRecipient(),
    );
    expect(() => assertEmailMessage(message({ text: '  ' }))).toThrow(
      EmailError.InvalidMessage(),
    );
    expect(() => assertEmailMessage(message({ text: 'ok' }))).not.toThrow();
    const htmlOnly: EmailMessage = {
      to: ['a@example.com'],
      from: { email: 'from@example.com' },
      subject: 'Hi',
      html: '<p>ok</p>',
    };
    expect(() => assertEmailMessage(htmlOnly)).not.toThrow();
  });
});
