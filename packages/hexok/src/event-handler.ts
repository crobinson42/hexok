import type { EventConstructor } from './catalog.js';

type EventInstanceOf<Event> = Event extends abstract new (
  ...args: never[]
) => infer Instance
  ? Instance
  : never;

/**
 * Application service for one event. Pass ports through the constructor.
 * `handle` is required; the compiler errors on the class when it is missing.
 * Annotate the event parameter with the event class.
 *
 * ```ts
 * class OnUserCreated extends EventHandler('on.user.created', UserCreated) {
 *   handle(event: UserCreated): void {
 *     event.payload.email
 *   }
 * }
 * ```
 */
export function EventHandler<
  const Token extends string,
  E extends EventConstructor,
>(token: Token, event: E) {
  type Instance = EventInstanceOf<E>;

  abstract class HandlerClass {
    /** Handler name. Literal type of the string passed to {@link EventHandler}. */
    static readonly token: Token = token;
    /** Event class this handler receives. */
    static readonly event: E = event;
    /** Nominal marker. Each `EventHandler(...)` call is a distinct class. */
    readonly #brand = true;

    constructor() {
      void this.#brand;
    }

    /**
     * Required. Annotate `event` with the event class passed to
     * {@link EventHandler}. Return `void` or `Promise<void>`.
     */
    abstract handle(event: Instance): Promise<void> | void;
  }

  return HandlerClass;
}
