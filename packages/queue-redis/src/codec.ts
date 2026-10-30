export function encodeJson(payload: unknown): string {
  return JSON.stringify(payload);
}

/** `JSON.parse`. The error does not include the text. Node quotes the start of it. */
export function decodeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('queue: entry is not JSON');
  }
}
