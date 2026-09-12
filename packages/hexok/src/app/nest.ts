export type PathTo<
  Path extends string,
  V,
> = Path extends `${infer Head}.${infer Rest}`
  ? { readonly [K in Head]: PathTo<Rest, V> }
  : { readonly [K in Path]: V };

export type UnionToIntersection<U> = (
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
  : never;

/** Nest dotted keys (`incident.close` → `{ incident: { close } }`). */
export function nestByKey<V>(
  entries: Iterable<[string, V]>,
): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  for (const [key, value] of entries) {
    const parts = key.split('.');
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      const existing = cursor[part];
      if (existing === undefined || typeof existing !== 'object') {
        const next: Record<string, unknown> = Object.create(null);
        cursor[part] = next;
        cursor = next;
      } else {
        cursor = existing as Record<string, unknown>;
      }
    }
    const last = parts[parts.length - 1];
    if (last === undefined) continue;
    cursor[last] = value;
  }
  return root;
}
