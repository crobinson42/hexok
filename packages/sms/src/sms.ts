import { Errors, Port, type StandardSchemaV1 } from 'hexok';

export interface SmsMessage {
  readonly to: string;
  readonly body: string;
  /** Keeps `to` and `body` out of quarantine and logs. Use it for one-time codes. */
  readonly sensitive?: boolean;
}

export interface SmsReceipt {
  readonly id: string;
  readonly acceptedAt: Date;
}

const retryAfter: StandardSchemaV1<{ retryAfterMs: number }> = {
  '~standard': {
    version: 1,
    vendor: 'hexok-sms',
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'retryAfterMs' in value &&
        typeof (value as { retryAfterMs: unknown }).retryAfterMs === 'number'
      ) {
        return { value: value as { retryAfterMs: number } };
      }
      return { issues: [{ message: 'retryAfterMs required' }] };
    },
  },
};

export class SmsError extends Errors('sms', {
  Unsubscribed: { message: 'Recipient unsubscribed' },
  InvalidRecipient: { message: 'Invalid recipient' },
  Rejected: { message: 'Message was rejected' },
  RateLimited: {
    message: 'SMS provider rate limited the send',
    data: retryAfter,
  },
  Unavailable: {
    message: 'SMS provider is unavailable',
    data: retryAfter,
  },
}) {}

export abstract class SmsSender extends Port('SmsSender') {
  abstract send(message: SmsMessage): Promise<SmsReceipt>;
}

export function assertSmsMessage(message: SmsMessage): void {
  if (message.to.trim() === '') throw SmsError.InvalidRecipient();
  if (message.body.trim() === '') throw SmsError.Rejected('Body is empty');
}
