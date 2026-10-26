import type { UseCase } from 'hexok';
import type { InternalUseCase } from '../../context.js';
import { ScheduledUseCase } from '../../scheduled.js';
import type { EmailSubscribers } from '../internal/email-subscribers.js';

const REMINDER = {
  subject: 'Posts you follow',
  body: 'A published post is waiting.',
};

/**
 * Daily UTC job. Register the instance: `schedule.register(reminder.registration())`.
 * `execute` accepts only `internalCall()`, which `registration()` supplies.
 */
export class SubscriberReminder extends ScheduledUseCase(
  'post.subscriber-reminder',
  {
    name: 'subscriber-reminder',
    cron: '0 0 * * *',
    timezone: 'UTC',
  },
) {
  constructor(private readonly deps: { emailSubscribers: EmailSubscribers }) {
    super();
  }

  async execute(ctx: UseCase.Ctx<typeof InternalUseCase>): Promise<number> {
    return this.deps.emailSubscribers.execute(ctx, REMINDER);
  }
}
