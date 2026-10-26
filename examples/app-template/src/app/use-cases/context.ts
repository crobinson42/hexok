import {
  type StandardSchemaV1,
  UseCase,
  validate,
  validationError,
} from 'hexok';
import { DomainError } from '../../domain/errors/domain.js';

/** Context for use cases under `api/`. HTTP builds this from the request. */
export type ApiCtx = {
  authToken?: string;
};

/** Each API use case declares the schema of its `execute` input. */
export type ApiSpec = {
  input: StandardSchemaV1;
};

/**
 * Reject input the declared schema does not accept, before `execute` runs.
 * The schema checks shape. Business rules stay in `execute`. `execute`
 * receives the caller's input, not the parsed value, so schemas do not use
 * defaults or transforms.
 */
function validInputGuard({
  spec,
  token,
  input,
}: {
  spec: ApiSpec;
  token: string;
  input: unknown;
}): void {
  const parsed = validate(spec.input, input);
  if (!parsed.ok) {
    throw validationError(`${token} input is invalid`, parsed.issues);
  }
}

/** Token is optional. This template does not check it. */
export const ApiUseCase = UseCase.context<ApiCtx, ApiSpec>().guard(
  validInputGuard,
);

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
