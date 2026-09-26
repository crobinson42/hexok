import { validationError } from './coded-error.js';
import {
  type InferSchema,
  type ResolvedSchema,
  type SchemaSource,
  schemaDefinition,
} from './schema.js';
import type { StandardSchemaV1 } from './standard-schema.js';
import { validate } from './validate.js';

/** Instance type of a constructor. Raw schemas have no prototype, so this is `never`. */
type PrototypeOf<T> = T extends { readonly prototype: infer P } ? P : never;

/**
 * Entity instances expose `props` and `toProps`.
 * A missing prototype is `never`, and `never extends …` is true, so raw schemas are excluded.
 */
type IsEntity<T> = [PrototypeOf<T>] extends [never]
  ? false
  : PrototypeOf<T> extends {
        readonly props: object;
        toProps(): unknown;
      }
    ? true
    : false;

/** Value `fromSource` receives and `fromModel` returns. */
type SourceModel<T> =
  IsEntity<T> extends true
    ? PrototypeOf<T>
    : T extends SchemaSource
      ? InferSchema<T>
      : never;

/** Draft `toSource` returns. Entities yield props; the kit builds the instance. */
type SourceDraft<T> =
  IsEntity<T> extends true
    ? T extends { readonly schema: infer S extends SchemaSource }
      ? InferSchema<S>
      : never
    : T extends SchemaSource
      ? InferSchema<T>
      : never;

type SourceKind = 'entity' | 'schema' | 'raw';

const sourceKindKey: unique symbol = Symbol('hexok.mapper.source');
const validateKey: unique symbol = Symbol('hexok.mapper.validate');

type MapperOptions = {
  readonly validate?: boolean;
};

type RuntimeStatics = {
  readonly token: string;
  readonly schema: StandardSchemaV1;
  readonly source: unknown;
  readonly [sourceKindKey]: SourceKind;
  readonly [validateKey]: boolean;
};

/**
 * Instance base of {@link Mapper}. Exported so declaration emit can name it.
 * An anonymous base cannot publish protected `fromSource` or `toSource` (TS4094).
 * Extend {@link Mapper}, not this class.
 */
export abstract class MapperClass<
  Token extends string,
  Source,
  Stored extends SchemaSource,
> {
  /** Mapper name. Literal type of the string passed to {@link Mapper}. */
  static readonly token: string;
  /** Stored Standard Schema. A Schema class is stored as its definition. */
  static readonly schema: StandardSchemaV1;
  /** Entity, Schema class, or Standard Schema this mapper reads and builds. */
  static readonly source: unknown;
  /** Nominal marker. Each `Mapper(...)` call is a distinct class. */
  readonly #brand: Token;

  protected constructor(brand: Token) {
    this.#brand = brand;
    void this.#brand;
  }

  /**
   * Source to an unchecked model draft.
   * An entity source receives the instance. A schema source receives its output.
   */
  protected abstract fromSource(source: SourceModel<Source>): unknown;

  /**
   * Model output to a source draft.
   * An entity draft is props. A schema draft is that schema's output.
   */
  protected abstract toSource(model: InferSchema<Stored>): SourceDraft<Source>;

  /**
   * Run `fromSource`. With `{ validate: true }`, check the draft against the model schema.
   * A failure throws `CodedError` `VALIDATION` using this mapper's token.
   * Do not override.
   */
  toModel(
    source: SourceModel<Source>,
    options?: MapperOptions,
  ): InferSchema<Stored> {
    const ctor = runtimeOf(this);
    const draft = this.fromSource(source);
    if (!checking(ctor, options)) return draft as InferSchema<Stored>;
    const parsed = validate(ctor.schema, draft);
    if (!parsed.ok) {
      throw validationError(
        `hexok: ${ctor.token} validation failed`,
        parsed.issues,
      );
    }
    return parsed.value as InferSchema<Stored>;
  }

  /**
   * Run `toSource` and build the source.
   * With `{ validate: true }`, check `value` against the model schema first.
   * An entity is then `parse`d. Otherwise an entity is `restore`d.
   * Do not override.
   */
  fromModel(value: unknown, options?: MapperOptions): SourceModel<Source> {
    const ctor = runtimeOf(this);
    const check = checking(ctor, options);
    const model = check ? modelOutput(ctor, value) : value;
    return buildSource(
      ctor[sourceKindKey],
      ctor.source,
      ctor.token,
      this.toSource(model as InferSchema<Stored>),
      check,
    ) as SourceModel<Source>;
  }
}

type MapperCtor<
  Token extends string,
  Source,
  Stored extends SchemaSource,
> = (abstract new () => MapperClass<Token, Source, Stored>) & {
  readonly token: Token;
  readonly schema: ResolvedSchema<Stored>;
  readonly source: Source;
};

/**
 * Persistence translator. An adapter maps the source a port speaks — an
 * entity, a Schema class, or a Standard Schema — to the shape that adapter
 * stores. Domain code does not import the stored schema. The mapper is
 * stateless; do not `commit()` inside it. The adapter commits after the
 * driver succeeds.
 *
 * The subclass writes `fromSource` and `toSource`. Adapters call `toModel` and
 * `fromModel` and do not override them. Checks are off. Pass
 * `{ validate: true }` to the factory or to a call to run the model schema.
 * A checked `fromModel` uses `parse`. The default restores an entity.
 *
 * ```ts
 * class MongoUser extends Mapper('mongo.User', User, mongoUserSchema) {
 *   protected fromSource(user: User) {
 *     const props = user.toProps()
 *     const [lat, lng] = props.location
 *     return {
 *       _id: props.id,
 *       name: props.name,
 *       location: { type: 'Point' as const, coordinates: [lng, lat] },
 *     }
 *   }
 *
 *   protected toSource(doc: MongoUserDoc) {
 *     const [lng, lat] = doc.location.coordinates
 *     return { id: doc._id, name: doc.name, location: [lat, lng] }
 *   }
 * }
 * ```
 */
export function Mapper<
  const Token extends string,
  Source,
  Stored extends SchemaSource,
>(
  token: Token,
  source: Source,
  storedSchema: Stored,
  options?: MapperOptions,
): MapperCtor<Token, Source, Stored> {
  const kind = sourceKind(token, source);
  const stored = schemaDefinition(storedSchema);
  const check = options?.validate === true;

  abstract class Runtime extends MapperClass<Token, Source, Stored> {
    static readonly token: Token = token;
    static readonly schema: ResolvedSchema<Stored> = stored;
    static readonly source: Source = source;
    static readonly [sourceKindKey]: SourceKind = kind;
    static readonly [validateKey]: boolean = check;

    constructor() {
      super(token);
    }
  }

  return Runtime;
}

function checking(
  ctor: RuntimeStatics,
  options: MapperOptions | undefined,
): boolean {
  return options?.validate ?? ctor[validateKey];
}

function modelOutput(ctor: RuntimeStatics, value: unknown): unknown {
  const parsed = validate(ctor.schema, value);
  if (!parsed.ok) {
    throw validationError(
      `hexok: ${ctor.token} validation failed`,
      parsed.issues,
    );
  }
  return parsed.value;
}

function runtimeOf(instance: object): RuntimeStatics {
  return instance.constructor as unknown as RuntimeStatics;
}

function sourceKind(token: string, source: unknown): SourceKind {
  if (isObjectLike(source)) {
    if (isEntitySource(source)) return 'entity';
    if (isSchemaClassSource(source)) return 'schema';
    if (isStandardSchema(source)) return 'raw';
  }
  throw new Error(`hexok: ${token} source is not an entity or a schema`);
}

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== 'object' || value === null || !('~standard' in value)) {
    return false;
  }
  const standard = value['~standard'];
  return typeof standard === 'object' && standard !== null;
}

function isEntitySource(value: object): boolean {
  if (
    !('create' in value) ||
    !('restore' in value) ||
    !('parse' in value) ||
    !('schema' in value)
  ) {
    return false;
  }
  return (
    typeof value.create === 'function' &&
    typeof value.restore === 'function' &&
    typeof value.parse === 'function' &&
    isStandardSchema(value.schema)
  );
}

function isSchemaClassSource(value: object): boolean {
  if (!('definition' in value) || !('parse' in value)) return false;
  return (
    typeof value.parse === 'function' && isStandardSchema(value.definition)
  );
}

function buildSource(
  kind: SourceKind,
  source: unknown,
  token: string,
  draft: unknown,
  check: boolean,
): unknown {
  if (!check) {
    if (kind === 'entity') {
      return (source as { restore(value: unknown): unknown }).restore(draft);
    }
    return draft;
  }
  if (kind === 'raw') {
    const parsed = validate(source as StandardSchemaV1, draft);
    if (!parsed.ok) {
      throw validationError(`hexok: ${token} validation failed`, parsed.issues);
    }
    return parsed.value;
  }
  return (source as { parse(value: unknown): unknown }).parse(draft);
}
