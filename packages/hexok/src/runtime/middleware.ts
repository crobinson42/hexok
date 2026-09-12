/** Onion around API `execute` (`local` and HTTP). Does not run for event handlers or nested `run`. */
export type RpcMiddleware<Ctx = unknown> = (args: {
  /** Request context (`ctx` on the use case). */
  context: Ctx;
  /** Parsed API input. */
  input: unknown;
  /** Continue the onion. */
  next: () => Promise<unknown>;
  /** Error factories from the use-case error map. */
  errors: { [code: string]: (data?: unknown) => never };
  /** Use-case key (`incident.close`). */
  path: string;
}) => Promise<unknown>;
