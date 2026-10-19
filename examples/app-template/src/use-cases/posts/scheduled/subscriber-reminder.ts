import type { UseCase } from 'hexok';
import { InternalUseCase, internalCall } from '../../context.js';
import type { EmailSubscribers } from '../internal/email-subscribers.js';

const REMINDER = {
  subject: 'Posts you follow',
  body: 'A published post is waiting.',
};

/**
 * Scheduled use case. Same internal family as `EmailSubscribers`: `execute`
 * accepts only `internalCall()`. The timer passes that context.
 */
export class SubscriberReminder extends InternalUseCase(
  'post.subscriber-reminder',
) {
  constructor(private readonly emailSubscribers: EmailSubscribers) {
    super();
  }

  async execute(ctx: UseCase.Ctx<typeof InternalUseCase>): Promise<number> {
    return this.emailSubscribers.execute(ctx, REMINDER);
  }
}

/**
 * Registers the reminder on a timer. Stop clears the timer. The timer does
 * not keep the process alive.
 */
export function scheduleSubscriberReminder(
  reminder: SubscriberReminder,
  everyMs: number,
): { stop(): void } {
  const timer = setInterval(() => {
    void reminder.execute(internalCall());
  }, everyMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
