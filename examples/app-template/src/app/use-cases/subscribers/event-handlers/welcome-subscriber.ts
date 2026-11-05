import type { EmailAddress, EmailSender } from '@hexok/email';
import { EmailError } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import { SmsError, type SmsSender } from '@hexok/sms';
import { EventHandler } from 'hexok';
import { SubscriberJoinedEvent } from '../../../../domain/events/subscriber-joined.js';

export class WelcomeSubscriberHandler extends EventHandler(
  'email.welcome',
  SubscriberJoinedEvent,
) {
  constructor(
    private readonly deps: {
      email: EmailSender;
      sms: SmsSender;
      from: EmailAddress;
      logger: Logger;
    },
  ) {
    super();
  }

  async handle(event: SubscriberJoinedEvent): Promise<void> {
    const log = { subscriberId: event.payload.subscriberId };
    const text = 'You are subscribed.';
    if (
      event.payload.channels.includes('email') &&
      event.payload.email !== ''
    ) {
      try {
        await this.deps.email.send({
          to: [event.payload.email],
          from: this.deps.from,
          subject: 'Welcome',
          text,
          idempotencyKey: `subscriber.joined:${event.payload.subscriberId}`,
        });
      } catch (error) {
        if (!EmailError.is(error)) throw error;
        if (error.code === 'RateLimited' || error.code === 'Unavailable') {
          throw error;
        }
        this.deps.logger.error(error, log);
      }
    }
    const phone = event.payload.phone;
    if (event.payload.channels.includes('sms') && phone !== undefined) {
      try {
        await this.deps.sms.send({ to: phone, body: text });
      } catch (error) {
        if (!SmsError.is(error)) throw error;
        this.deps.logger.error(error, log);
      }
    }
  }
}
