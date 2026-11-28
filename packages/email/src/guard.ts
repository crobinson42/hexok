import { EmailError, type EmailMessage } from './email.js';

/** RFC 5322 field name: printable ASCII except space and colon. */
const FIELD_NAME = /^[!-9;-~]+$/;

/** A line break or NUL in a value would start a new header or end the block. */
const UNSAFE_VALUE = /[\r\n\0]/;

/** Fields `EmailMessage` already models, and the MIME fields the adapter builds. Lowercase. */
const MODELED = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'content-type',
  'content-transfer-encoding',
  'mime-version',
]);

function blanks(values: readonly string[] | undefined): boolean {
  if (!values || values.length === 0) return true;
  return values.every((value) => value.trim() === '');
}

function assertHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): void {
  if (!headers) return;
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      !FIELD_NAME.test(name) ||
      typeof value !== 'string' ||
      UNSAFE_VALUE.test(value) ||
      MODELED.has(lower) ||
      seen.has(lower)
    ) {
      throw EmailError.InvalidHeader();
    }
    seen.add(lower);
  }
}

export function assertEmailMessage(message: EmailMessage): void {
  if (blanks(message.to)) throw EmailError.InvalidRecipient();
  const text = message.text?.trim() ?? '';
  const html = message.html?.trim() ?? '';
  if (text === '' && html === '') throw EmailError.InvalidMessage();
  assertHeaders(message.headers);
}
