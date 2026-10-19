import { UseCase } from 'hexok';
import { DomainError } from '../errors/domain.js';

/** Context for use cases under `api/`. HTTP builds this from the request. */
export type ApiCtx = {
  authToken?: string;
};

export const ApiUseCase = UseCase.context<ApiCtx>();

/**
 * Private to this module. In-project callers receive it from `internalCall`.
 * A request body cannot construct it.
 */
const internalCaller: unique symbol = Symbol('app-template.internal');

export type InternalCtx = {
  readonly [internalCaller]: true;
};

/** Context for `internal/` and `scheduled/` use cases. */
export function internalCall(): InternalCtx {
  return { [internalCaller]: true };
}

function internalCallerGuard({ ctx }: { ctx: InternalCtx }): void {
  if (ctx[internalCaller] !== true) {
    throw DomainError.InternalCallerRequired();
  }
}

export const InternalUseCase =
  UseCase.context<InternalCtx>().guard(internalCallerGuard);
