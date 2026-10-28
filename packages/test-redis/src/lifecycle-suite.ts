import { createHook } from 'node:async_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisProxy } from './proxy.js';

/** What the suite drives. Wrap the adapter in it. */
export interface LifecycleSubject {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** One guarded operation, such as `publish`. A lifecycle error must reach the caller with its `code`. */
  operate(): Promise<unknown>;
}

export interface LifecycleSubjectConfig {
  /** Connects through the suite's outage proxy. Pass it as the adapter's `redis` option. */
  readonly redis: {
    readonly host: string;
    readonly port: number;
    readonly disconnectTimeout: number;
  };
  /** Pass it as the adapter's `stopTimeoutMs`. */
  readonly stopTimeoutMs: number;
}

export interface LifecycleSuiteOptions {
  /** The `stopTimeoutMs` the factory receives. Default 500. */
  readonly stopTimeoutMs?: number | undefined;
  /** How late `stop()` may resolve past `stopTimeoutMs`. Default 250. */
  readonly slackMs?: number | undefined;
}

/** ioredis destroys a half-closed socket after `disconnectTimeout`. The suite keeps it short so the handle check is quick. */
const disconnectTimeout = 200;

/**
 * Asserts the shared `@hexok/ioredis-lifecycle` guarantees against a real Redis behind an outage proxy.
 * Call it at the top level of an `*.integration.test.ts` file. It skips when `REDIS_URL` is unset and throws when `CI` is set without it.
 * Errors are matched on `code`, not on message text.
 */
export function describeRedisLifecycle(
  name: string,
  factory: (config: LifecycleSubjectConfig) => LifecycleSubject,
  options: LifecycleSuiteOptions = {},
): void {
  if (process.env.CI && !process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required when CI is set');
  }
  const stopTimeoutMs = options.stopTimeoutMs ?? 500;
  const slackMs = options.slackMs ?? 250;

  describe.skipIf(!process.env.REDIS_URL)(`${name} lifecycle`, () => {
    let proxy: RedisProxy;
    let tracker: HandleTracker | undefined;
    const subjects: LifecycleSubject[] = [];

    function subject(): LifecycleSubject {
      const made = factory({
        redis: { host: proxy.host, port: proxy.port, disconnectTimeout },
        stopTimeoutMs,
      });
      subjects.push(made);
      return made;
    }

    async function timedStop(made: LifecycleSubject): Promise<number> {
      const started = Date.now();
      await made.stop();
      return Date.now() - started;
    }

    /**
     * No socket or timer made during the test outlives `stop()`, except the proxy's own sockets.
     * ioredis may hold a half-closed socket for `disconnectTimeout` first.
     */
    async function expectNoHandles(): Promise<void> {
      const active = tracker;
      if (active === undefined) throw new Error('call track() first');
      const deadline = Date.now() + disconnectTimeout + 2000;
      let now = active.live(proxy.sockets);
      while (now.sockets !== 0 || now.timers !== 0) {
        if (Date.now() > deadline) break;
        await active.untracked(() => delay(20));
        now = active.live(proxy.sockets);
      }
      active.disable();
      expect(now).toEqual({ sockets: 0, timers: 0 });
    }

    /** Starts tracking in the test body, after vitest has made its own timers for the test. */
    function track(): void {
      tracker = trackHandles();
    }

    beforeEach(async () => {
      proxy = await RedisProxy.start();
    });

    afterEach(async () => {
      tracker?.disable();
      tracker = undefined;
      await Promise.all(subjects.splice(0).map((made) => made.stop()));
      await proxy.close();
    });

    it('start waits until Redis is ready', async () => {
      await proxy.refuse();
      const made = subject();
      let started = false;
      const starting = made.start().then(() => {
        started = true;
      });
      await delay(300);
      expect(started).toBe(false);
      await proxy.restore();
      await starting;
      await made.operate();
    });

    it('operate rejects with NotStarted before start', async () => {
      const made = subject();
      await expect(made.operate()).rejects.toMatchObject({
        code: 'NotStarted',
      });
    });

    it('operate rejects with Starting while start is pending', async () => {
      await proxy.refuse();
      const made = subject();
      const starting = made.start().catch((error: unknown) => error);
      await expect(made.operate()).rejects.toMatchObject({
        code: 'Starting',
      });
      await made.stop();
      expect(await starting).toMatchObject({ code: 'Stopped' });
    });

    it('start rejects with Stopped when stop is called while Redis is down', async () => {
      await proxy.refuse();
      const made = subject();
      const starting = made.start().catch((error: unknown) => error);
      await delay(100);
      await made.stop();
      expect(await starting).toMatchObject({ code: 'Stopped' });
    });

    it('start rejects with Stopped when stop follows it at once', async () => {
      for (let run = 0; run < 20; run += 1) {
        const made = subject();
        const starting = made.start().catch((error: unknown) => error);
        await made.stop();
        expect(await starting).toMatchObject({ code: 'Stopped' });
      }
    });

    it('operate rejects with Stopped after stop', async () => {
      const made = subject();
      await made.start();
      await made.stop();
      await expect(made.operate()).rejects.toMatchObject({ code: 'Stopped' });
    });

    it('an operation queued during an outage rejects with StoppedBeforeReply on stop', async () => {
      const made = subject();
      await made.start();
      await proxy.refuse();
      proxy.drop();
      await delay(100);
      const operating = made.operate().catch((error: unknown) => error);
      const ms = await timedStop(made);
      expect(await operating).toMatchObject({ code: 'StoppedBeforeReply' });
      expect(ms).toBeLessThan(stopTimeoutMs + slackMs);
    });

    it('stop resolves within stopTimeoutMs while Redis refuses connections', async () => {
      track();
      const made = subject();
      await made.start();
      await made.operate();
      await proxy.refuse();
      proxy.drop();
      await delay(100);
      expect(await timedStop(made)).toBeLessThan(stopTimeoutMs + slackMs);
      await expectNoHandles();
    });

    it('stop resolves within stopTimeoutMs while Redis is blackholed', async () => {
      track();
      const made = subject();
      await made.start();
      await made.operate();
      proxy.blackhole();
      expect(await timedStop(made)).toBeLessThan(stopTimeoutMs + slackMs);
      await expectNoHandles();
    });

    it('an operation in flight while Redis is blackholed rejects with StoppedBeforeReply on stop', async () => {
      const made = subject();
      await made.start();
      await made.operate();
      proxy.blackhole();
      const operating = made.operate().catch((error: unknown) => error);
      expect(await timedStop(made)).toBeLessThan(stopTimeoutMs + slackMs);
      expect(await operating).toMatchObject({ code: 'StoppedBeforeReply' });
    });

    it('stop resolves within stopTimeoutMs right after the connections drop', async () => {
      track();
      const made = subject();
      await made.start();
      await made.operate();
      proxy.drop();
      expect(await timedStop(made)).toBeLessThan(stopTimeoutMs + slackMs);
      await expectNoHandles();
    });

    it('stop leaves no handles', async () => {
      track();
      const made = subject();
      await made.start();
      await made.operate();
      await made.stop();
      await expectNoHandles();
    });

    it('start works again after stop', async () => {
      const made = subject();
      await made.start();
      await made.operate();
      await made.stop();
      await made.start();
      await made.operate();
      await made.stop();
    });
  });
}

interface HandleTracker {
  /** Sockets and timers created since tracking began and not yet destroyed, less `others` sockets. */
  live(others: number): { sockets: number; timers: number };
  /** Calls `create` without tracking what it creates, such as the poll timer. */
  untracked<T>(create: () => T): T;
  disable(): void;
}

/**
 * Tracks sockets and timers by their async hooks, from creation to `destroy`.
 * `process.getActiveResourcesInfo()` stops counting an interval after it first fires, so it cannot find a leaked interval.
 */
function trackHandles(): HandleTracker {
  const live = new Map<number, 'socket' | 'timer'>();
  const hook = createHook({
    init(asyncId, type) {
      if (type === 'TCPWRAP') live.set(asyncId, 'socket');
      if (type === 'Timeout') live.set(asyncId, 'timer');
    },
    destroy(asyncId) {
      live.delete(asyncId);
    },
  }).enable();
  return {
    live(others) {
      let sockets = 0;
      let timers = 0;
      for (const kind of live.values()) {
        if (kind === 'socket') sockets += 1;
        else timers += 1;
      }
      return { sockets: sockets - others, timers };
    },
    untracked(create) {
      hook.disable();
      try {
        return create();
      } finally {
        hook.enable();
      }
    },
    disable() {
      hook.disable();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
