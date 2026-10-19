import { Port } from 'hexok';

/** ISO weekday names. Monday is 1, Sunday is 7. */
export type DayName =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * One schedule's settings. `getConfig` creates this with the defaults when
 * the id has never been stored.
 */
export type ScheduleConfig = {
  id: string;
  timezone: string;
  firstDayOfWeek: DayName;
};

export const DEFAULT_SCHEDULE = {
  timezone: 'UTC',
  firstDayOfWeek: 'monday',
} as const satisfies Omit<ScheduleConfig, 'id'>;

/**
 * Calendar math for a schedule. A local date (`YYYY-MM-DD`) is a day, not an
 * instant. Week boundaries and day offsets keep the wall clock in `timezone`.
 */
export abstract class Scheduler extends Port('Scheduler') {
  abstract getConfig(id: string): Promise<ScheduleConfig>;

  /** Local midnight on the week's first day, as an ISO instant. */
  abstract startOfWeek(input: {
    localDate: string;
    timezone: string;
    firstDayOfWeek: DayName;
  }): Promise<string>;

  /** Move `instant` by whole local days. The clock time in `timezone` stays. */
  abstract addDays(input: {
    instant: string;
    days: number;
    timezone: string;
  }): Promise<string>;
}
