/**
 * Vendored Standard Schema V1. Copy of https://standardschema.dev
 * so `hexok/core` has zero runtime dependencies.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** Spec bag: version, vendor, validate, optional inferred types. */
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  /** Version, vendor, `validate`, and optional input/output types. */
  export interface Props<Input = unknown, Output = Input> {
    /** Spec version. Always `1`. */
    readonly version: 1;
    /** Schema library name, e.g. `'zod'`. */
    readonly vendor: string;
    /** Parse unknown input. Hexok `validate` rejects a returned Promise. */
    readonly validate: (
      value: unknown,
    ) => Result<Output> | Promise<Result<Output>>;
    /** Present so `Infer` can read input/output. */
    readonly types?: Types<Input, Output> | undefined;
  }

  /** Success or failure from `~standard.validate`. Not hexok `Result`. */
  export type Result<Output> = SuccessResult<Output> | FailureResult;

  /** Passed validation. `issues` is absent. */
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  /** Failed validation. `issues` is always present. */
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  /** One validation problem. Hexok `validate` copies these onto the fail arm. */
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  /** Path entry when the key is not a plain PropertyKey. */
  export interface PathSegment {
    readonly key: PropertyKey;
  }

  /** Inferred input and output types carried on `~standard.types`. */
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  /** Input type of a Standard Schema. Prefer hexok `Infer` for output. */
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['input'];

  /** Output type of a Standard Schema. Same as hexok `Infer`. */
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output'];
}
