import type { UseCaseContract, UseCaseRoute } from '../app/index.js';

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

/** Flat RPC catalog derived from the use-case contract. */
export type RpcContract = {
  /** Routes keyed by use-case `key`. */
  routes: Record<string, RpcRoute>;
};

/** Attach `POST /rpc/...` paths to each API route in a use-case contract. */
export function deriveRpc(contract: UseCaseContract): RpcContract {
  const routes: Record<string, RpcRoute> = {};
  for (const [key, route] of Object.entries(contract.routes)) {
    routes[key] = { ...route, method: 'POST', path: rpcPath(route.key) };
  }
  return { routes };
}
