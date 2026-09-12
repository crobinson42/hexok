/** Onion around API `execute` (`local` and HTTP). Does not run for event handlers or nested `run`. */
export type ApiMiddleware<Ctx = unknown> = (args: {
  /** Request context (`ctx` on the use case). */
  context: Ctx;
  /** Parsed API input. */
  input: unknown;
  /** Continue the onion. Does not accept a replacement ctx. */
  next: () => Promise<unknown>;
  /** Error factories from the use-case error map. */
  errors: { [code: string]: (data?: unknown) => never };
  /** Use-case key (`incident.close`). */
  path: string;
  /** Present on HTTP `router.fetch` only. Read headers here; set ctx with `.ctxFrom`. */
  request?: Request;
}) => Promise<unknown>;

/** @deprecated Use `ApiMiddleware`. Same type; not HTTP-only. */
export type RpcMiddleware<Ctx = unknown> = ApiMiddleware<Ctx>;
