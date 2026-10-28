import { describe, expect, it } from 'vitest';
import { CronPackageScheduler, cronJobOptions } from './cron-scheduler.js';

describe('cron', () => {
  it('accepts 5-field and 6-field cron and rejects an invalid expression', async () => {
    const scheduler = new CronPackageScheduler();
    const five = scheduler.schedule({
      cron: '0 * * * *',
      runOnInit: false,
      onTick() {},
    });
    await five.stop();
    const six = scheduler.schedule({
      cron: '*/5 * * * * *',
      runOnInit: false,
      onTick() {},
    });
    await six.stop();
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

describe('CronPackageScheduler stop', () => {
  it('resolves once the running tick has finished', async () => {
    let finish: () => void = () => {};
    let stopped = false;
    const handle = new CronPackageScheduler().schedule({
      cron: '0 * * * *',
      runOnInit: true,
      onTick: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const stopping = Promise.resolve(handle.stop()).then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stopped).toBe(false);
    finish();
    await stopping;
    expect(stopped).toBe(true);
  });
});
