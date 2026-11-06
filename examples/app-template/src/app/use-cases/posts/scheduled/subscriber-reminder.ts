import type { EmailAddress, EmailSender } from '@hexok/email';
import { EmailError } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import { SmsError, type SmsSender } from '@hexok/sms';
import type { UseCase } from 'hexok';
import type { SubscriberEntity } from '../../../../domain/entities/subscriber.js';
import {
  BLOG_ORGANIZATION,
  SubscriberReminderWebhook,
} from '../../../../domain/events/webhook-events.js';
import type { WebhookPublisher } from '../../../ports/events/webhook-publisher.js';
import type { SubscriberRepository } from '../../../ports/repos/subscriber-repository.js';
import type { InternalUseCase } from '../../context.js';
import { ScheduledUseCase } from '../../scheduled.js';

const REMINDER = {
  subject: 'Posts you follow',
  body: 'A published post is waiting.',
};

/**
 * Daily UTC job. Register the instance: `schedule.register(reminder.registration())`.
 * `execute` accepts only `internalCallCtx()`, which `registration()` supplies.
 */
export class SubscriberReminder extends ScheduledUseCase(
  'post.subscriber-reminder',
  {
    name: 'subscriber-reminder',
    cron: '0 0 * * *',
    timezone: 'UTC',
  },
) {
  constructor(
    private readonly deps: {
      subscribers: SubscriberRepository;
      email: EmailSender;
      sms: SmsSender;
      from: EmailAddress;
      logger: Logger;
      webhooks: WebhookPublisher;
    },
  ) {
    super();
  }

  async execute(ctx: UseCase.Ctx<typeof InternalUseCase>): Promise<number> {
    if (ctx.signal?.aborted) return 0;
    const day = new Date().toISOString().slice(0, 10);
    // One publish. The endpoint port fans out. A throw fails the tick, and a missed day is not replayed.
    await this.deps.webhooks.publish({
      organizationId: BLOG_ORGANIZATION,
      eventId: `${SubscriberReminderWebhook.token}:${day}`,
      event: new SubscriberReminderWebhook({ day }),
    });
    const listed = await this.deps.subscribers.list();
    let delivered = 0;
    for (const subscriber of listed) {
      if (ctx.signal?.aborted) break;
      await this.#send(
        subscriber,
        {
          subject: REMINDER.subject,
          text: REMINDER.body,
          idempotencyKey: `post.subscriber-reminder:${day}:${subscriber.props.id}`,
        },
        ctx.signal,
      );
      delivered += 1;
    }
    return delivered;
  }

  /**
   * Email when this subscriber chose email. SMS when they chose SMS.
   * A rejected email or any SMS error is logged. `Unavailable` and
   * `RateLimited` from mail still throw, so the queue retries.
   */
  async #send(
    subscriber: SubscriberEntity,
    message: { subject: string; text: string; idempotencyKey: string },
    signal: AbortSignal | undefined,
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
    if (signal?.aborted) return;
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
