import { randomBytes } from 'node:crypto';
import { Adapter, fail, ok, type Result } from 'hexok';
import { assertSessionConfig, type SessionConfig } from './config.js';
import { type OpenedSession, SessionStore } from './sessions.js';

type Entry<I> = {
  readonly identity: I;
  readonly absoluteEnd: number;
  idleUntil: number;
};

/**
 * Sessions in this process's memory, with the same two clocks as a shared
 * store. A restart ends every session, and another process cannot see them.
 * Use it in tests and in single-process development only.
 *
 * A record vanishes at the earlier of its idle and absolute ends, the way a
 * Redis key with a TTL does, so `resolve` reports both as `ended`.
 */
export class MemorySessionStore<I> extends Adapter(SessionStore)<I> {
  readonly #sessions = new Map<string, Entry<I>>();
  readonly #idleMs: number;
  readonly #absoluteMs: number;
  readonly #now: () => number;

  constructor(
    config: SessionConfig & {
      /** Milliseconds since the epoch. Tests pass a fake clock. */
      readonly now?: () => number;
    },
  ) {
    super();
    assertSessionConfig(config);
    this.#idleMs = config.idleSeconds * 1000;
    this.#absoluteMs = config.absoluteSeconds * 1000;
    this.#now = config.now ?? Date.now;
  }

  override async open(identity: I): Promise<OpenedSession> {
    const id = randomBytes(32).toString('base64url');
    const now = this.#now();
    const absoluteEnd = now + this.#absoluteMs;
    this.#sessions.set(id, {
      identity,
      absoluteEnd,
      idleUntil: Math.min(now + this.#idleMs, absoluteEnd),
    });
    return { id, expiresAt: new Date(absoluteEnd) };
  }

  override async resolve(id: string): Promise<Result<I, 'ended' | 'expired'>> {
    const entry = this.#sessions.get(id);
    if (entry === undefined) return fail('ended');
    const now = this.#now();
    if (now >= entry.idleUntil) {
      this.#sessions.delete(id);
      return fail('ended');
    }
    entry.idleUntil = Math.min(now + this.#idleMs, entry.absoluteEnd);
    return ok(entry.identity);
  }

  override async close(id: string): Promise<void> {
    this.#sessions.delete(id);
  }
}
