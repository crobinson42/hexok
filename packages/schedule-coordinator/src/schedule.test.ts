import { Adapter } from 'hexok';
import { describe, expect, it } from 'vitest';
import { ScheduleCoordinator, type ScheduleRegistration } from './schedule.js';

class MemoryCoordinator extends Adapter(ScheduleCoordinator) {
  readonly jobs: ScheduleRegistration[] = [];

  register(job: ScheduleRegistration): void {
    if (this.jobs.some((existing) => existing.name === job.name)) {
      throw new Error(`schedule: job "${job.name}" is already registered`);
    }
    this.jobs.push(job);
  }
}

describe('ScheduleCoordinator', () => {
  it('rejects a duplicate job name', () => {
    const coordinator = new MemoryCoordinator();
    const job: ScheduleRegistration = {
      name: 'cleanup',
      cron: '0 * * * *',
      onTick: () => undefined,
    };
    coordinator.register(job);
    expect(() => coordinator.register(job)).toThrow(
      'schedule: job "cleanup" is already registered',
    );
  });
});
