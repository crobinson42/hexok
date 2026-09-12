import type { UseCaseBag } from '../app/index.js';
import type { PathTo, UnionToIntersection } from '../app/nest.js';
import type { Infer, StandardSchemaV1 } from '../core/index.js';

type ExternalCall<C, Ctx> = C extends {
  input: infer Input extends StandardSchemaV1;
  output: infer Output extends StandardSchemaV1;
}
  ? (
      input: Infer<Input>,
      opts?: { ctx?: Ctx; signal?: AbortSignal },
    ) => Promise<Infer<Output>>
  : never;

/**
 * In-process client nested by use-case key. Event and internal use cases are omitted.
 */
export type NestedClient<Bag extends UseCaseBag, Ctx> = UnionToIntersection<
  {
    [K in keyof Bag]: Bag[K] extends {
      trigger: 'external';
      key: infer Id extends string;
    }
      ? PathTo<Id, ExternalCall<Bag[K], Ctx>>
      : never;
  }[keyof Bag]
>;
