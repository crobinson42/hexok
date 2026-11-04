import type { EmailAddress, EmailSender } from '@hexok/email';
import type { Logger } from '@hexok/logger';
import type { SmsSender } from '@hexok/sms';
import type { UseCase } from 'hexok';
import { deliverNotice } from '../../../notify.js';
import type { SubscriberRepository } from '../../../ports/repos/subscriber-repository.js';
import { InternalUseCase } from '../../context.js';

/**
 * Internal use case. `execute` requires `InternalCtx` from `internalCall()`.
 * The guard rejects a context that does not carry this codebase's symbol.
 * API commands extend `ApiUseCase` and take `ApiCtx` instead.
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
    ctx: UseCase.Ctx<typeof InternalUseCase>,
    input: { subject: string; body: string; idempotencyKey: string },
  ): Promise<number> {
    const listed = await this.deps.subscribers.list();
    let delivered = 0;
    for (const subscriber of listed) {
      if (ctx.signal?.aborted) break;
      await deliverNotice(this.deps, {
        channels: subscriber.props.channels,
        email: subscriber.props.email,
        phone: subscriber.props.phone,
        subject: input.subject,
        text: input.body,
        idempotencyKey: `${input.idempotencyKey}:${subscriber.props.id}`,
        signal: ctx.signal,
        log: { subscriberId: subscriber.props.id },
      });
      delivered += 1;
    }
    return delivered;
  }
}
