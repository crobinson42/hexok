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
