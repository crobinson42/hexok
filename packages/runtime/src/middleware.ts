export type RpcMiddleware<Ctx = unknown> = (args: {
  context: Ctx;
  input: unknown;
  next: () => Promise<unknown>;
  errors: { [code: string]: (data?: unknown) => never };
  path: string;
}) => Promise<unknown>;
