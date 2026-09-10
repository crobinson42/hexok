import type { UseCaseBag } from '@plinth/app';
import type { EventCatalog, PortToken } from '@plinth/domain';

export type RequiredPorts<Bag extends UseCaseBag> = {
  [K in keyof Bag]: Bag[K] extends { ports: infer P } ? P[keyof P] : never;
}[keyof Bag];

export type RequiredCatalogs<Bag extends UseCaseBag> = {
  [K in keyof Bag]:
    | (Bag[K] extends { publishes: readonly (infer C)[] } ? C : never)
    | (Bag[K] extends { catalog: infer C } ? C : never);
}[keyof Bag];

type UsedByPort<Bag extends UseCaseBag, Token> = {
  [K in keyof Bag]: Bag[K] extends {
    ports: infer P;
    key: infer Id extends string;
  }
    ? Token extends P[keyof P]
      ? Id
      : never
    : never;
}[keyof Bag];

type UsedByCatalog<Bag extends UseCaseBag, Cat> = {
  [K in keyof Bag]: Bag[K] extends { key: infer Id extends string }
    ?
        | (Bag[K] extends { publishes: readonly (infer C)[] }
            ? Cat extends C
              ? Id
              : never
            : never)
        | (Bag[K] extends { catalog: infer C }
            ? Cat extends C
              ? Id
              : never
            : never)
    : never;
}[keyof Bag];

type LiteralPortKey<T> =
  T extends PortToken<unknown, infer Key extends string>
    ? string extends Key
      ? never
      : Key
    : never;

type PortAlias<Bag extends UseCaseBag, Token> = {
  [K in keyof Bag]: Bag[K] extends { ports: infer P }
    ? {
        [A in keyof P]: [P[A]] extends [Token]
          ? [Token] extends [P[A]]
            ? A & string
            : never
          : never;
      }[keyof P]
    : never;
}[keyof Bag];

type PortDisplayName<Bag extends UseCaseBag, Token> =
  LiteralPortKey<Token> extends infer N
    ? [N] extends [never]
      ? JoinUnion<PortAlias<Bag, Token>>
      : N & string
    : JoinUnion<PortAlias<Bag, Token>>;

type CatalogKeyOf<T> =
  T extends EventCatalog<infer Key extends string, infer _Kind, infer _Events>
    ? Key
    : 'unknown';

type UnionToIntersection<U> = (
  U extends unknown
    ? (x: U) => void
    : never
) extends (x: infer I) => void
  ? I
  : never;

type LastOf<U> =
  UnionToIntersection<U extends unknown ? (x: U) => void : never> extends (
    x: infer L,
  ) => void
    ? L
    : never;

/** Collapse `'a' | 'b'` into `'a, b'` so one missing port is one message. */
type JoinUnion<U extends string> = [U] extends [never]
  ? never
  : LastOf<U> extends infer L extends string
    ? Exclude<U, L> extends infer Rest extends string
      ? [Rest] extends [never]
        ? L
        : `${JoinUnion<Rest>}, ${L}`
      : L
    : never;

type ProvideHint<T> =
  LiteralPortKey<T> extends infer N
    ? [N] extends [never]
      ? 'Call .provide(token, impl) before .build()'
      : `Call .provide(${N & string}, impl) before .build()`
    : 'Call .provide(token, impl) before .build()';

type MissingPortMessages<Bag extends UseCaseBag, Provided> =
  Exclude<RequiredPorts<Bag>, Provided> extends infer T
    ? T extends unknown
      ? `plinth: unprovided port "${PortDisplayName<Bag, T>}" (used by ${JoinUnion<UsedByPort<Bag, T>>}). ${ProvideHint<T>}`
      : never
    : never;

type MissingCatalogMessages<Bag extends UseCaseBag, Bound> =
  Exclude<RequiredCatalogs<Bag>, Bound> extends infer T
    ? T extends unknown
      ? `plinth: unbound catalog "${CatalogKeyOf<T>}" (used by ${JoinUnion<UsedByCatalog<Bag, T>>}). Call .bind(...) before .build()`
      : never
    : never;

export type MissingMessages<Bag extends UseCaseBag, Provided, Bound> =
  | MissingPortMessages<Bag, Provided>
  | MissingCatalogMessages<Bag, Bound>;

export type DuplicatePortError<N extends string = string> = string extends N
  ? `plinth: port already provided`
  : `plinth: port "${N}" already provided`;

export type DuplicateCatalogError<N extends string = string> = string extends N
  ? `plinth: catalog already bound`
  : `plinth: catalog "${N}" already bound`;
