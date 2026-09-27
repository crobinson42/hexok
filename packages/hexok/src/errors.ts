import type { ErrorMap } from './error-map.js';
import type { StandardSchemaV1 } from './standard-schema.js';
import type { Infer } from './validate.js';

/**
 * Nominal catalog brand. The symbol is shared. The type argument is the
 * catalog token, so two catalogs are not the same error.
 */
export const catalogBrand: unique symbol = Symbol('hexok.catalog');

const RESERVED = new Set(['is', 'match', 'prototype', 'token']);

type MessageOf<Code extends string, Def> = Def extends {
  readonly message: infer M extends string;
}
  ? M
  : Code;

type DataOf<Def> = Def extends {
  readonly data: infer S extends StandardSchemaV1;
}
  ? Infer<S>
  : undefined;

/** One member. `code` and `data` are the pair a gateway matches on. */
export type CatalogMember<
  Token extends string,
  Code extends string,
  Message extends string,
  Data,
> = Error & {
  readonly [catalogBrand]: Token;
  readonly catalog: Token;
  readonly code: Code;
  readonly message: Message;
  readonly data: Data;
};

/** Discriminated union of every member. Returned by {@link ErrorsHandle.is}. */
export type CatalogUnion<Token extends string, M> = {
  [K in keyof M & string]: CatalogMember<Token, K, string, DataOf<M[K]>>;
}[keyof M & string];

/**
 * One object type so `class X extends Errors(...)` is legal.
 * A union here is TS2509. Payloads are discriminated by `is()`.
 */
export interface CatalogInstance<Token extends string, M extends ErrorMap>
  extends Error {
  readonly [catalogBrand]: Token;
  readonly catalog: Token;
  readonly code: keyof M & string;
  readonly data: unknown;
}

// `any` is the inference slot for each handler's return. `unknown` collapses them to one type.
// biome-ignore lint/suspicious/noExplicitAny: per-key return inference
type MatchReturns<Keys extends string> = Record<Keys, any>;

type Matchers<
  Token extends string,
  M,
  R extends MatchReturns<keyof M & string>,
> = {
  [K in keyof M & string]: (
    error: CatalogMember<Token, K, string, DataOf<M[K]>>,
  ) => R[K];
};

/**
 * Message, when passed, is the first argument. The catalog message is the default.
 * With `data`: `(data)` or `(message, data)`. Without `data`: `()` or `(message)`.
 */
type Factory<Token extends string, Code extends string, Def> = Def extends {
  readonly data: infer S extends StandardSchemaV1;
}
  ? {
      <M extends string>(
        message: M,
        data: Infer<S>,
      ): CatalogMember<Token, Code, M, Infer<S>>;
      (
        data: Infer<S>,
      ): CatalogMember<Token, Code, MessageOf<Code, Def>, Infer<S>>;
    }
  : {
      (): CatalogMember<Token, Code, MessageOf<Code, Def>, undefined>;
      <M extends string>(message: M): CatalogMember<Token, Code, M, undefined>;
    };

/**
 * Abstract constructor, `is`, `match`, and one static factory per code.
 * Factories return the error. The caller throws.
 * `init: never` blocks `new DomainError()`.
 */
export type ErrorsHandle<Token extends string, M extends ErrorMap> = {
  readonly token: Token;
  readonly prototype: CatalogInstance<Token, M>;
  is(error: unknown): error is CatalogUnion<Token, M>;
  match<R extends MatchReturns<keyof M & string>>(
    error: CatalogUnion<Token, M>,
    cases: Matchers<Token, M, R>,
  ): R[keyof R & keyof M & string];
} & {
  [K in keyof M & string]: Factory<Token, K, M[K]>;
} & (abstract new (
    init: never,
  ) => CatalogInstance<Token, M>);

type Construct = new (
  code: string,
  message: string,
  data: unknown,
) => CatalogInstance<string, ErrorMap>;

/**
 * Branded error catalog. Throw a member from any layer. A gateway imports
 * the catalog and maps it. The catalog does not know about HTTP.
 *
 * ```ts
 * class DomainError extends Errors('domain', {
 *   BlankName: { message: 'Name is blank' },
 *   UserExists: { message: 'User already exists', data: z.object({ id: z.string() }) },
 * }) {}
 *
 * throw DomainError.BlankName()
 * throw DomainError.BlankName('Name cannot be empty')
 * throw DomainError.UserExists({ id })
 * throw DomainError.UserExists('User ada already exists', { id })
 * ```
 */
export function Errors<const Token extends string, const M extends ErrorMap>(
  token: Token,
  defs: M,
): ErrorsHandle<Token, M> {
  for (const code of Object.keys(defs)) {
    if (RESERVED.has(code)) {
      throw new Error(`hexok: error code "${code}" is reserved`);
    }
  }

  abstract class CatalogError extends Error {
    /** Catalog name. Literal type of the string passed to {@link Errors}. */
    static readonly token: Token = token;
    readonly catalog: Token = token;
    readonly code: string;
    readonly data: unknown;
    readonly [catalogBrand]: Token;
    /** Per-call class identity. Public nominality is `catalogBrand`. */
    readonly #brand = true;

    constructor(code: string, message: string, data: unknown) {
      super(message);
      this.name = `${token}.${code}`;
      this.code = code;
      this.data = data;
      this[catalogBrand] = token;
      void this.#brand;
    }

    /** True when `error` is a member of this catalog. */
    static is(error: unknown): error is CatalogUnion<Token, M> {
      return error instanceof this;
    }

    /**
     * Run the handler for `error.code`. A missing handler is a type error.
     * An unknown code at runtime is a programming error.
     */
    static match<R extends MatchReturns<keyof M & string>>(
      error: CatalogUnion<Token, M>,
      cases: Matchers<Token, M, R>,
    ): R[keyof R & keyof M & string] {
      const handler = cases[error.code as keyof M & string];
      if (handler === undefined) {
        throw new Error(`hexok: unmatched ${token}.${error.code}`);
      }
      return handler(error as never);
    }
  }

  for (const code of Object.keys(defs)) {
    const def = defs[code];
    if (def === undefined) continue;
    const fallback = def.message ?? code;
    const withData = def.data !== undefined;
    Object.defineProperty(CatalogError, code, {
      enumerable: true,
      configurable: true,
      writable: true,
      value(this: Construct, ...args: unknown[]) {
        if (!withData) {
          return new this(
            code,
            args.length === 0 ? fallback : (args[0] as string),
            undefined,
          );
        }
        if (args.length > 1) {
          return new this(code, args[0] as string, args[1]);
        }
        return new this(code, fallback, args[0]);
      },
    });
  }

  return CatalogError as unknown as ErrorsHandle<Token, M>;
}
