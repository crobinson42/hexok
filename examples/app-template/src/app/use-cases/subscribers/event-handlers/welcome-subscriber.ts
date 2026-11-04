import type { EmailAddress, EmailSender } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import type { SmsSender } from '@hexok/sms';
import { EventHandler } from 'hexok';
import { SubscriberJoinedEvent } from '../../../../domain/events/subscriber-joined.js';
import { deliverNotice } from '../../../notify.js';

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
    await deliverNotice(this.deps, {
      channels: event.payload.channels,
      email: event.payload.email,
      phone: event.payload.phone,
      subject: 'Welcome',
      text: 'You are subscribed.',
      idempotencyKey: `subscriber.joined:${event.payload.subscriberId}`,
      signal: undefined,
      log: { subscriberId: event.payload.subscriberId },
    });
  }
}
