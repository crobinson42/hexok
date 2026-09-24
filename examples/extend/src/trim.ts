import { Adapter, Port, Schema } from 'hexok';
import { z } from 'zod';

/** Override `parse` when the stock check is not enough. */
export class TrimmedName extends Schema('TrimmedName', z.string().min(1)) {
  static override parse(value: unknown): string {
    const raw = typeof value === 'string' ? value.trim() : value;
    return super.parse(raw);
  }
}

abstract class Clock extends Port('Clock') {
  abstract now(): Date;
}

/** Override `start` when the adapter needs a setup step. */
export class FixedClock extends Adapter(Clock) {
  #now = new Date(0);
  #started = false;

  override async start(): Promise<void> {
    this.#started = true;
  }

  override now(): Date {
    if (!this.#started) throw new Error('clock not started');
    return this.#now;
  }
}
