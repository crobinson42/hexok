import type { EmailAddress, EmailSender } from '@hexok/email';
import { EmailError } from '@hexok/email';
import type { LogFields, Logger } from '@hexok/logger';
import { SmsError, type SmsSender } from '@hexok/sms';
import type { NotificationChannel } from '../domain/schemas/subscriber.js';

/** Omitted or empty channels mean email. Stored rows already have a list. */
export function channelsOrEmail(
  channels: readonly NotificationChannel[] | undefined,
): readonly NotificationChannel[] {
  return channels === undefined || channels.length === 0 ? ['email'] : channels;
}

export type NoticeDeps = {
  email: EmailSender;
  sms: SmsSender;
  from: EmailAddress;
  logger: Logger;
};

/**
 * Send one notice on the chosen channels.
 * A rejected email or any SMS error is logged. `Unavailable` and `RateLimited`
 * from mail still throw, so the queue can retry. The idempotency key is the
 * caller's, not the address.
 */
export async function deliverNotice(
  deps: NoticeDeps,
  input: {
    channels: readonly NotificationChannel[];
    email: string | undefined;
    phone: string | undefined;
    subject: string;
    text: string;
    idempotencyKey: string;
    signal: AbortSignal | undefined;
    log: LogFields | undefined;
  },
): Promise<void> {
  if (input.signal?.aborted) return;
  const channels = channelsOrEmail(input.channels);
  const log = input.log;
  if (
    channels.includes('email') &&
    input.email !== undefined &&
    input.email !== ''
  ) {
    try {
      await deps.email.send({
        to: [input.email],
        from: deps.from,
        subject: input.subject,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      if (!EmailError.is(error)) throw error;
      if (error.code === 'RateLimited' || error.code === 'Unavailable') {
        throw error;
      }
      deps.logger.error(error, log);
    }
  }
  if (input.signal?.aborted) return;
  const phone = input.phone;
  if (channels.includes('sms') && phone !== undefined) {
    try {
      await deps.sms.send({ to: phone, body: input.text });
    } catch (error) {
      if (!SmsError.is(error)) throw error;
      deps.logger.error(error, log);
    }
  }
}
