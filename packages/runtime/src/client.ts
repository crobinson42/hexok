import type { UseCaseBag } from '@plinth/app';
import type { Infer, StandardSchemaV1 } from '@plinth/core';

type PathTo<Path extends string, V> = Path extends `${infer Head}.${infer Rest}`
  ? { readonly [K in Head]: PathTo<Rest, V> }
  : { readonly [K in Path]: V };

type UnionToIntersection<U> = (
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
  : never;

type ApiCall<C, Ctx> = C extends {
  input: infer Input extends StandardSchemaV1;
  output: infer Output extends StandardSchemaV1;
}
  ? (
      input: Infer<Input>,
      opts?: { ctx?: Ctx; signal?: AbortSignal },
    ) => Promise<Infer<Output>>
  : never;

/**
 * In-process client nested by use-case key. Event handlers are omitted.
 */
export type NestedClient<Bag extends UseCaseBag, Ctx> = UnionToIntersection<
  {
    [K in keyof Bag]: Bag[K] extends {
      trigger: 'api';
      key: infer Id extends string;
    }
      ? PathTo<Id, ApiCall<Bag[K], Ctx>>
      : never;
  }[keyof Bag]
>;
