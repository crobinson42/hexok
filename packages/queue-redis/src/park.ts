import type { LogSink } from './log-sink.js';

/** Structurally `Quarantine.park`. This package does not import `@hexok/quarantine`. */
export interface ParkedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly catalog?: string;
}

export interface ParkInput {
  readonly source: string;
  readonly operation: string;
  readonly subject?: string;
  readonly payload: unknown;
  readonly error: ParkedError;
  readonly attempts?: number;
  readonly occurredAt: Date;
  readonly context?: Readonly<Record<string, string>>;
}

export interface ParkSink {
  park(input: ParkInput): Promise<{ id: string }>;
}

function stringField(value: object, key: string): string | undefined {
  if (!(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field === 'string') return field;
  return undefined;
}

export function parkedError(error: unknown): ParkedError {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) };
  }
  const parked: ParkedError = { name: error.name, message: error.message };
  const code = stringField(error, 'code');
  const catalog = stringField(error, 'catalog');
  if (code !== undefined && catalog !== undefined) {
    return { ...parked, code, catalog };
  }
  if (code !== undefined) return { ...parked, code };
  if (catalog !== undefined) return { ...parked, catalog };
  return parked;
}

export async function courtesyPark(
  sink: ParkSink | undefined,
  input: ParkInput,
  logger: LogSink,
): Promise<void> {
  if (!sink) return;
  try {
    await sink.park(input);
  } catch (error) {
    logger.error(
      error instanceof Error ? error : new Error('quarantine: park failed'),
    );
  }
}
