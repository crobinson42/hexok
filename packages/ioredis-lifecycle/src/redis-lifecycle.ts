import type { Redis } from 'ioredis';
import { LifecycleError, messages } from './errors.js';
import { type LogSink, noopSink } from './log-sink.js';
import { settleWithin } from './timing.js';

/** `idle → starting → ready → stopping → stopped`. A failed start returns to `idle`. `start()` from `stopped` begins again. */
export type LifecycleState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped';

export interface RedisLifecycleOptions {
  /** The adapter name, such as `queue`. It prefixes every error message and is the `adapter` log field. */
  readonly adapter: string;
  /** The total time `stop()` may take, cleanup and `QUIT` included. The adapter sets and documents its default. */
  readonly stopTimeoutMs: number;
  /** Rejects `start()` with `StartTimeout` when a client is not ready in time. Unset, `start()` waits and logs each connection error. */
  readonly startTimeoutMs?: number | undefined;
  readonly logger?: LogSink | undefined;
}

export interface RunOptions {
  /** Rejects the call with `signal.reason` when it aborts first. Use it for commands on a client you will `detach()`. */
  readonly signal?: AbortSignal | undefined;
}

export interface AttachOptions {
  /** The adapter method that opens the client, such as `subscribe`. It names the method in a state error. */
  readonly operation: string;
  /** The `connection` log field, such as `blocking`. */
  readonly connection: string;
  readonly open: () => Redis;
  /** More log fields for this client's errors, such as `{ topic }`. */
  readonly fields?: Record<string, unknown> | undefined;
}

export interface StopContext<Clients> {
  /** Aborts when `stop()` stops waiting for cleanup: when cleanup and in-flight commands finish, or when the budget runs out. */
  readonly signal: AbortSignal;
  /** {@link RedisLifecycle.run} that works during cleanup. A call still pending when the budget runs out rejects with `StoppedBeforeReply`. */
  run<T>(
    operation: string,
    command: (clients: Clients) => Promise<T>,
    options?: RunOptions,
  ): Promise<T>;
}

export type StopCleanup<Clients> = (
  context: StopContext<Clients>,
) => Promise<void> | void;

interface LogFields {
  readonly [field: string]: unknown;
  readonly adapter: string;
  readonly connection: string;
}

interface Session<Clients> {
  readonly clients: Clients;
  /** Each open client, started or attached, and the fields of every log about it. */
  readonly connections: Map<Redis, LogFields>;
  /** Cancels the readiness wait. */
  readonly opening: AbortController;
  /** Rejects guarded commands that are still pending. `stop()` aborts it after cleanup. */
  readonly guard: AbortController;
  inflight: number;
  onIdle: (() => void) | undefined;
}

/**
 * Owns the ioredis clients of one adapter instance, from `start()` to `stop()`.
 * It logs every client error, guards every command by state, and makes `stop()` finish within `stopTimeoutMs` even when Redis is gone.
 */
export class RedisLifecycle<
  Clients extends Record<string, Redis> = Record<string, Redis>,
> {
  readonly #adapter: string;
  readonly #stopTimeoutMs: number;
  readonly #startTimeoutMs: number | undefined;
  readonly #logger: LogSink;
  #state: LifecycleState = 'idle';
  #session: Session<Clients> | undefined;
  #starting: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;

  constructor(options: RedisLifecycleOptions) {
    assertDuration(options.adapter, 'stopTimeoutMs', options.stopTimeoutMs);
    if (options.startTimeoutMs !== undefined) {
      assertDuration(options.adapter, 'startTimeoutMs', options.startTimeoutMs);
    }
    this.#adapter = options.adapter;
    this.#stopTimeoutMs = options.stopTimeoutMs;
    this.#startTimeoutMs = options.startTimeoutMs;
    this.#logger = options.logger ?? noopSink;
  }

  /** The current state. Include it in adapter logs. */
  get state(): LifecycleState {
    return this.#state;
  }

  /**
   * Opens the clients with `open` and resolves when every client is `ready`. It connects a `lazyConnect` client.
   * A `start()` while one is pending joins it, and its `open` is not called. A `start()` while ready resolves at once.
   * `onReady` runs once, when the state becomes `ready` and before `start()` resolves. Set adapter timers there.
   * Rejects with `EndedBeforeReady` when a client ends, `StartTimeout` after `startTimeoutMs`, and `Stopped` when `stop()` is called first.
   * After a rejection, every client is disconnected and a later `start()` opens new ones.
   */
  start(
    open: () => Clients,
    onReady?: (clients: Clients) => void,
  ): Promise<void> {
    if (this.#state === 'ready') return Promise.resolve();
    if (this.#state === 'starting' && this.#starting) return this.#starting;
    if (this.#state === 'stopping') {
      return Promise.reject(
        LifecycleError.Stopped(messages.startDuringStop(this.#adapter)),
      );
    }
    const starting = this.#open(open, onReady).finally(() => {
      if (this.#starting === starting) this.#starting = undefined;
    });
    this.#starting = starting;
    return starting;
  }

  /**
   * Runs `command` with the clients and returns its result.
   * Rejects without running it with `NotStarted`, `Starting`, or `Stopped` unless the state is `ready`.
   * Rejects with `StoppedBeforeReply` when `stop()` gives up waiting before the command settles.
   * The command's own error passes through unchanged. Nothing outlives the call.
   */
  run<T>(
    operation: string,
    command: (clients: Clients) => Promise<T>,
    options: RunOptions = {},
  ): Promise<T> {
    const session = this.#session;
    if (this.#state !== 'ready' || session === undefined) {
      return Promise.reject(this.#stateError(operation));
    }
    return this.#guarded(session, operation, command, options.signal);
  }

  /** Throws `NotStarted`, `Starting`, or `Stopped` unless the state is `ready`. Use it in a synchronous adapter method. */
  assertReady(operation: string): void {
    if (this.#state !== 'ready') throw this.#stateError(operation);
  }

  /**
   * Opens one more client while ready, such as a blocking connection per subscription.
   * It gets the same error logging as a started client, and `stop()` closes it.
   * Throws `NotStarted`, `Starting`, or `Stopped` without calling `open` unless the state is `ready`.
   */
  attach(options: AttachOptions): Redis {
    const session = this.#session;
    if (this.#state !== 'ready' || session === undefined) {
      throw this.#stateError(options.operation);
    }
    const client = options.open();
    this.#listen(session, client, options.connection, options.fields);
    this.#watchEnd(session, client);
    return client;
  }

  /**
   * Disconnects an attached client now and forgets it. It sends no `QUIT`.
   * A guarded command on that client may never settle if the client was reconnecting, so pass that command a `signal` and abort it first.
   */
  detach(client: Redis): void {
    this.#session?.connections.delete(client);
    client.disconnect();
  }

  /**
   * Stops within `stopTimeoutMs` and always resolves.
   * 1. New `run()` calls reject with `Stopped`. A pending `start()` rejects with `Stopped`.
   * 2. When the lifecycle was ready, `cleanup` runs while in-flight commands finish. Cleanup runs guarded commands with `context.run`.
   * 3. Guarded commands still pending reject with `StoppedBeforeReply`.
   * 4. Each ready client gets `QUIT` within the time left. Any other client, or one whose `QUIT` does not settle, is disconnected.
   * A `stop()` while one is pending joins it, and its `cleanup` is not called.
   */
  stop(cleanup?: StopCleanup<Clients>): Promise<void> {
    if (this.#stopping) return this.#stopping;
    const session = this.#session;
    if (session === undefined) {
      if (this.#state === 'idle') this.#state = 'stopped';
      return Promise.resolve();
    }
    const stopping = this.#shutdown(session, cleanup).finally(() => {
      if (this.#stopping === stopping) this.#stopping = undefined;
    });
    this.#stopping = stopping;
    return stopping;
  }

  async #open(
    open: () => Clients,
    onReady: ((clients: Clients) => void) | undefined,
  ): Promise<void> {
    this.#state = 'starting';
    let clients: Clients;
    try {
      clients = open();
    } catch (error) {
      this.#state = 'idle';
      throw error;
    }
    const session: Session<Clients> = {
      clients,
      connections: new Map(),
      opening: new AbortController(),
      guard: new AbortController(),
      inflight: 0,
      onIdle: undefined,
    };
    this.#session = session;
    for (const [connection, client] of Object.entries(clients)) {
      this.#listen(session, client, connection, undefined);
    }
    try {
      await this.#untilReady(session);
      // stop() can run after every client is ready and before this line.
      session.opening.signal.throwIfAborted();
      this.#state = 'ready';
      for (const client of session.connections.keys()) {
        this.#watchEnd(session, client);
      }
      onReady?.(clients);
    } catch (error) {
      // Once stop() begins, it closes the clients itself.
      if (this.#session === session && this.#stopping === undefined) {
        this.#discard(session);
      }
      throw error;
    }
  }

  async #untilReady(session: Session<Clients>): Promise<void> {
    const { opening } = session;
    const ms = this.#startTimeoutMs;
    const timer =
      ms === undefined
        ? undefined
        : setTimeout(() => {
            opening.abort(
              LifecycleError.StartTimeout(
                messages.startTimeout(this.#adapter, ms),
              ),
            );
          }, ms);
    try {
      await Promise.all(
        Object.entries(session.clients).map(([connection, client]) =>
          untilReady(client, opening.signal, () =>
            LifecycleError.EndedBeforeReady(
              messages.endedBeforeReady(this.#adapter, connection),
            ),
          ),
        ),
      );
    } catch (error) {
      // Removes the other clients' readiness listeners.
      if (!opening.signal.aborted) opening.abort(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** A failed start leaves nothing open, so a later `start()` begins clean. */
  #discard(session: Session<Clients>): void {
    this.#session = undefined;
    this.#state = 'idle';
    for (const client of session.connections.keys()) client.disconnect();
  }

  async #shutdown(
    session: Session<Clients>,
    cleanup: StopCleanup<Clients> | undefined,
  ): Promise<void> {
    const wasReady = this.#state === 'ready';
    this.#state = 'stopping';
    const deadline = Date.now() + this.#stopTimeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    session.opening.abort(
      LifecycleError.Stopped(messages.stoppedDuringStart(this.#adapter)),
    );
    if (wasReady) {
      // Cleanup runs before guarded commands are rejected, because cleanup often needs Redis, such as to release a lock.
      const context: StopContext<Clients> = {
        signal: session.guard.signal,
        run: (operation, command, options = {}) =>
          this.#guarded(session, operation, command, options.signal),
      };
      await settleWithin(
        Promise.all([this.#cleanup(cleanup, context), drained(session)]),
        remaining(),
      );
    }
    session.guard.abort(
      LifecycleError.Stopped(messages.closing(this.#adapter)),
    );
    await Promise.all(
      [...session.connections].map(([client, fields]) =>
        this.#close(client, fields, remaining),
      ),
    );
    if (this.#session === session) this.#session = undefined;
    this.#state = 'stopped';
  }

  async #cleanup(
    cleanup: StopCleanup<Clients> | undefined,
    context: StopContext<Clients>,
  ): Promise<void> {
    if (cleanup === undefined) return;
    try {
      await cleanup(context);
    } catch (error) {
      this.#logger.error(
        error instanceof Error
          ? error
          : new Error(`${this.#adapter}: stop cleanup failed`),
        { adapter: this.#adapter },
      );
    }
  }

  /**
   * A client that is not ready would hold `QUIT` in its offline queue until Redis returns, so it is disconnected.
   * A ready client whose Redis stopped answering never settles `QUIT`, so `QUIT` is bounded.
   */
  async #close(
    client: Redis,
    fields: LogFields,
    remaining: () => number,
  ): Promise<void> {
    if (client.status === 'ready' && remaining() > 0) {
      let closed = false;
      const quit = client.quit().then(
        () => {
          closed = true;
        },
        (error: unknown) => {
          this.#logger.error(
            error instanceof Error
              ? error
              : new Error(`${this.#adapter}: QUIT failed`),
            fields,
          );
        },
      );
      await settleWithin(quit, remaining());
      if (closed) return;
    }
    client.disconnect();
  }

  #listen(
    session: Session<Clients>,
    client: Redis,
    connection: string,
    fields: Record<string, unknown> | undefined,
  ): void {
    const logFields: LogFields = {
      ...fields,
      adapter: this.#adapter,
      connection,
    };
    const onError = (error: Error) => {
      this.#logger.error(error, logFields);
    };
    // This listener stays after stop(). ioredis can emit while a socket closes, and with no listener it prints "Unhandled error event".
    client.on('error', onError);
    session.connections.set(client, logFields);
  }

  /**
   * Logs a client that ends while the lifecycle is ready, such as when `retryStrategy` gives up.
   * `state` stays `ready`, so the log is the only signal. Before ready, the readiness wait handles `end`.
   * The listener stays on the client, so `stop()` needs no `off`. Once the client is detached or its session stops, it does nothing.
   */
  #watchEnd(session: Session<Clients>, client: Redis): void {
    const onEnd = () => {
      if (this.#session !== session || this.#state !== 'ready') return;
      const fields = session.connections.get(client);
      if (fields === undefined) return;
      this.#logger.error(
        messages.endedAfterReady(this.#adapter, fields.connection),
        fields,
      );
    };
    client.on('end', onEnd);
  }

  #guarded<T>(
    session: Session<Clients>,
    operation: string,
    command: (clients: Clients) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const guard = session.guard.signal;
    if (guard.aborted) {
      return Promise.reject(
        LifecycleError.Stopped(messages.stopped(this.#adapter, operation)),
      );
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      // Listeners live only for this call, so a settled call is not retained by the session or the caller's signal.
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        guard.removeEventListener('abort', onStop);
        signal?.removeEventListener('abort', onAbort);
        session.inflight -= 1;
        if (session.inflight === 0) session.onIdle?.();
        return true;
      };
      const onStop = () => {
        if (finish()) {
          reject(
            LifecycleError.StoppedBeforeReply(
              messages.stoppedBeforeReply(this.#adapter, operation),
            ),
          );
        }
      };
      const onAbort = () => {
        if (finish()) reject(signal?.reason);
      };
      session.inflight += 1;
      guard.addEventListener('abort', onStop, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
      let pending: Promise<T>;
      try {
        pending = command(session.clients);
      } catch (error) {
        if (finish()) reject(error);
        return;
      }
      pending.then(
        (value) => {
          if (finish()) resolve(value);
        },
        (error: unknown) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  #stateError(operation: string) {
    if (this.#state === 'idle') {
      return LifecycleError.NotStarted(
        messages.notStarted(this.#adapter, operation),
      );
    }
    if (this.#state === 'starting') {
      return LifecycleError.Starting(
        messages.starting(this.#adapter, operation),
      );
    }
    return LifecycleError.Stopped(messages.stopped(this.#adapter, operation));
  }
}

function assertDuration(adapter: string, name: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(
      `${adapter}: ${name} must be a finite number of ms >= 0`,
    );
  }
}

/** Resolves when no guarded command of `session` is in flight. */
function drained(session: Session<unknown>): Promise<void> {
  if (session.inflight === 0) return Promise.resolve();
  return new Promise((resolve) => {
    session.onIdle = () => {
      session.onIdle = undefined;
      resolve();
    };
  });
}

/**
 * Resolves on `ready`. Rejects on `end` or when `signal` aborts. Connects a `lazyConnect` client.
 * ioredis reports failed attempts through `error` and keeps retrying, so those do not reject.
 */
function untilReady(
  client: Redis,
  signal: AbortSignal,
  ended: () => Error,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (client.status === 'ready') return Promise.resolve();
  if (client.status === 'end') return Promise.reject(ended());
  return new Promise((resolve, reject) => {
    const settle = (error?: unknown) => {
      client.off('ready', onReady);
      client.off('end', onEnd);
      signal.removeEventListener('abort', onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReady = () => settle();
    const onEnd = () => settle(ended());
    const onAbort = () => settle(signal.reason);
    client.once('ready', onReady);
    client.once('end', onEnd);
    signal.addEventListener('abort', onAbort, { once: true });
    if (client.status === 'wait') client.connect().catch(() => undefined);
  });
}
