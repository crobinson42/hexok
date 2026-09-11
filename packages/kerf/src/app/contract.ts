import type { ErrorMap, StandardSchemaV1 } from '../core/index.js';
import { isApiUseCase, type UseCaseBag, type UseCaseClass } from './types.js';

export type UseCaseRoute = {
  key: string;
  input: StandardSchemaV1;
  output: StandardSchemaV1;
  errors: ErrorMap;
};

export type UseCaseContract = {
  routes: Record<string, UseCaseRoute>;
};

type ApiKey<C> = C extends { trigger: 'api'; internal: true }
  ? never
  : C extends { trigger: 'api'; key: infer Key extends string }
    ? Key
    : never;

type KeysOf<Bag> = { [K in keyof Bag]: ApiKey<Bag[K]> }[keyof Bag];

type UseCaseWithKey<Bag, Key> = Extract<
  Exclude<Bag[keyof Bag], { trigger: 'api'; internal: true }>,
  { trigger: 'api'; key: Key }
>;

type PathTo<Path extends string, V> = Path extends `${infer Head}.${infer Rest}`
  ? { readonly [K in Head]: PathTo<Rest, V> }
  : { readonly [K in Path]: V };

type UnionToIntersection<U> = (
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
  : never;

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
 * Event use cases are omitted.
 */
export type DerivedContract<Bag> = UnionToIntersection<
  KeysOf<Bag> extends infer Key
    ? Key extends string
      ? PathTo<Key, RouteView<UseCaseWithKey<Bag, Key>>>
      : never
    : never
>;

/**
 * Build a transport-neutral catalog from a use-case class list.
 * Duplicate `key` throws. Event use cases and `internal: true` are skipped.
 */
export function deriveContract(useCases: UseCaseBag): UseCaseContract {
  const routes: Record<string, UseCaseRoute> = {};
  const seen = new Set<string>();
  for (const ctor of Object.values(useCases) as UseCaseClass[]) {
    if (!isApiUseCase(ctor)) continue;
    if (seen.has(ctor.key)) {
      throw new Error(`kerf: duplicate use-case key "${ctor.key}"`);
    }
    seen.add(ctor.key);
    if (ctor.internal) continue;
    routes[ctor.key] = {
      key: ctor.key,
      input: ctor.input,
      output: ctor.output,
      errors: ctor.errors,
    };
  }
  return { routes };
}

export function nestByKey<V>(
  entries: Iterable<[string, V]>,
): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  for (const [key, value] of entries) {
    const parts = key.split('.');
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      const existing = cursor[part];
      if (existing === undefined || typeof existing !== 'object') {
        const next: Record<string, unknown> = Object.create(null);
        cursor[part] = next;
        cursor = next;
      } else {
        cursor = existing as Record<string, unknown>;
      }
    }
    const last = parts[parts.length - 1];
    if (last === undefined) continue;
    cursor[last] = value;
  }
  return root;
}
