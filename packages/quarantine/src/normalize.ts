import type { ParkedError } from './quarantine.js';

function stringField(value: object, key: string): string | undefined {
  if (!(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field === 'string') return field;
  return undefined;
}

function withCodes(parked: ParkedError, value: object): ParkedError {
  const code = stringField(value, 'code');
  const catalog = stringField(value, 'catalog');
  if (code !== undefined && catalog !== undefined) {
    return { ...parked, code, catalog };
  }
  if (code !== undefined) return { ...parked, code };
  if (catalog !== undefined) return { ...parked, catalog };
  return parked;
}

/** Maps a thrown value to the plain error a quarantine record stores. */
export function normalizeFailure(error: unknown): ParkedError {
  if (error instanceof Error) {
    return withCodes({ name: error.name, message: error.message }, error);
  }
  if (typeof error === 'object' && error !== null) {
    const code = stringField(error, 'code');
    const catalog = stringField(error, 'catalog');
    if (code !== undefined && catalog !== undefined) {
      return {
        name: stringField(error, 'name') ?? 'Error',
        message: stringField(error, 'message') ?? String(error),
        code,
        catalog,
      };
    }
  }
  return { name: 'Error', message: String(error) };
}
