import type { Authz, Tuple } from '@hexok/authz';
import type { catalog } from '../authz/catalog.js';

/** Write one tuple. When the write throws, run `undo` and throw the same error. */
export async function writeTuple(
  authz: Authz<typeof catalog>,
  tuple: Tuple,
  undo: () => Promise<void>,
): Promise<void> {
  try {
    await authz.write(tuple);
  } catch (error) {
    await undo();
    throw error;
  }
}
