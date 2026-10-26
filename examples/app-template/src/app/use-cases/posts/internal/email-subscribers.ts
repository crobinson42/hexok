import type { EmailAddress, EmailSender } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import { SmsError, type SmsSender } from '@hexok/sms';
import type { UseCase } from 'hexok';
import type { SubscriberEntity } from '../../../../domain/entities/subscriber.js';
import type { NotificationChannel } from '../../../../domain/schemas/subscriber.js';
import type { SubscriberRepository } from '../../../ports/repos/subscriber-repository.js';
import { InternalUseCase } from '../../context.js';

/**
 * Internal use case. `execute` requires `InternalCtx` from `internalCall()`.
 * The guard rejects a context that does not carry this codebase's symbol.
 * API commands extend `ApiUseCase` and take `{ authToken?: string }` instead.
 */
export class EmailSubscribers extends InternalUseCase(
  'post.email-subscribers',
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

  async execute(
    _ctx: UseCase.Ctx<typeof InternalUseCase>,
    input: { subject: string; body: string },
  ): Promise<number> {
    const listed = await this.deps.subscribers.list();
    for (const subscriber of listed) {
      const channels = chosenChannels(subscriber);
      if (channels.includes('email')) {
        await this.deps.email.send({
          to: [subscriber.props.email],
          from: this.deps.from,
          subject: input.subject,
          text: input.body,
        });
      }
      const phone = subscriber.props.phone;
      if (channels.includes('sms') && phone !== undefined) {
        try {
          await this.deps.sms.send({ to: phone, body: input.body });
        } catch (error) {
          if (!SmsError.is(error)) throw error;
          this.deps.logger.error(error, {
            subscriberId: subscriber.props.id,
            code: error.code,
          });
        }
      }
    }
    return listed.length;
  }
}

function chosenChannels(
  subscriber: SubscriberEntity,
): readonly NotificationChannel[] {
  const channels = subscriber.props.channels;
  return channels === undefined || channels.length === 0 ? ['email'] : channels;
}
