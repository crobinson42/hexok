import type { ScheduleRegistration } from '@hexok/schedule-coordinator';
import type { InternalCtx } from './context.js';
import { InternalUseCase, internalCall } from './context.js';

/** Cron fields a scheduled use case declares. `onTick` is filled in by the instance. */
export type ScheduleSpec = Omit<ScheduleRegistration, 'onTick'>;

/**
 * Internal use case that owns its cron registration.
 * `execute` still accepts only `internalCall()`. The coordinator never builds that context.
 *
 * ```ts
 * class SubscriberReminder extends ScheduledUseCase('post.subscriber-reminder', {
 *   name: 'subscriber-reminder',
 *   cron: '0 0 * * *',
 *   timezone: 'UTC',
 * }) {
 *   async execute(ctx: UseCase.Ctx<typeof InternalUseCase>): Promise<void> {}
 * }
 *
 * schedule.register(new SubscriberReminder(deps).registration());
 * ```
 */
export function ScheduledUseCase<
  const Token extends string,
  const Schedule extends ScheduleSpec,
>(token: Token, schedule: Schedule) {
  abstract class Scheduled extends InternalUseCase(token) {
    /** Cron fields passed to {@link ScheduledUseCase}. */
    static readonly schedule: Schedule = schedule;

    /** Job for `ScheduleCoordinator.register`. `onTick` calls `execute`. */
    registration(this: {
      execute(ctx: InternalCtx): Promise<unknown>;
    }): ScheduleRegistration {
      return {
        ...schedule,
        onTick: async () => {
          await this.execute(internalCall());
        },
      };
    }
  }

  return Scheduled;
}
