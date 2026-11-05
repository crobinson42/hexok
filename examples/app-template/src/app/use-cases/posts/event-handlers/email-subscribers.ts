import type { EmailAddress, EmailSender } from '@hexok/email';
import { EmailError } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import { SmsError, type SmsSender } from '@hexok/sms';
import { EventHandler } from 'hexok';
import type { SubscriberEntity } from '../../../../domain/entities/subscriber.js';
import { PostPublishedEvent } from '../../../../domain/events/post-published.js';
import type { SubscriberRepository } from '../../../ports/repos/subscriber-repository.js';

export class EmailSubscribersHandler extends EventHandler(
  'email.subscribers',
  PostPublishedEvent,
) {
  constructor(
    private readonly deps: {
      subscribers: SubscriberRepository;
      email: EmailSender;
      sms: SmsSender;
      from: EmailAddress;
      logger: Logger;
    },
  ) {
    super();
  }

  async handle(event: PostPublishedEvent): Promise<void> {
    if (!event.payload.emailSubscribers) return;
    const listed = await this.deps.subscribers.list();
    for (const subscriber of listed) {
      await this.#send(subscriber, {
        subject: 'New post',
        text: event.payload.title,
        idempotencyKey: `post.published:${event.payload.postId}:${subscriber.props.id}`,
      });
    }
  }

  /**
   * Email when this subscriber chose email. SMS when they chose SMS.
   * A rejected email or any SMS error is logged. `Unavailable` and
   * `RateLimited` from mail still throw, so the queue retries.
   */
  async #send(
    subscriber: SubscriberEntity,
    message: { subject: string; text: string; idempotencyKey: string },
  ): Promise<void> {
    const log = { subscriberId: subscriber.props.id };
    const email = subscriber.props.email;
    if (subscriber.props.channels.includes('email') && email !== '') {
      try {
        await this.deps.email.send({
          to: [email],
          from: this.deps.from,
          subject: message.subject,
          text: message.text,
          idempotencyKey: message.idempotencyKey,
        });
      } catch (error) {
        if (!EmailError.is(error)) throw error;
        if (error.code === 'RateLimited' || error.code === 'Unavailable') {
          throw error;
        }
        this.deps.logger.error(error, log);
      }
    }
    const phone = subscriber.props.phone;
    if (subscriber.props.channels.includes('sms') && phone !== undefined) {
      try {
        await this.deps.sms.send({ to: phone, body: message.text });
      } catch (error) {
        if (!SmsError.is(error)) throw error;
        this.deps.logger.error(error, log);
      }
    }
  }
}
