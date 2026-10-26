import type { EmailAddress, EmailSender } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import { SmsError, type SmsSender } from '@hexok/sms';
import { EventHandler } from 'hexok';
import { SubscriberJoinedEvent } from '../../../../domain/events/subscriber-joined.js';
import type { NotificationChannel } from '../../../../domain/schemas/subscriber.js';

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
    const channels = welcomeChannels(event.payload.channels);
    const text = 'You are subscribed.';
    if (channels.includes('email')) {
      await this.deps.email.send({
        to: [event.payload.email],
        from: this.deps.from,
        subject: 'Welcome',
        text,
      });
    }
    const phone = event.payload.phone;
    if (channels.includes('sms') && phone !== undefined) {
      try {
        await this.deps.sms.send({ to: phone, body: text });
      } catch (error) {
        if (!SmsError.is(error)) throw error;
        this.deps.logger.error(error, {
          subscriberId: event.payload.subscriberId,
          code: error.code,
        });
      }
    }
  }
}

function welcomeChannels(
  channels: readonly NotificationChannel[] | undefined,
): readonly NotificationChannel[] {
  return channels === undefined || channels.length === 0 ? ['email'] : channels;
}
