import { describe, expect, it } from 'vitest';
import { CronPackageScheduler, cronJobOptions } from './cron-scheduler.js';

describe('cron', () => {
  it('accepts 5-field and 6-field cron and rejects an invalid expression', () => {
    const scheduler = new CronPackageScheduler();
    const five = scheduler.schedule({
      cron: '0 * * * *',
      runOnInit: false,
      onTick() {},
    });
    five.stop();
    const six = scheduler.schedule({
      cron: '*/5 * * * * *',
      runOnInit: false,
      onTick() {},
    });
    six.stop();
    expect(() =>
      scheduler.schedule({
        cron: 'not a cron',
        runOnInit: false,
        onTick() {},
      }),
    ).toThrow();
    expect(
      cronJobOptions({ cron: '0 * * * *', runOnInit: false, onTick() {} }),
    ).toMatchObject({
      timeZone: 'UTC',
      recoverMissedExecutions: false,
      waitForCompletion: true,
    });
    expect(
      cronJobOptions({
        cron: '0 * * * *',
        timezone: 'America/New_York',
        runOnInit: true,
        onTick() {},
      }).timeZone,
    ).toBe('America/New_York');
  });
});
