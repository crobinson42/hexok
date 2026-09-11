import type { UseCaseBag } from '../app/index.js';
import type { EventCatalog } from '../domain/index.js';

export type RequiredPorts<Bag extends UseCaseBag, Routed = never> =
  | {
      [K in keyof Bag]: Bag[K] extends { ports: infer P } ? P[keyof P] : never;
    }[keyof Bag]
  | ChannelPorts<Routed>;

type ChannelPorts<Routed> = Routed extends { ports: infer P }
  ? P[keyof P]
  : never;

export type RequiredCatalogs<Bag extends UseCaseBag, Routed = never> =
  | {
      [K in keyof Bag]:
        | (Bag[K] extends { publishes: readonly (infer C)[] } ? C : never)
        | (Bag[K] extends { catalog: infer C } ? C : never);
    }[keyof Bag]
  | ChannelCatalogs<Routed>;

type ChannelCatalogs<Routed> = Routed extends { catalog: infer C } ? C : never;

type RequiredChannels<Bag extends UseCaseBag> = {
  [K in keyof Bag]: Bag[K] extends { channels: readonly (infer Ch)[] }
    ? Ch
    : never;
}[keyof Bag];

type UsedByPort<Bag extends UseCaseBag, Routed, Token> =
  | {
      [K in keyof Bag]: Bag[K] extends {
        ports: infer P;
        key: infer Id extends string;
      }
        ? Token extends P[keyof P]
          ? Id
          : never
        : never;
    }[keyof Bag]
  | ChannelUsedByPort<Routed, Token>;

type ChannelUsedByPort<Routed, Token> = Routed extends {
  ports: infer P;
  catalog: EventCatalog<infer Key extends string>;
}
  ? Token extends P[keyof P]
    ? Key
    : never
  : never;

type UsedByCatalog<Bag extends UseCaseBag, Routed, Cat> =
  | {
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
    }[keyof Bag]
  | ChannelUsedByCatalog<Routed, Cat>;

type ChannelUsedByCatalog<Routed, Cat> = Routed extends { catalog: infer C }
  ? Cat extends C
    ? 'channel'
    : never
  : never;

type UsedByChannel<Bag extends UseCaseBag, Ch> = {
  [K in keyof Bag]: Bag[K] extends {
    channels: readonly (infer C)[];
    key: infer Id extends string;
  }
    ? Ch extends C
      ? Id
      : never
    : never;
}[keyof Bag];

type PortAlias<Bag extends UseCaseBag, Routed, Token> =
  | {
      [K in keyof Bag]: Bag[K] extends { ports: infer P }
        ? {
            [A in keyof P]: [P[A]] extends [Token]
              ? [Token] extends [P[A]]
                ? A & string
                : never
              : never;
          }[keyof P]
        : never;
    }[keyof Bag]
  | ChannelPortAlias<Routed, Token>;

type ChannelPortAlias<Routed, Token> = Routed extends { ports: infer P }
  ? {
      [A in keyof P]: [P[A]] extends [Token]
        ? [Token] extends [P[A]]
          ? A & string
          : never
        : never;
    }[keyof P]
  : never;

type PortDisplayName<Bag extends UseCaseBag, Routed, Token> = JoinUnion<
  PortAlias<Bag, Routed, Token>
>;

type CatalogKeyOf<T> =
  T extends EventCatalog<
    infer Key extends string,
    infer _Kind,
    infer _Events,
    infer _Ctx
  >
    ? Key
    : 'unknown';

type CatalogKeyOfChannel<T> = T extends {
  catalog: EventCatalog<
    infer Key extends string,
    infer _Kind,
    infer _Events,
    infer _Ctx
  >;
}
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

type MissingPortMessages<Bag extends UseCaseBag, Provided, Routed> =
  Exclude<RequiredPorts<Bag, Routed>, Provided> extends infer T
    ? T extends unknown
      ? `hexok: unprovided port "${PortDisplayName<Bag, Routed, T>}" (used by ${JoinUnion<UsedByPort<Bag, Routed, T>>}). Call .provide(token, impl) before .build()`
      : never
    : never;

type MissingCatalogMessages<Bag extends UseCaseBag, Bound, Routed> =
  Exclude<RequiredCatalogs<Bag, Routed>, Bound> extends infer T
    ? T extends unknown
      ? `hexok: unbound catalog "${CatalogKeyOf<T>}" (used by ${JoinUnion<UsedByCatalog<Bag, Routed, T>>}). Call .bind(...) before .build()`
      : never
    : never;

type MissingChannelMessages<Bag extends UseCaseBag, Routed> =
  Exclude<RequiredChannels<Bag>, Routed> extends infer T
    ? T extends unknown
      ? `hexok: unrouted channel "${CatalogKeyOfChannel<T>}" (used by ${JoinUnion<UsedByChannel<Bag, T>>}). Call .route(...) before .build()`
      : never
    : never;

export type MissingMessages<
  Bag extends UseCaseBag,
  Provided,
  Bound,
  Routed = never,
> =
  | MissingPortMessages<Bag, Provided, Routed>
  | MissingCatalogMessages<Bag, Bound, Routed>
  | MissingChannelMessages<Bag, Routed>;

export type DuplicatePortError = `hexok: port already provided`;

export type DuplicateCatalogError<N extends string = string> = string extends N
  ? `hexok: catalog already bound`
  : `hexok: catalog "${N}" already bound`;

export type DuplicateChannelError<N extends string = string> = string extends N
  ? `hexok: channel already routed`
  : `hexok: catalog "${N}" already routed`;

export type ChannelKindError<
  Key extends string = string,
  Kind extends string = string,
> = `hexok: channel catalog "${Key}" is kind "${Kind}". Channels require a bus catalog.`;
