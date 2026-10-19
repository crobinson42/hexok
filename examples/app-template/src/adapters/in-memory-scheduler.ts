import { Adapter } from 'hexok';
import { DomainError } from '../errors/domain.js';
import {
  type DayName,
  DEFAULT_SCHEDULE,
  type ScheduleConfig,
  Scheduler,
} from '../ports/scheduler.js';

const DAY_TO_ISO: Record<DayName, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw DomainError.InvalidTimezone({ timezone });
  }
}

/** Wall-clock fields of `instant` in `timezone`. */
function wallOf(instant: Date, timezone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number(value);
  };
  let hour = read('hour');
  // Some engines report midnight as hour 24.
  if (hour === 24) hour = 0;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Milliseconds to add to `instant` to reach the same clock reading as UTC. */
function offsetMs(instant: Date, timezone: string): number {
  const wall = wallOf(instant, timezone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - instant.getTime();
}

/**
 * The instant whose wall clock in `timezone` is `wall`. The offset is read at
 * the destination, so a day that crosses a DST change keeps the local time.
 */
function instantFromWall(wall: Wall, timezone: string): Date {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const first = offsetMs(new Date(guess), timezone);
  let instant = guess - first;
  const second = offsetMs(new Date(instant), timezone);
  if (second !== first) instant = guess - second;
  return new Date(instant);
}

function localDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw DomainError.InvalidScheduleDate({ value });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw DomainError.InvalidScheduleDate({ value });
  }
  return { year, month, day };
}

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export class InMemoryScheduler extends Adapter(Scheduler) {
  readonly #configs = new Map<string, ScheduleConfig>();

  override async getConfig(id: string): Promise<ScheduleConfig> {
    const existing = this.#configs.get(id);
    if (existing !== undefined) return existing;
    const created: ScheduleConfig = { id, ...DEFAULT_SCHEDULE };
    this.#configs.set(id, created);
    return created;
  }

  override async startOfWeek(input: {
    localDate: string;
    timezone: string;
    firstDayOfWeek: DayName;
  }): Promise<string> {
    assertTimezone(input.timezone);
    const date = localDate(input.localDate);
    const target = DAY_TO_ISO[input.firstDayOfWeek];
    let daysBack = isoWeekday(date.year, date.month, date.day) - target;
    if (daysBack < 0) daysBack += 7;
    const start = new Date(
      Date.UTC(date.year, date.month - 1, date.day - daysBack),
    );
    return instantFromWall(
      {
        year: start.getUTCFullYear(),
        month: start.getUTCMonth() + 1,
        day: start.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      input.timezone,
    ).toISOString();
  }

  override async addDays(input: {
    instant: string;
    days: number;
    timezone: string;
  }): Promise<string> {
    assertTimezone(input.timezone);
    const parsed = new Date(input.instant);
    if (Number.isNaN(parsed.getTime())) {
      throw DomainError.InvalidScheduleDate({ value: input.instant });
    }
    const wall = wallOf(parsed, input.timezone);
    const shifted = new Date(
      Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day + input.days,
        wall.hour,
        wall.minute,
        wall.second,
      ),
    );
    return instantFromWall(
      {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
      },
      input.timezone,
    ).toISOString();
  }
}
