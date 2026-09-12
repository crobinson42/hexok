import type {
  CatalogEntry,
  UseCaseBag,
  UseCaseContract,
} from '../app/index.js';
import { nestByKey } from '../app/index.js';
import type { PathTo, UnionToIntersection } from '../app/nest.js';
import type { ExternalKeysOf } from '../app/types.js';

/** Dotted use-case key to HTTP path (`incident.close` → `/rpc/incident/close`). */
export function rpcPath(key: string): string {
  return `/rpc/${key.split('.').join('/')}`;
}

/** One API route with a POST path under `/rpc`. */
export type RpcRoute = CatalogEntry & {
  /** Always `POST`. */
  method: 'POST';
  /** `/rpc/...` path derived from the use-case key. */
  path: string;
};

type NestedRpc<Bag> = UnionToIntersection<
  ExternalKeysOf<Bag> extends infer Key
    ? Key extends string
      ? PathTo<Key, RpcRoute>
      : never
    : never
>;

/** Flat `routes` plus nested keys (`rpc.incident.close.path`). */
export type RpcContract<Bag extends UseCaseBag = UseCaseBag> = {
  /** Routes keyed by use-case `key`. */
  routes: { [K in Extract<ExternalKeysOf<Bag>, string>]: RpcRoute };
} & NestedRpc<Bag>;

/** Attach `POST /rpc/...` paths to each external catalog entry and nest by use-case key. */
export function deriveRpc<Bag extends UseCaseBag = UseCaseBag>(
  contract: UseCaseContract,
): RpcContract<Bag> {
  const routes: Record<string, RpcRoute> = {};
  for (const [key, entry] of Object.entries(contract.entries)) {
    routes[key] = { ...entry, method: 'POST', path: rpcPath(entry.key) };
  }
  return Object.assign(nestByKey(Object.entries(routes)), {
    routes,
  }) as RpcContract<Bag>;
}
