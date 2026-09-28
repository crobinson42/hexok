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
 * A guard and hooks, when set, run around that method.
 * Statics are application data copied onto the class. The application validates `input`.
 * {@link UseCase.GuardParameters} reads the guard's call off the factory.
 * {@link context} returns that factory. {@link ContextFactory.guard} and
 * {@link ContextFactory.hooks} return it again.
 *
 * ```ts
 * const ApiUseCase = UseCase.context<
 *   ApiContext,
 *   { input: StandardSchemaV1; permission: string }
 * >()
 *   .guard((call) => {
 *     if (call.ctx.sessionId.length < 1 || call.spec.permission.length < 1) {
 *       throw new Error('unauthorized')
 *     }
 *   })
 *   .hooks({
 *     preExecute: () => ({ started: Date.now() }),
 *     postExecute(_call, state) {
 *       void state.started
 *     },
 *   })
 *
 * class FindUsers extends ApiUseCase('user.find', {
 *   input: z.object({ query: z.string() }),
 *   permission: 'users.read',
 * }) {
 *   constructor(private readonly users: UserRepository) { super() }
 *   async execute(
 *     ctx: ApiContext,
 *     input: { query: string },
 *   ): Promise<User[]> {
 *     return this.users.search(input.query)
 *   }
 * }
 * ```
 */
export namespace UseCase {
  /**
   * Call passed to a {@link context} guard.
   * `ctx` is the per-call context. `spec` is the static contract.
   * `token` is the use-case name. `input` is the argument passed to `execute`.
   *
   * ```ts
   * type Call = UseCase.GuardParameters<typeof ApiUseCase>
   * ```
   */
  export type GuardParameters<Factory> =
    Factory extends GuardParametersSlot<infer Ctx, infer Spec>
      ? Call<Ctx, Spec>
      : never;

  /**
   * Factory returned by {@link context}.
   * An exported const infers this type.
   * `guard` and `hooks` return the same factory.
   */
  export interface ContextFactory<Ctx, Spec = NoStatics>
    extends ReturnType<typeof buildContext<Ctx, Spec>> {
    /**
     * Runs after guards already registered, and before `execute`.
     * Returns the same factory.
     */
    guard(
      guard: (call: Call<Ctx, Spec>) => void | Promise<void>,
    ): ContextFactory<Ctx, Spec>;
    /**
     * Lifecycle around `execute`. The value returned from `preExecute` is the
     * `state` argument of `postExecute`, `onCatch`, and `onFinally`.
     * A second call throws when this factory already has hooks.
     */
    hooks<State = void>(
      definition: HookDefinition<Ctx, Spec, State>,
    ): ContextFactory<Ctx, Spec>;
  }

  /**
   * Family factory. Pass the context type.
   * The argument is a settings object with no keys yet.
   */
  export function context<Ctx, Spec = NoStatics>(
    config?: ContextConfig,
  ): unknown extends Ctx
    ? 'Pass a type argument: UseCase.context<Ctx>()'
    : ContextFactory<Ctx, Spec> {
    void config;
    return bindFactory<Ctx, Spec>({}) as unknown extends Ctx
      ? 'Pass a type argument: UseCase.context<Ctx>()'
      : ContextFactory<Ctx, Spec>;
  }
}

/** Values a guard and the hooks share for one invocation. */
type Call<Ctx, Spec> = {
  readonly ctx: Ctx;
  readonly spec: Spec;
  readonly token: string;
  /** The `input` argument the caller passed to `execute`. */
  readonly input: unknown;
};

type Performed<Ctx, Spec> = Call<Ctx, Spec> & {
  readonly result: unknown;
};

type Caught<Ctx, Spec> = Call<Ctx, Spec> & {
  readonly error: unknown;
};

type Settled<Ctx, Spec> =
  | (Call<Ctx, Spec> & {
      readonly status: 'success';
      readonly result: unknown;
    })
  | (Call<Ctx, Spec> & {
      readonly status: 'failure';
      readonly error: unknown;
    });

/** Settings for {@link UseCase.context}. There are none yet. */
type ContextConfig = Record<string, never>;

type ContextGuard<Ctx, Spec> = (call: Call<Ctx, Spec>) => void | Promise<void>;

type HookDefinition<Ctx, Spec, State> = {
  preExecute?: (call: Call<Ctx, Spec>) => State | Promise<State>;
  postExecute?: (
    call: Performed<Ctx, Spec>,
    state: Awaited<State>,
  ) => void | Promise<void>;
  onCatch?: (
    call: Caught<Ctx, Spec>,
    state: Awaited<State> | undefined,
  ) => void | Promise<void>;
  onFinally?: (
    call: Settled<Ctx, Spec>,
    state: Awaited<State> | undefined,
  ) => void | Promise<void>;
};

/** Hooks stored on one factory. State is erased after `.hooks()` checks it. */
type StoredHooks<Ctx, Spec> = {
  preExecute?: (call: Call<Ctx, Spec>) => unknown;
  postExecute?: (
    call: Performed<Ctx, Spec>,
    state: unknown,
  ) => void | Promise<void>;
  onCatch?: (call: Caught<Ctx, Spec>, state: unknown) => void | Promise<void>;
  onFinally?: (
    call: Settled<Ctx, Spec>,
    state: unknown,
  ) => void | Promise<void>;
};

/** Type-only mark. Absent at runtime. Same symbol in {@link UseCase.GuardParameters}. */
declare const guardParameters: unique symbol;

type GuardParametersSlot<Ctx, Spec> = {
  readonly [guardParameters]?: (call: Call<Ctx, Spec>) => void;
};

type Slots<Ctx, Spec> = {
  guard?: ContextGuard<Ctx, Spec>;
  hooks?: StoredHooks<Ctx, Spec>;
};

function storedHooks<Ctx, Spec, State>(
  definition: HookDefinition<Ctx, Spec, State>,
): StoredHooks<Ctx, Spec> | undefined {
  if (
    definition.preExecute === undefined &&
    definition.postExecute === undefined &&
    definition.onCatch === undefined &&
    definition.onFinally === undefined
  ) {
    return undefined;
  }
  return definition as unknown as StoredHooks<Ctx, Spec>;
}

function composeGuard<Ctx, Spec>(
  current: ContextGuard<Ctx, Spec> | undefined,
  next: ContextGuard<Ctx, Spec>,
): ContextGuard<Ctx, Spec> {
  if (current === undefined) return next;
  return async (call) => {
    await current(call);
    await next(call);
  };
}

function bindFactory<Ctx, Spec>(
  slots: Slots<Ctx, Spec>,
): UseCase.ContextFactory<Ctx, Spec> {
  const factory = buildContext(slots) as UseCase.ContextFactory<Ctx, Spec>;
  Object.defineProperty(factory, 'guard', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: (guard: ContextGuard<Ctx, Spec>) =>
      bindFactory({
        ...slots,
        guard: composeGuard(slots.guard, guard),
      }),
  });
  Object.defineProperty(factory, 'hooks', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: <State>(definition: HookDefinition<Ctx, Spec, State>) => {
      const hooks = storedHooks(definition);
      if (slots.hooks !== undefined && hooks !== undefined) {
        throw new Error('hexok: UseCase hooks are already set');
      }
      return bindFactory({
        ...slots,
        ...(hooks !== undefined ? { hooks } : {}),
      });
    },
  });
  return factory;
}

function buildContext<Ctx, Spec = NoStatics>(options?: {
  guard?: ContextGuard<Ctx, Spec>;
  hooks?: StoredHooks<Ctx, Spec>;
}) {
  const guard = options?.guard;
  const hooks = options?.hooks;

  const factory = function family<
    const Token extends string,
    const S extends [keyof Spec] extends [never] ? NoStatics : Spec,
  >(
    token: Token,
    ...args: [keyof Spec] extends [never] ? [] : [statics: ReservedOk<S> & Spec]
  ) {
    // Conditional rest tuple: index 0 is the statics bag, or absent.
    const statics = bagOf(args as readonly unknown[]);
    const spec = (statics ?? {}) as Spec;

    abstract class Runtime {
      /** Use-case name. Literal type of the string passed to the factory. */
      static readonly token: Token = token;
      /** Nominal marker. Each factory call is a distinct class. */
      readonly #brand = true;

      protected constructor() {
        void this.#brand;
        if (guard === undefined && hooks === undefined) return;
        installExecute(this, token, guard, hooks, spec);
      }

      /**
       * Required. Annotate `ctx`, `input`, and the return type on the subclass.
       * A guard and hooks run around this method when set.
       */
      abstract execute(ctx: Ctx, input: unknown): Promise<unknown>;
    }

    if (statics !== undefined) assignStatics(Runtime, statics);
    return Runtime as typeof Runtime &
      ([keyof Spec] extends [never] ? NoStatics : Statics<S>);
  };

  return factory as typeof factory & GuardParametersSlot<Ctx, Spec>;
}

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

function installExecute<Ctx, Spec>(
  instance: object,
  token: string,
  guard: ContextGuard<Ctx, Spec> | undefined,
  hooks: StoredHooks<Ctx, Spec> | undefined,
  spec: Spec,
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
      const call: Call<Ctx, Spec> = { ctx, spec, token, input };
      if (guard !== undefined) await guard(call);
      // Local to this invocation. Overlapping execute calls must not share it.
      let state: unknown;
      let succeeded = false;
      let result: unknown;
      let caught: unknown;
      let failed = false;
      try {
        if (hooks?.preExecute !== undefined) {
          state = await hooks.preExecute(call);
        }
        result = await execute.call(instance, ctx, input);
        if (hooks?.postExecute !== undefined) {
          await hooks.postExecute({ ...call, result }, state);
        }
        succeeded = true;
        return result;
      } catch (error) {
        failed = true;
        caught = error;
        if (hooks?.onCatch !== undefined) {
          await hooks.onCatch({ ...call, error }, state);
        }
        throw error;
      } finally {
        if (hooks?.onFinally !== undefined) {
          const settled: Settled<Ctx, Spec> = succeeded
            ? { ...call, status: 'success', result }
            : { ...call, status: 'failure', error: caught };
          if (failed || succeeded) await hooks.onFinally(settled, state);
        }
      }
    },
  });
}
