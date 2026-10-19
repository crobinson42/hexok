import type { UseCase } from 'hexok';
import type { EmailSender } from '../../../ports/email-sender.js';
import type { SubscriberRepository } from '../../../ports/subscriber-repository.js';
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
    private readonly subscribers: SubscriberRepository,
    private readonly email: EmailSender,
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof InternalUseCase>,
    input: { subject: string; body: string },
  ): Promise<number> {
    const listed = await this.subscribers.list();
    for (const subscriber of listed) {
      await this.email.send(subscriber.props.email, input.subject, input.body);
    }
    return listed.length;
  }
}
