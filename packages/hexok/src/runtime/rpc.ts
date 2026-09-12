import type {
  UseCaseBag,
  UseCaseContract,
  UseCaseRoute,
} from '../app/index.js';
import { nestByKey } from '../app/index.js';

/** Dotted use-case key to HTTP path (`incident.close` → `/rpc/incident/close`). */
export function rpcPath(key: string): string {
  return `/rpc/${key.split('.').join('/')}`;
}

/** One API route with a POST path under `/rpc`. */
export type RpcRoute = UseCaseRoute & {
  /** Always `POST`. */
  method: 'POST';
  /** `/rpc/...` path derived from the use-case key. */
  path: string;
};

type ApiKey<C> = C extends { trigger: 'api'; internal: true }
  ? never
  : C extends { trigger: 'api'; key: infer Key extends string }
    ? Key
    : never;

type KeysOf<Bag> = { [K in keyof Bag]: ApiKey<Bag[K]> }[keyof Bag];

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

type NestedRpc<Bag> = UnionToIntersection<
  KeysOf<Bag> extends infer Key
    ? Key extends string
      ? PathTo<Key, RpcRoute>
      : never
    : never
>;

/** Flat `routes` plus nested keys (`rpc.incident.close.path`). */
export type RpcContract<Bag extends UseCaseBag = UseCaseBag> = {
  /** Routes keyed by use-case `key`. */
  routes: { [K in Extract<KeysOf<Bag>, string>]: RpcRoute };
} & NestedRpc<Bag>;

/** Attach `POST /rpc/...` paths to each API route and nest by use-case key. */
export function deriveRpc<Bag extends UseCaseBag = UseCaseBag>(
  contract: UseCaseContract,
): RpcContract<Bag> {
  const routes: Record<string, RpcRoute> = {};
  for (const [key, route] of Object.entries(contract.routes)) {
    routes[key] = { ...route, method: 'POST', path: rpcPath(route.key) };
  }
  return Object.assign(nestByKey(Object.entries(routes)), {
    routes,
  }) as RpcContract<Bag>;
}
