import type { ErrorMap, StandardSchemaV1 } from '../core/index.js';
import type { PathTo, UnionToIntersection } from './nest.js';
import {
  type ExternalKeysOf,
  isCallableUseCase,
  isExternalUseCase,
  type UseCaseBag,
  type UseCaseClass,
} from './types.js';

/** One external use case in the runtime catalog. Transport-neutral, wide. */
export type CatalogEntry = {
  /** Use-case `key` (`incident.close`). */
  key: string;
  /** Request schema. */
  input: StandardSchemaV1;
  /** Success schema. */
  output: StandardSchemaV1;
  /** Declared error map. */
  errors: ErrorMap;
};

/** Flat catalog from `deriveContract`. Event and internal use cases are omitted. */
export type UseCaseContract = {
  /** Entries keyed by use-case `key`. */
  entries: Record<string, CatalogEntry>;
};

type UseCaseWithKey<Bag, Key> = Extract<
  Bag[keyof Bag],
  { trigger: 'external'; key: Key }
>;

type RouteView<C> = C extends {
  key: infer Key extends string;
  input: infer Input;
  output: infer Output;
  errors: infer Errors;
}
  ? {
      readonly key: Key;
      readonly input: Input;
      readonly output: Output;
      readonly errors: Errors;
    }
  : never;

/**
 * Nested by use-case `key` (`incident.close` → `{ incident: { close } }`).
 * Event and internal use cases are omitted.
 */
export type DerivedContract<Bag> = UnionToIntersection<
  ExternalKeysOf<Bag> extends infer Key
    ? Key extends string
      ? PathTo<Key, RouteView<UseCaseWithKey<Bag, Key>>>
      : never
    : never
>;

/**
 * Build a transport-neutral catalog from a use-case class list.
 * Duplicate `key` throws. Event use cases and InternalUseCase are skipped.
 */
export function deriveContract(useCases: UseCaseBag): UseCaseContract {
  const entries: Record<string, CatalogEntry> = {};
  const seen = new Set<string>();
  for (const ctor of Object.values(useCases) as UseCaseClass[]) {
    if (!isCallableUseCase(ctor)) continue;
    if (seen.has(ctor.key)) {
      throw new Error(`hexok: duplicate use-case key "${ctor.key}"`);
    }
    seen.add(ctor.key);
    if (!isExternalUseCase(ctor)) continue;
    entries[ctor.key] = {
      key: ctor.key,
      input: ctor.input,
      output: ctor.output,
      errors: ctor.errors,
    };
  }
  return { entries };
}

export { nestByKey } from './nest.js';
