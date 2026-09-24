import { throwMappedError } from './coded-error.js';
import type { EmptyErrors, ErrorArgs, ErrorMap } from './error-map.js';

/**
 * Application service. Pass ports through the constructor.
 * `execute` is required; the compiler errors on the class when it is missing.
 * Declare the input and output on `execute` — those are the types callers see.
 *
 * ```ts
 * class CreateUser extends UseCase('user.create', {
 *   USER_EXISTS: { message: 'User already exists' },
 * }) {
 *   constructor(private readonly users: UserRepository) { super() }
 *   async execute(input: { email: string }): Promise<{ id: string }> {
 *     return { id: input.email }
 *   }
 * }
 * ```
 */
export function UseCase<
  const Token extends string,
  const Errors extends ErrorMap = EmptyErrors,
>(token: Token, errors?: Errors) {
  const errorMap = (errors ?? {}) as Errors;

  abstract class UseCaseClass {
    /** Use-case name. Literal type of the string passed to {@link UseCase}. */
    static readonly token: Token = token;
    /** Declared refusal codes. Keys are the `error()` union. */
    static readonly errors: Errors = errorMap;
    /** Nominal marker. Each `UseCase(...)` call is a distinct class. */
    readonly #brand = true;

    protected constructor() {
      void this.#brand;
    }

    /**
     * Throw a declared error. The code must be a key of the map passed to
     * {@link UseCase}. An undeclared code is a programming error at runtime.
     */
    static error<K extends keyof Errors & string>(
      code: K,
      ...args: ErrorArgs<Errors, K>
    ): never {
      throwMappedError(token, errorMap, code, args[0]);
    }

    /** Instance form of the static `error`. */
    error<K extends keyof Errors & string>(
      code: K,
      ...args: ErrorArgs<Errors, K>
    ): never {
      throwMappedError(token, errorMap, code, args[0]);
    }

    /**
     * Required. Annotate `input` and the return type on the subclass;
     * callers of the subclass see those types.
     */
    abstract execute(input: unknown): Promise<unknown>;
  }

  return UseCaseClass;
}
