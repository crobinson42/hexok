import type { ActorSpec } from '../factory.js';

type InputValidationGuardParameters = {
  readonly spec: ActorSpec;
  readonly input: unknown;
};

/**
 * Rejects an input that fails the use case's schema.
 * The method still receives the original argument.
 */
export function inputValidationGuard(
  call: InputValidationGuardParameters,
): void {
  if (call.spec.input) {
    const result = call.spec.input.safeParse(call.input);
    if (!result.success) {
      throw new Error(`Input validation failed: ${result.error.message}`);
    }
  }
}
