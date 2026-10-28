import { CronJob } from 'cron';

export interface CronScheduler {
  schedule(input: {
    readonly cron: string;
    readonly timezone?: string;
    readonly runOnInit: boolean;
    readonly onTick: () => void | Promise<void>;
  }): {
    /** Stops new ticks. A returned promise resolves once a running tick has finished. */
    stop(): void | Promise<void>;
    fire(): Promise<void>;
  };
}

export function cronJobOptions(input: {
  readonly cron: string;
  readonly timezone?: string;
  readonly runOnInit: boolean;
  readonly onTick: () => void | Promise<void>;
}): {
  cronTime: string;
  timeZone: string;
  onTick: () => void | Promise<void>;
  start: true;
  runOnInit: boolean;
  waitForCompletion: true;
  recoverMissedExecutions: false;
} {
  return {
    cronTime: input.cron,
    timeZone: input.timezone ?? 'UTC',
    onTick: () => input.onTick(),
    start: true,
    runOnInit: input.runOnInit,
    waitForCompletion: true,
    recoverMissedExecutions: false,
  };
}

export class CronPackageScheduler implements CronScheduler {
  schedule(input: {
    readonly cron: string;
    readonly timezone?: string;
    readonly runOnInit: boolean;
    readonly onTick: () => void | Promise<void>;
  }): { stop(): Promise<void>; fire(): Promise<void> } {
    const job = CronJob.from(cronJobOptions(input));
    return {
      async stop() {
        // With `waitForCompletion`, cron polls every 100ms until a running tick finishes. Awaiting it leaves no poll timer behind.
        await job.stop();
      },
      fire() {
        return Promise.resolve(input.onTick());
      },
    };
  }
}
