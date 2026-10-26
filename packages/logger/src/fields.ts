import type { LogFields } from './logger.js';

const reserved = new Set(['time', 'level', 'message']);

/** Shallow-merge bindings with per-call fields. Call fields win. Reserved keys are dropped. */
export function mergeFields(
  bindings: LogFields,
  fields?: LogFields,
): LogFields {
  const merged: LogFields = { ...bindings, ...fields };
  for (const key of reserved) {
    delete merged[key];
  }
  return merged;
}
