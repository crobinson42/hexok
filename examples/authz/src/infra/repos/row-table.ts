type Stored = { readonly id: string };

type Row<P extends Stored> = {
  readonly props: { readonly id: string };
  toProps(): P;
  commit(): void;
};

/** In-memory rows. `listByIds` keeps the id order it is given and skips gaps. */
export function rowTable<P extends Stored, E extends Row<P>>(
  restore: (props: P) => E,
) {
  const rows = new Map<string, P>();

  function get(id: string): E | null {
    const props = rows.get(id);
    if (props === undefined) return null;
    return restore(props);
  }

  return {
    get,
    save(entity: E): void {
      rows.set(entity.props.id, entity.toProps());
      entity.commit();
    },
    delete(id: string): void {
      rows.delete(id);
    },
    listByIds(ids: readonly string[]): E[] {
      const found: E[] = [];
      for (const id of ids) {
        const row = get(id);
        if (row !== null) found.push(row);
      }
      return found;
    },
  };
}
