import {
  CodedError,
  type ErrorMap,
  type Infer,
  type StandardSchemaV1,
  validate,
} from '@plinth/core';
import type { ErrorFactories } from './types.js';

/**
 * Build `errors.NOT_FOUND()` factories from an error map.
 * Each factory throws `CodedError` and types as `never`.
 */
export function errorFactories<M extends ErrorMap>(map: M): ErrorFactories<M> {
  const factories = {} as Record<string, (data?: unknown) => never>;
  for (const code of Object.keys(map)) {
    const def = map[code];
    if (def === undefined) continue;
    factories[code] = (data?: unknown) => {
      let payload: unknown;
      if (def.data !== undefined && data !== undefined) {
        const parsed = validate(def.data as StandardSchemaV1, data);
        payload = parsed.ok ? parsed.value : data;
      } else if (data !== undefined) {
        payload = data;
      }
      throw new CodedError({
        code,
        message: def.message ?? code,
        ...(payload !== undefined ? { data: payload } : {}),
      });
    };
  }
  return factories as ErrorFactories<M>;
}

export type { Infer };
