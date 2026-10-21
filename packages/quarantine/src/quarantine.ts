import { Errors, Port } from 'hexok';

/** Plain error stored with a parked attempt. No stack and no payload. */
export interface ParkedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly catalog?: string;
}

export interface QuarantineInput {
  readonly source: string;
  readonly operation: string;
  readonly subject?: string;
  readonly payload: unknown;
  readonly error: ParkedError;
  readonly attempts?: number;
  readonly occurredAt: Date;
  readonly context?: Readonly<Record<string, string>>;
}

export type QuarantineOutcome = 'resolved' | 'discarded';

export type QuarantineStatus = 'open' | QuarantineOutcome;

export interface QuarantineItem {
  readonly id: string;
  readonly source: string;
  readonly operation: string;
  readonly subject?: string;
  readonly payload: unknown;
  readonly error: ParkedError;
  readonly attempts?: number;
  readonly occurredAt: Date;
  readonly context?: Readonly<Record<string, string>>;
  readonly status: QuarantineStatus;
}

export interface QuarantineQuery {
  readonly source?: string;
  readonly operation?: string;
  readonly status?: QuarantineStatus;
  readonly since?: Date;
  readonly limit?: number;
}

export class QuarantineError extends Errors('quarantine', {
  Missing: { message: 'Quarantine item is missing' },
  Closed: { message: 'Quarantine item is already closed' },
}) {}

export abstract class Quarantine extends Port('Quarantine') {
  abstract park(input: QuarantineInput): Promise<{ id: string }>;
  abstract get(id: string): Promise<QuarantineItem | null>;
  abstract list(query?: QuarantineQuery): Promise<readonly QuarantineItem[]>;
  abstract resolve(id: string, outcome: QuarantineOutcome): Promise<void>;
}
