import type { ErrorMap, StandardSchemaV1 } from '@plinth/core';
import { isApiUseCase, type UseCaseBag, type UseCaseClass } from './types.js';

export type RpcRoute = {
  id: string;
  method: 'POST';
  path: string;
  input: StandardSchemaV1;
  output: StandardSchemaV1;
  errors: ErrorMap;
};

export type RpcContract = {
  routes: Record<string, RpcRoute>;
};

type ApiId<C> = C extends { trigger: 'api'; id: infer Id extends string }
  ? Id
  : never;

type IdsOf<Bag> = { [K in keyof Bag]: ApiId<Bag[K]> }[keyof Bag];

type UseCaseWithId<Bag, Id> = Extract<
  Bag[keyof Bag],
  { trigger: 'api'; id: Id }
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
  id: infer Id extends string;
  input: infer Input;
  output: infer Output;
  errors: infer Errors;
}
  ? {
      readonly id: Id;
      readonly method: 'POST';
      readonly input: Input;
      readonly output: Output;
      readonly errors: Errors;
    }
  : never;

/**
 * Nested by use-case `id` (`incident.close` → `{ incident: { close } }`).
 * Event use cases are omitted.
 */
export type DerivedContract<Bag> = UnionToIntersection<
  IdsOf<Bag> extends infer Id
    ? Id extends string
      ? PathTo<Id, RouteView<UseCaseWithId<Bag, Id>>>
      : never
    : never
>;

export function rpcPath(id: string): string {
  return `/rpc/${id.split('.').join('/')}`;
}

/**
 * Build the RPC contract from a use-case class list.
 * Duplicate `id` throws. Event use cases are skipped.
 */
export function deriveContract(useCases: UseCaseBag): RpcContract {
  const routes: Record<string, RpcRoute> = {};
  for (const ctor of Object.values(useCases) as UseCaseClass[]) {
    if (!isApiUseCase(ctor)) continue;
    if (routes[ctor.id] !== undefined) {
      throw new Error(`plinth: duplicate use-case id "${ctor.id}"`);
    }
    routes[ctor.id] = {
      id: ctor.id,
      method: 'POST',
      path: rpcPath(ctor.id),
      input: ctor.input,
      output: ctor.output,
      errors: ctor.errors,
    };
  }
  return { routes };
}

export function nestById<V>(
  entries: Iterable<[string, V]>,
): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  for (const [id, value] of entries) {
    const parts = id.split('.');
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (key === undefined) continue;
      const existing = cursor[key];
      if (existing === undefined || typeof existing !== 'object') {
        const next: Record<string, unknown> = Object.create(null);
        cursor[key] = next;
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
