import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EventUseCase,
  type ExecuteCtx,
  ExternalUseCase,
  type Guard,
} from '../app/index.js';
import { CodedError } from '../core/index.js';
import {
  DomainEvent,
  type Envelope,
  EventCatalog,
  Port,
  type QueueAdapter,
  type QueueConsumeCtx,
} from '../domain/index.js';
import { App } from './app.js';
import { type InvokeDeps, invokeEvent, invokeExternal } from './invoke.js';

interface Clock {
  now(): Date;
}
const Clock = Port.token<Clock>('Clock');

const requireActor: Guard = {
  key: 'actor',
  allow({ ctx, errors }) {
    if (!(ctx as { actor?: unknown } | undefined)?.actor) {
      if (typeof errors.UNAUTHORIZED === 'function') errors.UNAUTHORIZED();
      throw new CodedError({ code: 'UNAUTHORIZED' });
    }
  },
};

const refuseForbidden: Guard = {
  key: 'forbid',
  allow({ errors }) {
    if (typeof errors.FORBIDDEN === 'function') errors.FORBIDDEN();
    throw new CodedError({ code: 'FORBIDDEN' });
  },
};

class PublicPing extends ExternalUseCase {
  static readonly key = 'ping.public';
  static readonly input = z.object({ n: z.number() });
  static readonly output = z.object({ n: z.number() });
  static readonly errors = {} as const;
  static readonly ports = {};
  static readonly guards = [] as const;
  async execute({ input }: ExecuteCtx<typeof PublicPing>) {
    return input;
  }
}

class GuardedPing extends ExternalUseCase {
  static readonly key = 'ping.guarded';
  static readonly input = z.object({ n: z.number() });
  static readonly output = z.object({ n: z.number() });
  static readonly errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
    FORBIDDEN: { message: 'Forbidden' },
  } as const;
  static readonly ports = {};
  static readonly guards = [requireActor] as const;
  async execute({ input }: ExecuteCtx<typeof GuardedPing>) {
    return input;
  }
}

class TwoGuards extends ExternalUseCase {
  static readonly key = 'ping.two';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
    FORBIDDEN: { message: 'Forbidden' },
  } as const;
  static readonly ports = {};
  static readonly guards = [requireActor, refuseForbidden] as const;
  async execute() {
    return {};
  }
}

class ForbiddenPing extends ExternalUseCase {
  static readonly key = 'ping.forbidden';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {
    FORBIDDEN: { message: 'Forbidden' },
  } as const;
  static readonly ports = {};
  static readonly guards = [refuseForbidden] as const;
  async execute() {
    return {};
  }
}

class DuplicateGuards extends ExternalUseCase {
  static readonly key = 'ping.dup';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = {};
  static readonly guards = [
    { key: 'dup', allow() {} },
    { key: 'dup', allow() {} },
  ] as const;
  async execute() {
    return {};
  }
}

class MissingGuards extends ExternalUseCase {
  static readonly key = 'ping.missing';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = {};
  async execute() {
    return {};
  }
}

class InviteUser extends ExternalUseCase {
  static readonly key = 'user.invite';
  static readonly input = z.object({ name: z.string() });
  static readonly output = z.object({ name: z.string() });
  static readonly errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
  } as const;
  static readonly ports = {};
  static readonly guards = [requireActor] as const;
  async execute({ input }: ExecuteCtx<typeof InviteUser>) {
    return input;
  }
}

class RunInvite extends ExternalUseCase {
  static readonly key = 'organization.invite';
  static readonly input = InviteUser.input;
  static readonly output = InviteUser.output;
  static readonly errors = {} as const;
  static readonly ports = {};
  static readonly guards = [] as const;
  async execute({ input, run }: ExecuteCtx<typeof RunInvite>) {
    // Nested run skips child guards (same contract as RunInvite → InviteUser).
    return run(InviteUser, input);
  }
}

class JobPosted extends DomainEvent {
  static readonly key = 'job.posted';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: { id: string }) {
    super();
  }
}

const Jobs = new EventCatalog('jobs', { kind: 'bus' }).event(JobPosted);
const JobQueue = new EventCatalog('jobs-q', { kind: 'queue' }).event(JobPosted);

class SkipHandler extends EventUseCase {
  static readonly key = 'jobs.skip';
  static readonly on = JobPosted;
  static readonly catalog = Jobs;
  static ran = false;
  async execute() {
    SkipHandler.ran = true;
  }
}

class GuardedHandler extends EventUseCase {
  static readonly key = 'jobs.guarded';
  static readonly on = JobPosted;
  static readonly catalog = Jobs;
  static readonly errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
  } as const;
  static readonly guards = [requireActor] as const;
  static ran = false;
  async execute() {
    GuardedHandler.ran = true;
  }
}

class QueueHandler extends EventUseCase {
  static readonly key = 'jobs.queue';
  static readonly on = JobPosted;
  static readonly catalog = JobQueue;
  static readonly group = 'workers';
  static readonly errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
  } as const;
  static readonly guards = [requireActor] as const;
  static ran = false;
  async execute() {
    QueueHandler.ran = true;
  }
}

class PortedHandler extends EventUseCase {
  static readonly key = 'jobs.ported';
  static readonly on = JobPosted;
  static readonly catalog = Jobs;
  static readonly ports = { clock: Clock };
  static readonly errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
  } as const;
  static readonly guards = [requireActor] as const;
  async execute() {}
}

function memoryBus(): {
  kind: 'bus';
  published: Envelope[];
  publish(envelope: Envelope): Promise<void>;
  subscribe(key: string, handler: (e: Envelope) => Promise<void>): void;
} {
  const subs = new Map<string, Array<(e: Envelope) => Promise<void>>>();
  const published: Envelope[] = [];
  return {
    kind: 'bus',
    published,
    async publish(envelope) {
      published.push(envelope);
      for (const handler of subs.get(envelope.key) ?? []) {
        await handler(envelope);
      }
    },
    subscribe(key, handler) {
      const list = subs.get(key) ?? [];
      list.push(handler);
      subs.set(key, list);
    },
  };
}

function memoryQueue(): QueueAdapter & {
  published: Envelope[];
  acked: number;
  nacked: number;
} {
  const consumers: Array<
    (envelope: Envelope, ctx: QueueConsumeCtx) => Promise<void>
  > = [];
  const adapter: QueueAdapter & {
    published: Envelope[];
    acked: number;
    nacked: number;
  } = {
    kind: 'queue',
    published: [],
    acked: 0,
    nacked: 0,
    async publish(envelope) {
      adapter.published.push(envelope);
      for (const consumer of consumers) {
        await consumer(envelope, {
          attempt: 1,
          ack: async () => {
            adapter.acked += 1;
          },
          nack: async () => {
            adapter.nacked += 1;
          },
        });
      }
    },
    consume(_key, _group, handler) {
      consumers.push(handler);
    },
  };
  return adapter;
}

function invokeDeps(overrides?: Partial<InvokeDeps>): InvokeDeps {
  return {
    ports: new Map(),
    catalogs: new Map(),
    interceptors: [],
    middleware: [],
    defaultCtx: undefined,
    started: { value: true },
    handlerKeys: new Set(),
    ...overrides,
  };
}

const jobEnvelope: Envelope = {
  key: 'job.posted',
  payload: { id: '1' },
  catalog: 'jobs',
  kind: 'bus',
  occurredAt: new Date(),
  meta: {},
};

describe('guards', () => {
  it('public empty guards still execute; invalid input is VALIDATION', async () => {
    const app = App.from({ ping: PublicPing }).build();
    expect(await app.local.ping.public({ n: 1 })).toEqual({ n: 1 });
    await expect(app.local.ping.public({} as never)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('throws UNAUTHORIZED before validate when the actor is missing', async () => {
    const app = App.from({ ping: GuardedPing }).build();
    await expect(app.local.ping.guarded({} as never)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('first throwing guard wins', async () => {
    const app = App.from({ ping: TwoGuards }).build();
    await expect(app.local.ping.two({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws at build and invoke on duplicate guard keys', async () => {
    expect(() => App.from({ ping: DuplicateGuards }).build()).toThrow(
      'hexok: ExternalUseCase "ping.dup" has duplicate guard key "dup"',
    );
    await expect(
      invokeExternal(DuplicateGuards, {}, invokeDeps()),
    ).rejects.toThrow(
      'hexok: ExternalUseCase "ping.dup" has duplicate guard key "dup"',
    );
  });

  it('throws at build and invoke when ExternalUseCase omits guards', async () => {
    expect(() =>
      (
        App.from({ ping: MissingGuards as never }) as unknown as {
          build: () => unknown;
        }
      ).build(),
    ).toThrow('hexok: ExternalUseCase "ping.missing" is missing static guards');
    await expect(
      invokeExternal(MissingGuards as never, {}, invokeDeps()),
    ).rejects.toThrow(
      'hexok: ExternalUseCase "ping.missing" is missing static guards',
    );
  });

  it('nested run does not run the child ExternalUseCase guards', async () => {
    const app = App.from({
      invite: RunInvite,
      inviteUser: InviteUser,
    }).build();
    expect(await app.local.organization.invite({ name: 'Ada' })).toEqual({
      name: 'Ada',
    });
    await expect(app.local.user.invite({ name: 'Ada' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('invokeEvent skips omitted guards and runs declared ones', async () => {
    SkipHandler.ran = false;
    GuardedHandler.ran = false;
    const skip = App.from({ skip: SkipHandler })
      .bind(Jobs, memoryBus())
      .build();
    await skip.start();
    await skip.publish(jobEnvelope);
    expect(SkipHandler.ran).toBe(true);
    await skip.stop();

    const guarded = App.from({ guarded: GuardedHandler })
      .bind(Jobs, memoryBus())
      .build();
    await guarded.start();
    await expect(guarded.publish(jobEnvelope)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(GuardedHandler.ran).toBe(false);
    await guarded.stop();
  });

  it('queue consume nacks when an event guard throws', async () => {
    QueueHandler.ran = false;
    const queue = memoryQueue();
    const app = App.from({ queue: QueueHandler }).bind(JobQueue, queue).build();
    await app.start();
    await expect(
      app.publish({
        ...jobEnvelope,
        catalog: 'jobs-q',
        kind: 'queue',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(queue.nacked).toBe(1);
    expect(queue.acked).toBe(0);
    expect(QueueHandler.ran).toBe(false);
    await app.stop();
  });

  it('maps missing actor to HTTP 401 and FORBIDDEN to 403; ignores body.ctx', async () => {
    const app = App.from({
      guarded: GuardedPing,
      forbidden: ForbiddenPing,
    }).build();

    const unauthorized = await app.router.fetch(
      new Request('http://app/rpc/ping/guarded', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { n: 'bad' },
          ctx: { actor: 'spoof' },
        }),
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });

    const forbidden = await app.router.fetch(
      new Request('http://app/rpc/ping/forbidden', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('does not enter aroundUseCase when a guard throws', async () => {
    let entered = 0;
    const app = App.from({ ping: GuardedPing })
      .intercept({
        key: 'count',
        aroundUseCase: (_uc, next) => async (ctx) => {
          entered += 1;
          return next(ctx);
        },
      })
      .build();
    await expect(app.local.ping.guarded({ n: 1 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(entered).toBe(0);
  });

  it('async allow refusals surface as CodedError', async () => {
    const asyncForbid: Guard = {
      key: 'async-forbid',
      allow: async ({ errors }) => {
        if (typeof errors.FORBIDDEN === 'function') errors.FORBIDDEN();
        throw new CodedError({ code: 'FORBIDDEN' });
      },
    };
    class AsyncPing extends ExternalUseCase {
      static readonly key = 'ping.async';
      static readonly input = z.object({});
      static readonly output = z.object({});
      static readonly errors = {
        FORBIDDEN: { message: 'Forbidden' },
      } as const;
      static readonly ports = {};
      static readonly guards = [asyncForbid] as const;
      async execute() {
        return {};
      }
    }
    let entered = 0;
    const app = App.from({ ping: AsyncPing })
      .intercept({
        key: 'count',
        aroundUseCase: (_uc, next) => async (ctx) => {
          entered += 1;
          return next(ctx);
        },
      })
      .build();
    await expect(app.local.ping.async({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(entered).toBe(0);
  });

  it('discourages authenticating by mutating defaultCtx', async () => {
    const defaultCtx: { actor?: string } = {};
    const mutate: Guard = {
      key: 'mutate',
      allow({ ctx }) {
        (ctx as { actor?: string }).actor = 'sneak';
      },
    };
    class MutatePing extends ExternalUseCase {
      static readonly key = 'ping.mutate';
      static readonly input = z.object({});
      static readonly output = z.unknown();
      static readonly errors = {} as const;
      static readonly ports = {};
      static readonly guards = [mutate] as const;
      async execute({ ctx }: ExecuteCtx<typeof MutatePing>) {
        return ctx;
      }
    }
    const app = App.from({ ping: MutatePing }).ctx(defaultCtx).build();
    expect(await app.local.ping.mutate({})).toEqual({ actor: 'sneak' });
    expect(defaultCtx.actor).toBe('sneak');
  });

  it('runs event guards before aliasPorts so refusals do not leak unprovided port', async () => {
    await expect(
      invokeEvent(PortedHandler, jobEnvelope, invokeDeps()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
