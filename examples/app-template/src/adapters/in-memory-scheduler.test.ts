import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain.js';
import { InMemoryScheduler } from './in-memory-scheduler.js';

describe('InMemoryScheduler', () => {
  it('creates the default config once per id', async () => {
    const scheduler = new InMemoryScheduler();
    const first = await scheduler.getConfig('blog');
    const second = await scheduler.getConfig('blog');

    expect(first).toEqual({
      id: 'blog',
      timezone: 'UTC',
      firstDayOfWeek: 'monday',
    });
    expect(second).toBe(first);
  });

  it('starts the week on the configured local day', async () => {
    const scheduler = new InMemoryScheduler();
    // 2026-10-18 is a Sunday. Phoenix is UTC-7 all year.
    const start = await scheduler.startOfWeek({
      localDate: '2026-10-18',
      timezone: 'America/Phoenix',
      firstDayOfWeek: 'monday',
    });

    expect(start).toBe('2026-10-12T07:00:00.000Z');
  });

  it('keeps the local clock time across a DST change', async () => {
    const scheduler = new InMemoryScheduler();
    // 2026-03-07 22:00 PST. The next local day is 22:00 PDT, one hour earlier in UTC.
    const next = await scheduler.addDays({
      instant: '2026-03-08T06:00:00.000Z',
      days: 1,
      timezone: 'America/Los_Angeles',
    });

    expect(next).toBe('2026-03-09T05:00:00.000Z');
  });

  it('rejects a calendar date that is not a real day', async () => {
    const scheduler = new InMemoryScheduler();
    await expect(
      scheduler.startOfWeek({
        localDate: '2026-02-31',
        timezone: 'UTC',
        firstDayOfWeek: 'monday',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        DomainError.is(error) && error.code === 'InvalidScheduleDate',
    );
  });
});
