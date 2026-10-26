import { normalizeFailure } from './normalize.js';
import type { QuarantineInput } from './quarantine.js';

export async function parkOnThrow<T>(
  quarantine: {
    park(input: QuarantineInput): Promise<{ id: string }>;
  },
  record: Omit<QuarantineInput, 'error' | 'occurredAt'>,
  run: () => Promise<T>,
  onParkError?: (error: unknown) => void,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    try {
      await quarantine.park({
        ...record,
        error: normalizeFailure(error),
        occurredAt: new Date(),
      });
    } catch (parkError) {
      onParkError?.(parkError);
    }
    throw error;
  }
}
