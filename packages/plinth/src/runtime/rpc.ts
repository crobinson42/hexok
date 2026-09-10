import type { UseCaseContract, UseCaseRoute } from '../app/index.js';

export function rpcPath(key: string): string {
  return `/rpc/${key.split('.').join('/')}`;
}

export type RpcRoute = UseCaseRoute & {
  method: 'POST';
  path: string;
};

export type RpcContract = { routes: Record<string, RpcRoute> };

export function deriveRpc(contract: UseCaseContract): RpcContract {
  const routes: Record<string, RpcRoute> = {};
  for (const [key, route] of Object.entries(contract.routes)) {
    routes[key] = { ...route, method: 'POST', path: rpcPath(route.key) };
  }
  return { routes };
}
