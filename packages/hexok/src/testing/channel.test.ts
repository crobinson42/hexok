import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  ApiUseCase,
  EventChannel,
  type ExecuteCtx,
  type JoinCtx,
  type RefreshCtx,
  type RouteCtx,
} from '../app/index.js';
import { CodedError } from '../core/index.js';
import {
  type ChannelConnection,
  DomainEvent,
  EventCatalog,
  Port,
} from '../domain/index.js';
import { App } from './app-test.js';
import { InMemoryBus } from './in-memory-bus.js';
import { InMemoryChannel } from './in-memory-channel.js';

class NotePosted extends DomainEvent {
  static readonly key = 'note.posted';
  static readonly schema = z.object({ text: z.string() });
  constructor(
    public readonly payload: { text: string },
    public readonly ctx: { userIds: string[] } | { all: true },
  ) {
    super();
  }
}

const ClientEvents = new EventCatalog('client', { kind: 'bus' })
  .ctx<{ userIds: string[] } | { all: true }>()
  .event(NotePosted);

const actorSchema = z.object({
  userId: z.string(),
  organizationIds: z.array(z.string()),
});
type Actor = z.infer<typeof actorSchema>;

interface Users {
  get(id: string): Promise<Actor | null>;
}
const Users = Port.token<Users>('Users');

class ClientChannel extends EventChannel {
  static readonly catalog = ClientEvents;
  static readonly ports = { users: Users };
  static readonly joinInput = actorSchema;
  static readonly errors = {
    FORBIDDEN: { message: 'Forbidden' },
  };

  async join({ input, errors }: JoinCtx<typeof ClientChannel>): Promise<Actor> {
    if (input.userId === 'blocked') throw errors.FORBIDDEN();
    return input;
  }

  async refresh({
    session,
    ports,
  }: RefreshCtx<typeof ClientChannel>): Promise<Actor | 'eject'> {
    const user = await ports.users.get(session.userId);
    if (!user) return 'eject';
    return user;
  }

  async route({ ctx, clients, send }: RouteCtx<typeof ClientChannel>) {
    for (const { id, session } of clients) {
      if ('all' in ctx) {
        await send(id);
        continue;
      }
      if (ctx.userIds.includes(session.userId)) await send(id);
    }
  }
}

class PostNote extends ApiUseCase {
  static readonly key = 'note.post';
  static readonly input = z.object({
    text: z.string(),
    userIds: z.array(z.string()),
  });
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = {};
  static readonly publishes = [ClientEvents] as const;

  async execute({ input, publish }: ExecuteCtx<typeof PostNote>) {
    publish(new NotePosted({ text: input.text }, { userIds: input.userIds }));
    return {};
  }
}

class KickUser extends ApiUseCase {
  static readonly key = 'note.kick';
  static readonly input = z.object({ userId: z.string() });
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = {};
  static readonly channels = [ClientChannel] as const;

  async execute({ input, channels }: ExecuteCtx<typeof KickUser>) {
    channels.client.ejectWhere((session) => session.userId === input.userId);
    return {};
  }
}

class RefreshUser extends ApiUseCase {
  static readonly key = 'note.refresh';
  static readonly input = z.object({ userId: z.string() });
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = {};
  static readonly channels = [ClientChannel] as const;

  async execute({ input, channels }: ExecuteCtx<typeof RefreshUser>) {
    await channels.client.refreshWhere(
      (session) => session.userId === input.userId,
    );
    return {};
  }
}

function fakeSocket() {
  const listeners = new Set<() => void>();
  const sent: string[] = [];
  let closed = false;
  const socket: ChannelConnection & { sent: string[]; closed: boolean } = {
    sent,
    get closed() {
      return closed;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      closed = true;
      for (const listener of listeners) listener();
    },
    addEventListener(type: 'close', listener: () => void) {
      if (type === 'close') listeners.add(listener);
    },
  };
  return socket;
}

function messages(socket: { sent: string[] }) {
  return socket.sent.map((row) => JSON.parse(row) as Record<string, unknown>);
}

const ada: Actor = { userId: 'ada', organizationIds: ['org-1'] };
const bob: Actor = { userId: 'bob', organizationIds: ['org-2'] };

function users(store: Map<string, Actor>): Users {
  return {
    async get(id) {
      return store.get(id) ?? null;
    },
  };
}

describe('EventChannel', () => {
  it('joins, routes to matching sessions, and omits ctx on the wire', async () => {
    const presence = InMemoryChannel.create<Actor>();
    const app = App.test({ post: PostNote })
      .provide(Users, users(new Map([['ada', ada]])))
      .bind(ClientEvents, InMemoryBus.create())
      .route(ClientChannel, presence)
      .build();
    await app.start();

    const member = fakeSocket();
    const outsider = fakeSocket();
    await app.channels.client.join(ada, member);
    await app.channels.client.join(bob, outsider);

    await app.local.note.post({ text: 'hi', userIds: ['ada'] });

    expect(messages(member)).toEqual([
      expect.objectContaining({
        catalog: 'client',
        key: 'note.posted',
        payload: { text: 'hi' },
      }),
    ]);
    expect(messages(member)[0]).not.toHaveProperty('ctx');
    expect(outsider.sent).toEqual([]);
    await app.stop();
  });

  it('rejects a forbidden join', async () => {
    const app = App.test({ post: PostNote })
      .provide(Users, users(new Map()))
      .bind(ClientEvents, InMemoryBus.create())
      .route(ClientChannel, InMemoryChannel.create<Actor>())
      .build();
    const socket = fakeSocket();
    await expect(
      app.channels.client.join(
        { userId: 'blocked', organizationIds: ['org-1'] },
        socket,
      ),
    ).rejects.toBeInstanceOf(CodedError);
    expect(socket.closed).toBe(false);
  });

  it('refreshes claims and ejects when refresh returns eject', async () => {
    const store = new Map<string, Actor>([['ada', ada]]);
    const presence = InMemoryChannel.create<Actor>();
    const app = App.test({ post: PostNote, refresh: RefreshUser })
      .provide(Users, users(store))
      .bind(ClientEvents, InMemoryBus.create())
      .route(ClientChannel, presence)
      .build();
    await app.start();
    const socket = fakeSocket();
    await app.channels.client.join(ada, socket);

    store.set('ada', { userId: 'ada', organizationIds: ['org-9'] });
    await app.local.note.refresh({ userId: 'ada' });
    expect(app.channels.client.list()[0]?.session.organizationIds).toEqual([
      'org-9',
    ]);

    store.delete('ada');
    await app.local.note.refresh({ userId: 'ada' });
    expect(app.channels.client.list()).toEqual([]);
    expect(socket.closed).toBe(true);
    await app.stop();
  });

  it('ejects every connection for a user', async () => {
    const presence = InMemoryChannel.create<Actor>();
    const app = App.test({ post: PostNote, kick: KickUser })
      .provide(Users, users(new Map()))
      .bind(ClientEvents, InMemoryBus.create())
      .route(ClientChannel, presence)
      .build();
    const tab1 = fakeSocket();
    const tab2 = fakeSocket();
    const other = fakeSocket();
    await app.channels.client.join(ada, tab1);
    await app.channels.client.join(ada, tab2);
    await app.channels.client.join(bob, other);

    await app.local.note.kick({ userId: 'ada' });
    expect(tab1.closed).toBe(true);
    expect(tab2.closed).toBe(true);
    expect(other.closed).toBe(false);
    expect(app.channels.client.list()).toHaveLength(1);
  });

  it('types build as unrouted when a use case declares the channel', () => {
    const builder = App.test({ kick: KickUser })
      .provide(Users, users(new Map()))
      .bind(ClientEvents, InMemoryBus.create());
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`hexok: unrouted channel "client" (used by note.kick). Call .route(...) before .build()`>();
  });

  it('throws when routing a queue catalog', () => {
    const Jobs = new EventCatalog('jobs', { kind: 'queue' }).event(NotePosted);
    class JobChannel extends EventChannel {
      static readonly catalog = Jobs;
      static readonly joinInput = actorSchema;
      async join({ input }: JoinCtx<typeof JobChannel>): Promise<Actor> {
        return input;
      }
      async refresh({
        session,
      }: RefreshCtx<typeof JobChannel>): Promise<Actor | 'eject'> {
        return session;
      }
      async route(): Promise<void> {}
    }
    const builder = App.test({ post: PostNote }).provide(
      Users,
      users(new Map()),
    );
    const _typeChecks = () => {
      // @ts-expect-error queue catalogs cannot be routed
      builder.route(JobChannel, InMemoryChannel.create<Actor>());
    };
    void _typeChecks;
    expect(() =>
      (
        builder as unknown as {
          route: (c: unknown, a: unknown) => { build: () => unknown };
        }
      ).route(JobChannel, InMemoryChannel.create<Actor>()),
    ).toThrow(/Channels require a bus catalog/);
  });
});
