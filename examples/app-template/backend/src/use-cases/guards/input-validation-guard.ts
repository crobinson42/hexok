import type { ActorSpec } from '../factory.js';

/**
 * Rejects an input that fails the use case's schema.
 * The method still receives the original argument.
 */
export function inputValidationGuard({
  spec,
  input,
}: {
  spec: ActorSpec;
  input: unknown;
}): void {
  if (spec.input) {
    const result = spec.input.safeParse(input);
    if (!result.success) {
      throw new Error(`Input validation failed: ${result.error.message}`);
    }
  }
}
