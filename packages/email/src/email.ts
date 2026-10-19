import { Errors, Port } from 'hexok';

export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

export interface EmailAttachment {
  readonly data: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

export interface EmailMessage {
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly from: EmailAddress;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments?: readonly EmailAttachment[];
  readonly tags?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
}

export interface EmailReceipt {
  readonly id: string;
}

export class EmailError extends Errors('email', {
  InvalidRecipient: { message: 'No recipient' },
  InvalidMessage: { message: 'Email needs text or html' },
  Rejected: { message: 'Email was rejected' },
  RateLimited: { message: 'Email provider rate limited the send' },
  Unavailable: { message: 'Email provider is unavailable' },
}) {}

export abstract class EmailSender extends Port('EmailSender') {
  abstract send(message: EmailMessage): Promise<EmailReceipt>;
}
