import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  ApiUseCase,
  type EventCtx,
  EventUseCase,
  type ExecuteCtx,
} from '../app/index.js';
import {
  DomainEvent,
  type Envelope,
  EventCatalog,
  Port,
} from '../domain/index.js';
import { App } from './app.js';

interface OrganizationRepository {
  get(id: string): Promise<{ id: string; name: string } | null>;
  save(organization: { id: string; name: string }): Promise<void>;
}
const OrganizationRepository = Port.token<OrganizationRepository>(
  'OrganizationRepository',
);

interface UserRepository {
  getUser(
    id: string,
  ): Promise<{ id: string; organizationId: string; name: string } | null>;
  saveUser(user: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<void>;
}
const UserRepository = Port.token<UserRepository>('UserRepository');

class OrganizationCreated extends DomainEvent {
  static readonly key = 'organization.created';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: { id: string }) {
    super();
  }
}

class UserCreated extends DomainEvent {
  static readonly key = 'user.created';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: { id: string }) {
    super();
  }
}

class HandlerMark extends DomainEvent {
  static readonly key = 'handler.mark';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: { id: string }) {
    super();
  }
}

const DomainEvents = new EventCatalog('domain', { kind: 'bus' })
  .event(OrganizationCreated)
  .event(UserCreated)
  .event(HandlerMark);

class CreateUser extends ApiUseCase {
  static readonly key = 'user.create';
  static readonly internal = true;
  static readonly input = z.object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
  });
  static readonly output = z.object({ id: z.string(), name: z.string() });
  static readonly errors = {
    USER_EXISTS: { message: 'User already exists' },
  } as const;
  static readonly ports = { users: UserRepository };
  static readonly publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof CreateUser>) {
    const existing = await ports.users.getUser(input.id);
    if (existing) throw errors.USER_EXISTS();
    const user = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
    };
    await ports.users.saveUser(user);
    publish(new UserCreated({ id: user.id }));
    return { id: user.id, name: user.name };
  }
}

class InviteUser extends ApiUseCase {
  static readonly key = 'user.invite';
  static readonly input = z.object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
  });
  static readonly output = z.object({ id: z.string(), name: z.string() });
  static readonly errors = {
    USER_EXISTS: { message: 'User already exists' },
  } as const;
  static readonly ports = { users: UserRepository };
  static readonly publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof InviteUser>) {
    const existing = await ports.users.getUser(input.id);
    if (existing) throw errors.USER_EXISTS();
    const user = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
    };
    await ports.users.saveUser(user);
    publish(new UserCreated({ id: user.id }));
    return { id: user.id, name: user.name };
  }
}

class RegisterOrganization extends ApiUseCase {
  static readonly key = 'organization.register';
  static readonly input = z.object({
    organization: z.object({ id: z.string(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string() }),
  });
  static readonly output = z.object({
    organization: z.object({ id: z.string(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string() }),
  });
  static readonly errors = {
    ORGANIZATION_EXISTS: { message: 'Organization already exists' },
    FAIL: { message: 'fail' },
    ...CreateUser.errors,
  } as const;
  static readonly ports = { organizations: OrganizationRepository };
  static readonly publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
    run,
  }: ExecuteCtx<typeof RegisterOrganization>) {
    const existing = await ports.organizations.get(input.organization.id);
    if (existing) throw errors.ORGANIZATION_EXISTS();
    const organization = {
      id: input.organization.id,
      name: input.organization.name,
    };
    await ports.organizations.save(organization);
    publish(new OrganizationCreated({ id: organization.id }));
    const user = await run(CreateUser, {
      ...input.user,
      organizationId: organization.id,
    });
    if (input.organization.id === 'boom') throw errors.FAIL();
    return { organization, user };
  }
}

class RunInvite extends ApiUseCase {
  static readonly key = 'organization.invite';
  static readonly input = RegisterOrganization.input;
  static readonly output = RegisterOrganization.output;
  static readonly errors = RegisterOrganization.errors;
  static readonly ports = { organizations: OrganizationRepository };
  static readonly publishes = [DomainEvents] as const;

  async execute({ input, ports, publish, run }: ExecuteCtx<typeof RunInvite>) {
    const organization = {
      id: input.organization.id,
      name: input.organization.name,
    };
    await ports.organizations.save(organization);
    publish(new OrganizationCreated({ id: organization.id }));
    const user = await run(InviteUser, {
      ...input.user,
      organizationId: organization.id,
    });
    return { organization, user };
  }
}

class ForwardUser extends ApiUseCase {
  static readonly key = 'user.forward';
  static readonly input = z.object({ raw: z.unknown() });
  static readonly output = CreateUser.output;
  static readonly errors = {} as const;
  static readonly ports = { organizations: OrganizationRepository };

  async execute({ input, run }: ExecuteCtx<typeof ForwardUser>) {
    return run(
      CreateUser,
      input.raw as {
        id: string;
        organizationId: string;
        name: string;
      },
    );
  }
}

class OnOrganizationCreated extends EventUseCase {
  static readonly key = 'organization.onCreated';
  static readonly on = OrganizationCreated;
  static readonly catalog = DomainEvents;
  static readonly publishes = [DomainEvents] as const;
  static readonly errors = { FAIL: { message: 'fail' } } as const;

  async execute({
    event,
    publish,
    run,
    errors,
  }: EventCtx<typeof OnOrganizationCreated>) {
    publish(new HandlerMark({ id: event.payload.id }));
    await run(CreateUser, {
      id: `u-${event.payload.id}`,
      organizationId: event.payload.id,
      name: 'Ada',
    });
    if (event.payload.id === 'boom') throw errors.FAIL();
  }
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

function orgRepo(seed: { id: string; name: string }[] = []) {
  const store = new Map(seed.map((row) => [row.id, row]));
  return {
    async get(id: string) {
      return store.get(id) ?? null;
    },
    async save(row: { id: string; name: string }) {
      store.set(row.id, row);
    },
  } satisfies OrganizationRepository;
}

function userRepo(
  seed: { id: string; organizationId: string; name: string }[] = [],
) {
  const store = new Map(seed.map((row) => [row.id, row]));
  return {
    async getUser(id: string) {
      return store.get(id) ?? null;
    },
    async saveUser(row: { id: string; organizationId: string; name: string }) {
      store.set(row.id, row);
    },
  } satisfies UserRepository;
}

const registerInput = {
  organization: { id: 'o1', name: 'Acme' },
  user: { id: 'u1', name: 'Ada' },
};

describe('nested run', () => {
  it('nested run publishes parent then child after the outer execute returns', async () => {
    const bus = memoryBus();
    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, bus)
      .build();

    const result = await app.local.organization.register(registerInput);
    expect(result).toEqual({
      organization: { id: 'o1', name: 'Acme' },
      user: { id: 'u1', name: 'Ada' },
    });
    expect(bus.published.map((envelope) => envelope.key)).toEqual([
      'organization.created',
      'user.created',
    ]);
  });

  it('outer throw drops inner events', async () => {
    const bus = memoryBus();
    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, bus)
      .build();

    await expect(
      app.local.organization.register({
        organization: { id: 'boom', name: 'Acme' },
        user: { id: 'u1', name: 'Ada' },
      }),
    ).rejects.toMatchObject({ code: 'FAIL' });
    expect(bus.published).toHaveLength(0);
  });

  it('internal use cases are omitted from contract, local, and HTTP but completeness still requires their ports', async () => {
    const incomplete = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .bind(DomainEvents, memoryBus());
    expectTypeOf(
      incomplete.build,
    ).toEqualTypeOf<`kerf: unprovided port "users" (used by user.create). Call .provide(token, impl) before .build()`>();

    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, memoryBus())
      .build();

    expect(app.contract).not.toHaveProperty('user');
    expectTypeOf(app.local).not.toHaveProperty('user');
    expect(app.rpc.routes['user.create']).toBeUndefined();

    const response = await app.router.fetch(
      new Request('http://app/rpc/user/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { id: 'u1', organizationId: 'o1', name: 'Ada' },
        }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("parent runs a child without declaring the child's ports", async () => {
    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, memoryBus())
      .build();

    const result = await app.local.organization.register(registerInput);
    expect(result.user).toEqual({ id: 'u1', name: 'Ada' });
  });

  it('nested run re-validates inner input', async () => {
    const app = App.from({
      forward: ForwardUser,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, memoryBus())
      .build();

    await expect(
      app.local.user.forward({ raw: { id: 1 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('inner coded errors bubble to the outer caller', async () => {
    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(
        UserRepository,
        userRepo([{ id: 'u1', organizationId: 'o1', name: 'Ada' }]),
      )
      .bind(DomainEvents, memoryBus())
      .build();

    await expect(
      app.local.organization.register(registerInput),
    ).rejects.toMatchObject({ code: 'USER_EXISTS' });
  });

  it('a public child can be run nested (shared queue) and invoked via app.local (own queue)', async () => {
    const nestedBus = memoryBus();
    const nested = App.from({
      invite: RunInvite,
      inviteUser: InviteUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, nestedBus)
      .build();

    await nested.local.organization.invite(registerInput);
    expect(nestedBus.published.map((envelope) => envelope.key)).toEqual([
      'organization.created',
      'user.created',
    ]);

    const directBus = memoryBus();
    const direct = App.from({
      invite: RunInvite,
      inviteUser: InviteUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, directBus)
      .build();

    await direct.local.user.invite({
      id: 'u1',
      organizationId: 'o1',
      name: 'Ada',
    });
    expect(directBus.published.map((envelope) => envelope.key)).toEqual([
      'user.created',
    ]);
  });

  it('event handler run joins the handler queue and flushes only if the handler returns', async () => {
    const bus = memoryBus();
    const app = App.from({
      createUser: CreateUser,
      onCreated: OnOrganizationCreated,
    })
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, bus)
      .build();

    await app.start();
    await app.publish({
      key: 'organization.created',
      payload: { id: 'o1' },
      catalog: 'domain',
      kind: 'bus',
      occurredAt: new Date(),
      meta: {},
    });
    expect(bus.published.map((envelope) => envelope.key)).toEqual([
      'organization.created',
      'handler.mark',
      'user.created',
    ]);
    await app.stop();

    const failing = memoryBus();
    const failApp = App.from({
      createUser: CreateUser,
      onCreated: OnOrganizationCreated,
    })
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, failing)
      .build();
    await failApp.start();
    await expect(
      failApp.publish({
        key: 'organization.created',
        payload: { id: 'boom' },
        catalog: 'domain',
        kind: 'bus',
        occurredAt: new Date(),
        meta: {},
      }),
    ).rejects.toMatchObject({ code: 'FAIL' });
    expect(failing.published.map((envelope) => envelope.key)).toEqual([
      'organization.created',
    ]);
    await failApp.stop();
  });

  it('nested run does not re-enter aroundUseCase (or RPC middleware)', async () => {
    let useCaseCalls = 0;
    let middlewareCalls = 0;
    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, memoryBus())
      .intercept({
        key: 'count',
        aroundUseCase: (_uc, next) => async (ctx) => {
          useCaseCalls += 1;
          return next(ctx);
        },
      })
      .use(async ({ next }) => {
        middlewareCalls += 1;
        return next();
      })
      .build();

    await app.local.organization.register(registerInput);
    expect(useCaseCalls).toBe(1);
    expect(middlewareCalls).toBe(1);
  });

  it('run is typed to the child input and output; app.local has no internal key', async () => {
    const app = App.from({
      register: RegisterOrganization,
      createUser: CreateUser,
    })
      .provide(OrganizationRepository, orgRepo())
      .provide(UserRepository, userRepo())
      .bind(DomainEvents, memoryBus())
      .build();

    expectTypeOf(app.local.organization.register).toBeFunction();
    expectTypeOf(app.local).not.toHaveProperty('user');

    const _runTypes = async (
      run: ExecuteCtx<typeof RegisterOrganization>['run'],
    ) => {
      const user = await run(CreateUser, {
        id: 'u1',
        organizationId: 'o1',
        name: 'Ada',
      });
      expectTypeOf(user).toEqualTypeOf<{ id: string; name: string }>();
      // @ts-expect-error child input is not a number id
      await run(CreateUser, { id: 1, organizationId: 'o1', name: 'Ada' });
    };
    void _runTypes;
  });
});
