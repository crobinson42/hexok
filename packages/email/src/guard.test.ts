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

describe('assertEmailMessage headers', () => {
  it('accepts threading and auto-reply headers', () => {
    expect(() =>
      assertEmailMessage(
        message({
          headers: {
            'In-Reply-To': '<a@example.com>',
            References: '<a@example.com> <b@example.com>',
            'Auto-Submitted': 'auto-replied',
          },
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['a line break in a value', { 'X-Note': 'a\r\nBcc: x@example.com' }],
    ['a bare line feed in a value', { 'X-Note': 'a\nb' }],
    ['a NUL in a value', { 'X-Note': 'a\0b' }],
    ['a space in a name', { 'X Note': 'a' }],
    ['a colon in a name', { 'X-Note:': 'a' }],
    ['an empty name', { '': 'a' }],
    ['a modeled field', { Subject: 'other' }],
    ['a modeled field in another case', { 'reply-TO': 'x@example.com' }],
    ['a MIME field', { 'Content-Type': 'text/plain' }],
    ['the same name twice', { 'X-Note': 'a', 'x-note': 'b' }],
  ])('rejects %s', (_label, headers) => {
    expect(() => assertEmailMessage(message({ headers }))).toThrow(
      EmailError.InvalidHeader(),
    );
  });
});
