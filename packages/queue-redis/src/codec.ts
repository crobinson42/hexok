export function encodeJson(payload: unknown): string {
  return JSON.stringify(payload);
}

export function decodeJson(raw: string): unknown {
  return JSON.parse(raw);
}
