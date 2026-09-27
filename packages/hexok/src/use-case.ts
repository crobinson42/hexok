import { validationError } from './coded-error.js';
import {
  type InferSchema,
  type SchemaSource,
  schemaDefinition,
} from './schema.js';
import { validate } from './validate.js';

/**
 * Application service. Pass ports through the constructor.
 * `execute` is required; the compiler errors on the class when it is missing.
 * Declare the input and output on `execute` — those are the types callers see.
 * A refusal throws an {@link Errors} catalog member. The application catches it.
 *
 * ```ts
 * class CreateUser extends UseCase('user.create') {
 *   constructor(private readonly users: UserRepository) { super() }
 *   async execute(input: { email: string }): Promise<{ id: string }> {
 *     return { id: input.email }
 *   }
 * }
 * ```
 */
export function UseCase<const Token extends string>(token: Token) {
  abstract class UseCaseClass {
    /** Use-case name. Literal type of the string passed to {@link UseCase}. */
    static readonly token: Token = token;
    /** Nominal marker. Each `UseCase(...)` call is a distinct class. */
    readonly #brand = true;

    protected constructor() {
      void this.#brand;
    }

    /**
     * Required. Annotate `input` and the return type on the subclass;
     * callers of the subclass see those types.
     */
    abstract execute(input: unknown): Promise<unknown>;
  }

  return UseCaseClass;
}

type ReservedKey = 'token' | 'prototype' | 'name' | 'length';

/** A bag that uses a reserved class static fails on that property. */
type ReservedOk<S> = {
  [K in keyof S]: K extends ReservedKey ? never : S[K];
};

type NoStatics = Record<never, never>;

type CommandOf<S> = S extends { readonly input: infer I extends SchemaSource }
  ? InferSchema<I>
  : unknown;

/** Static bag minus names that would overwrite the class constructor. */
type Statics<S> = Omit<S, ReservedKey>;

const RESERVED_STATICS: ReadonlySet<string> = new Set([
  'token',
  'prototype',
  'name',
  'length',
]);

/**
 * Family of use cases that receive a caller context on `execute`.
 * Returns a factory: a token, or a token and statics when `Spec` has keys.
 * `execute` is required; annotate it on the subclass — callers see those types.
 * A guard and an input schema, when set, run before that method.
 * Other statics are application data copied onto the class.
 *
 * ```ts
 * const ApiUseCase = UseCase.context<
 *   ApiContext,
 *   { input: StandardSchemaV1; permission: string }
 * >({
 *   guard(ctx, spec) {
 *     if (ctx.sessionId.length < 1 || spec.permission.length < 1) {
 *       throw new Error('unauthorized')
 *     }
 *   },
 * })
 *
 * class FindUsers extends ApiUseCase('user.find', {
 *   input: z.object({ query: z.string() }),
 *   permission: 'users.read',
 * }) {
 *   constructor(private readonly users: UserRepository) { super() }
 *   async execute(
 *     ctx: ApiContext,
 *     input: InferSchema<(typeof FindUsers)['input']>,
 *   ): Promise<User[]> {
 *     return this.users.search(input.query)
 *   }
 * }
 * ```
 */
export namespace UseCase {
  export function context<Ctx, Spec = NoStatics>(options?: {
    guard?: ContextGuard<Ctx, Spec>;
  }) {
    const guard = options?.guard;

    return function family<
      const Token extends string,
      const S extends [keyof Spec] extends [never] ? NoStatics : Spec,
    >(
      token: Token,
      ...args: [keyof Spec] extends [never]
        ? []
        : [statics: ReservedOk<S> & Spec]
    ) {
      // Conditional rest tuple: index 0 is the statics bag, or absent.
      const statics = bagOf(args as readonly unknown[]);
      const inputSchema = schemaSourceOf(statics);
      const spec = (statics ?? {}) as Spec;

      abstract class Runtime {
        /** Use-case name. Literal type of the string passed to the factory. */
        static readonly token: Token = token;
        /** Nominal marker. Each factory call is a distinct class. */
        readonly #brand = true;

        protected constructor() {
          void this.#brand;
          if (guard === undefined && inputSchema === undefined) return;
          installExecute(this, token, guard, spec, inputSchema);
        }

        /**
         * Required. Annotate `ctx`, `input`, and the return type on the subclass.
         * A guard and an input schema run before this method when they were set.
         */
        abstract execute(ctx: Ctx, input: CommandOf<S>): Promise<unknown>;
      }

      if (statics !== undefined) assignStatics(Runtime, statics);
      return Runtime as typeof Runtime &
        ([keyof Spec] extends [never] ? NoStatics : Statics<S>);
    };
  }
}

type ContextGuard<Ctx, Spec> = (
  ctx: Ctx,
  spec: NoInfer<Spec>,
) => void | Promise<void>;

function bagOf(args: readonly unknown[]): object | undefined {
  const value = args[0];
  if (typeof value !== 'object' || value === null) return undefined;
  return value;
}

function assignStatics(target: object, statics: object): void {
  const copy: Record<string, unknown> = {};
  const record = statics as Record<string, unknown>;
  for (const key of Object.keys(statics)) {
    if (RESERVED_STATICS.has(key)) continue;
    copy[key] = record[key];
  }
  Object.assign(target, copy);
}

function schemaSourceOf(statics: object | undefined): SchemaSource | undefined {
  if (statics === undefined || !('input' in statics)) return undefined;
  return isSchemaSource(statics.input) ? statics.input : undefined;
}

/** Object with `~standard`, or object/function whose `definition` has it. */
function isSchemaSource(value: unknown): value is SchemaSource {
  if (hasStandard(value)) return true;
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    !('definition' in value)
  ) {
    return false;
  }
  return hasStandard(value.definition);
}

function hasStandard(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '~standard' in value;
}

function installExecute<Ctx, Spec>(
  instance: object,
  token: string,
  guard: ContextGuard<Ctx, Spec> | undefined,
  spec: Spec,
  inputSchema: SchemaSource | undefined,
): void {
  const prototype = Object.getPrototypeOf(instance) as {
    execute: (this: object, ctx: Ctx, input: unknown) => Promise<unknown>;
  };
  // Own property would shadow this and recurse.
  const execute = prototype.execute;

  Object.defineProperty(instance, 'execute', {
    configurable: true,
    writable: true,
    value: async (ctx: Ctx, input: unknown): Promise<unknown> => {
      if (guard !== undefined) await guard(ctx, spec);
      const command =
        inputSchema === undefined
          ? input
          : parseCommand(inputSchema, token, input);
      return execute.call(instance, ctx, command);
    },
  });
}

function parseCommand(
  schema: SchemaSource,
  token: string,
  input: unknown,
): unknown {
  const parsed = validate(schemaDefinition(schema), input);
  if (!parsed.ok) {
    throw validationError(`hexok: ${token} validation failed`, parsed.issues);
  }
  return parsed.value;
}
