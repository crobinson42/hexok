import type { Actor } from '@hexok/authz';
import {
  type StandardSchemaV1,
  UseCase,
  validate,
  validationError,
} from 'hexok';

/**
 * Context for use cases under `api/`. HTTP builds this from the `x-actor`
 * header. Every call has an actor. A missing header never reaches `execute`.
 */
export type ApiCtx = {
  actor: Actor;
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

export const ApiUseCase = UseCase.context<ApiCtx, ApiSpec>().guard(
  validInputGuard,
);
