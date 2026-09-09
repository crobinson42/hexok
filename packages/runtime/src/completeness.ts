import type { UseCaseBag } from '@plinth/app';

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
    id: infer Id extends string;
  }
    ? Token extends P[keyof P]
      ? Id
      : never
    : never;
}[keyof Bag];

type UsedByCatalog<Bag extends UseCaseBag, Cat> = {
  [K in keyof Bag]: Bag[K] extends { id: infer Id extends string }
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

type MissingPortMessages<Bag extends UseCaseBag, Provided> =
  Exclude<RequiredPorts<Bag>, Provided> extends infer T
    ? T extends unknown
      ? `plinth: unprovided port (used by ${UsedByPort<Bag, T>})`
      : never
    : never;

type MissingCatalogMessages<Bag extends UseCaseBag, Bound> =
  Exclude<RequiredCatalogs<Bag>, Bound> extends infer T
    ? T extends unknown
      ? `plinth: unbound catalog (used by ${UsedByCatalog<Bag, T>})`
      : never
    : never;

export type MissingMessages<Bag extends UseCaseBag, Provided, Bound> =
  | MissingPortMessages<Bag, Provided>
  | MissingCatalogMessages<Bag, Bound>;

export type DuplicatePortError = `plinth: port already provided`;

export type DuplicateCatalogError = `plinth: catalog already bound`;

export type RequireCapabilityMessage<
  Name extends string,
  Cap extends string,
> = `plinth: ${Name} is ${Cap} but the adapter does not implement ${Cap}`;
