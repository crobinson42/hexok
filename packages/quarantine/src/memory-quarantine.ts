import { randomUUID } from 'node:crypto';
import { Adapter } from 'hexok';
import {
  type ParkedError,
  Quarantine,
  QuarantineError,
  type QuarantineInput,
  type QuarantineItem,
  type QuarantineOutcome,
  type QuarantineQuery,
} from './quarantine.js';

interface Row {
  seq: number;
  item: QuarantineItem;
}

function copyError(error: ParkedError): ParkedError {
  const copy: ParkedError = { name: error.name, message: error.message };
  if (error.code !== undefined && error.catalog !== undefined) {
    return { ...copy, code: error.code, catalog: error.catalog };
  }
  if (error.code !== undefined) return { ...copy, code: error.code };
  if (error.catalog !== undefined) return { ...copy, catalog: error.catalog };
  return copy;
}

function toItem(id: string, input: QuarantineInput): QuarantineItem {
  return {
    id,
    source: input.source,
    operation: input.operation,
    payload: input.payload,
    error: copyError(input.error),
    occurredAt: new Date(input.occurredAt.getTime()),
    status: 'open',
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
    ...(input.context !== undefined ? { context: { ...input.context } } : {}),
  };
}

export class MemoryQuarantine extends Adapter(Quarantine) {
  readonly #rows: Row[] = [];
  #seq = 0;

  async park(input: QuarantineInput): Promise<{ id: string }> {
    const id = randomUUID();
    this.#seq += 1;
    this.#rows.push({ seq: this.#seq, item: toItem(id, input) });
    return { id };
  }

  async get(id: string): Promise<QuarantineItem | null> {
    return this.#rows.find((row) => row.item.id === id)?.item ?? null;
  }

  async list(query?: QuarantineQuery): Promise<readonly QuarantineItem[]> {
    const limit = query?.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('quarantine: limit must be 1..1000');
    }
    const rows = this.#rows.filter((row) => {
      if (query?.source !== undefined && row.item.source !== query.source) {
        return false;
      }
      if (
        query?.operation !== undefined &&
        row.item.operation !== query.operation
      ) {
        return false;
      }
      if (query?.status !== undefined && row.item.status !== query.status) {
        return false;
      }
      if (
        query?.since !== undefined &&
        row.item.occurredAt.getTime() < query.since.getTime()
      ) {
        return false;
      }
      return true;
    });
    rows.sort((left, right) => {
      const time =
        right.item.occurredAt.getTime() - left.item.occurredAt.getTime();
      if (time !== 0) return time;
      return left.seq - right.seq;
    });
    return rows.slice(0, limit).map((row) => row.item);
  }

  async resolve(id: string, outcome: QuarantineOutcome): Promise<void> {
    const row = this.#rows.find((candidate) => candidate.item.id === id);
    if (!row) throw QuarantineError.Missing();
    if (row.item.status === outcome) return;
    if (row.item.status !== 'open') throw QuarantineError.Closed();
    row.item = { ...row.item, status: outcome };
  }
}
