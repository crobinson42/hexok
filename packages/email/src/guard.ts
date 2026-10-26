import { EmailError, type EmailMessage } from './email.js';

function blanks(values: readonly string[] | undefined): boolean {
  if (!values || values.length === 0) return true;
  return values.every((value) => value.trim() === '');
}

export function assertEmailMessage(message: EmailMessage): void {
  if (blanks(message.to)) throw EmailError.InvalidRecipient();
  const text = message.text?.trim() ?? '';
  const html = message.html?.trim() ?? '';
  if (text === '' && html === '') throw EmailError.InvalidMessage();
}
