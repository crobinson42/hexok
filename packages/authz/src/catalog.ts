/** The action authz itself checks for administration. Every catalog includes it. */
export const MANAGE = 'access:manage';

/**
 * The product's list of actions. This entry point has no dependencies, so
 * browsers and mobile clients can import it. Literals stay narrow without
 * `as const`.
 *
 * ```ts
 * class Therms extends AccessCatalog('therms', {
 *   actions: ['scan:read', 'note:edit'],
 * }) {}
 * type Action = AccessAction<typeof Therms>;
 * ```
 */
export function AccessCatalog<
  const Token extends string,
  const Actions extends readonly string[],
>(token: Token, spec: { readonly actions: Actions }) {
  const actions = Object.freeze([
    ...new Set<string>([...spec.actions, MANAGE]),
  ]) as readonly (Actions[number] | typeof MANAGE)[];
  const known = new Set<string>(actions);

  abstract class CatalogClass {
    /** Catalog name. Literal type of the string passed to {@link AccessCatalog}. */
    static readonly token: Token = token;
    /** Every action, including {@link MANAGE}. */
    static readonly actions = actions;

    /** True when `value` is an action in this catalog. */
    static isAction(value: unknown): value is Actions[number] | typeof MANAGE {
      return typeof value === 'string' && known.has(value);
    }

    /** Keeps the known actions. A newer server cannot break an older client. */
    static parse(
      list: readonly unknown[],
    ): (Actions[number] | typeof MANAGE)[] {
      return list.filter((value) => CatalogClass.isAction(value));
    }

    /** The names in `list` that this catalog does not have. */
    static unknown(list: readonly string[]): string[] {
      return list.filter((value) => !known.has(value));
    }
  }

  return CatalogClass;
}

/** The action union of a catalog class. */
export type AccessAction<
  Catalog extends { readonly actions: readonly string[] },
> = Catalog['actions'][number];
