import { Port } from 'hexok';

export interface ScheduleTick {
  readonly signal: AbortSignal;
}

export interface ScheduleRegistration {
  readonly name: string;
  readonly cron: string;
  readonly timezone?: string;
  readonly runOnRegister?: boolean;
  // Warn after this many milliseconds of running - ie: long-running jobs.
  readonly warnAfterMs?: number;
  readonly onTick: (tick: ScheduleTick) => void | Promise<void>;
}

export abstract class ScheduleCoordinator extends Port('ScheduleCoordinator') {
  abstract register(job: ScheduleRegistration): void;
}
