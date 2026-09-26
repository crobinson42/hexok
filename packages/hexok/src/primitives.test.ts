import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { Adapter } from './adapter.js';
import {
  EventCatalog,
  type EventInstance,
  type EventMessage,
} from './catalog.js';
import { CodedError } from './coded-error.js';
import { Entity } from './entity.js';
import { Errors } from './errors.js';
import { Event } from './event.js';
import { EventHandler } from './event-handler.js';
import { Port } from './port.js';
import { Schema } from './schema.js';
import { UseCase } from './use-case.js';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

class UserSchema extends Schema('User', userSchema) {}

class DomainError extends Errors('domain', {
  BlankName: { message: 'Name is blank' },
  AlreadyClosed: { message: 'Incident already closed' },
  UserExists: { message: 'User already exists' },
}) {}

class User extends Entity('User', UserSchema) {}

class UserA extends Entity('UserA', userSchema) {
  rename(name: string): this {
    if (name.trim() === '') throw DomainError.BlankName();
    return this.set((draft) => {
      draft.name = name;
    });
  }
}

class UserB extends Entity('UserB', userSchema) {}

const incidentSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'closed']),
  closedAt: z.date().optional(),
});

class Incident extends Entity('Incident', incidentSchema) {
  close(now: Date): this {
    if (this.props.status === 'closed') throw DomainError.AlreadyClosed();
    return this.set((draft) => {
      draft.status = 'closed';
      draft.closedAt = now;
    });
  }
}

abstract class UserRepository extends Port('UserRepository') {
  abstract get(id: string): Promise<User | null>;
  abstract save(user: User): Promise<void>;
}

class InMemoryUsers extends Adapter(UserRepository) {
  #rows = new Map<string, ReturnType<User['toProps']>>();

  override async get(id: string): Promise<User | null> {
    const props = this.#rows.get(id);
    return props === undefined ? null : User.restore(props);
  }

  override async save(user: User): Promise<void> {
    this.#rows.set(user.props.id, user.toProps());
    user.commit();
  }
}

class CreateUser extends UseCase('user.create') {
  constructor(private readonly users: UserRepository) {
    super();
  }

  override async execute(input: {
    id: string;
    name: string;
    email: string;
  }): Promise<{ id: string; email: string }> {
    const existing = await this.users.get(input.id);
    if (existing) throw DomainError.UserExists();
    const user = User.create(input);
    await this.users.save(user);
    return { id: user.props.id, email: user.props.email };
  }
}

class UserCreated extends Event('user.created', userSchema) {}

class DomainEvents extends EventCatalog('domain', {
  userCreated: UserCreated,
}) {}

class Trimmed extends Schema('Trimmed', z.string()) {
  static override parse(value: unknown): string {
    const raw = typeof value === 'string' ? value.trim() : value;
    return super.parse(raw);
  }
}

describe('tokens and required members', () => {
  it('keeps token literals and schema output', () => {
    expectTypeOf(User.token).toEqualTypeOf<'User'>();
    expectTypeOf(UserSchema.token).toEqualTypeOf<'User'>();
    expectTypeOf(CreateUser.token).toEqualTypeOf<'user.create'>();
    expectTypeOf(UserRepository.token).toEqualTypeOf<'UserRepository'>();
    expectTypeOf(InMemoryUsers.token).toEqualTypeOf<'UserRepository'>();
    expectTypeOf(UserCreated.token).toEqualTypeOf<'user.created'>();
    expectTypeOf(DomainEvents.token).toEqualTypeOf<'domain'>();
    expectTypeOf(DomainEvents.events.userCreated).toEqualTypeOf<
      typeof UserCreated
    >();
    expect(User.token).toBe('User');
  });

  it('types execute from the subclass method', () => {
    const create = new CreateUser(new InMemoryUsers());
    expectTypeOf(create.execute).parameters.toEqualTypeOf<
      [{ id: string; name: string; email: string }]
    >();
    expectTypeOf(create.execute).returns.toEqualTypeOf<
      Promise<{ id: string; email: string }>
    >();
  });

  it('rejects a missing use-case method, a missing port method, and a structural port', () => {
    // @ts-expect-error missing execute
    class Forgot extends UseCase('forgot') {}
    void Forgot;

    // @ts-expect-error a use case does not take an error map
    class Mapped extends UseCase('mapped', { UserExists: {} }) {
      override async execute(): Promise<void> {}
    }
    void Mapped;

    // @ts-expect-error an entity does not take an error map
    class MappedUser extends Entity('MappedUser', userSchema, {
      BlankName: {},
    }) {}
    void MappedUser;

    // @ts-expect-error missing get and save
    class Incomplete extends Adapter(UserRepository) {}
    void Incomplete;

    class Duck {
      async get(_id: string): Promise<User | null> {
        return null;
      }
      async save(_user: User): Promise<void> {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    function takes(repo: UserRepository): void {
      void repo;
    }
    // @ts-expect-error a lookalike is not a UserRepository
    takes(new Duck());
  });

  it('does not treat two entity classes as the same type', () => {
    function takesA(user: UserA): void {
      void user;
    }
    const props = { id: '1', name: 'A', email: 'a@b.c' };
    // @ts-expect-error UserB is a different entity
    takesA(UserB.create(props));
    // @ts-expect-error constructor is protected
    new User(props);
  });
});

describe('Entity', () => {
  const props = { id: '1', name: 'Ada', email: 'ada@ex.com' };

  it('creates a validated new entity and refuses a bad rename', () => {
    const user = UserA.create(props);
    expect(user.isNew).toBe(true);
    expect(user.isDirty()).toBe(true);
    expect(user.props.name).toBe('Ada');
    expect(() => user.rename('')).toThrow(DomainError);
    expect(user.props.name).toBe('Ada');
  });

  it('rolls back a write the schema rejects', () => {
    const incident = Incident.create({ id: 'i', status: 'open' });
    expect(() =>
      incident.set((draft) => {
        draft.status = 'nope' as 'open';
      }),
    ).toThrow(CodedError);
    expect(incident.props.status).toBe('open');
  });

  it('restores without validating and parses unknown input', () => {
    const restored = Incident.restore({
      id: 'i',
      status: 'nope' as 'open',
    });
    expect(restored.isNew).toBe(false);
    expect(restored.isValidated).toBe(false);
    expect(() => restored.validate()).toThrow(CodedError);

    const parsed = User.parse({ id: '2', name: 'Bea', email: 'bea@ex.com' });
    expect(parsed.isNew).toBe(false);
    expect(parsed.isValidated).toBe(true);
    expect(() => User.parse({ id: 1 })).toThrow(CodedError);
  });

  it('tracks changes until commit', () => {
    const incident = Incident.create({ id: 'i', status: 'open' });
    incident.commit();
    expect(incident.isDirty()).toBe(false);
    const now = new Date('2026-01-01T00:00:00Z');
    incident.close(now);
    expect(incident.getChangedKeys()).toEqual(['status', 'closedAt']);
    expect(incident.toProps().closedAt).toEqual(now);
    incident.commit();
    expect(incident.isDirty()).toBe(false);
  });

  it('throws a catalog member when a rule refuses', () => {
    const incident = Incident.create({ id: 'i', status: 'closed' });
    expect(() => incident.close(new Date())).toThrow(DomainError);
    try {
      incident.close(new Date());
    } catch (error) {
      expect(DomainError.is(error) && error.code === 'AlreadyClosed').toBe(
        true,
      );
    }
  });
});

describe('UseCase, Adapter, Event, Schema', () => {
  it('wires a use case by constructor', async () => {
    const users = new InMemoryUsers();
    await users.start();
    const created = await new CreateUser(users).execute({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });
    expect(created).toEqual({ id: '1', email: 'ada@ex.com' });
    await expect(
      new CreateUser(users).execute({
        id: '1',
        name: 'Ada',
        email: 'ada@ex.com',
      }),
    ).rejects.toThrow(DomainError);
    await users.stop();
  });

  it('types catalog messages from the event map', () => {
    class UserRenamed extends Event(
      'user.renamed',
      z.object({ id: z.string(), name: z.string() }),
    ) {}
    class Catalog extends EventCatalog('domain', {
      userCreated: UserCreated,
      userRenamed: UserRenamed,
    }) {}

    expectTypeOf<EventMessage<typeof Catalog>>().toEqualTypeOf<
      | {
          key: 'userCreated';
          payload: { id: string; name: string; email: string };
        }
      | { key: 'userRenamed'; payload: { id: string; name: string } }
    >();
    expectTypeOf<EventMessage<typeof Catalog, 'userRenamed'>>().toEqualTypeOf<{
      key: 'userRenamed';
      payload: { id: string; name: string };
    }>();
    expectTypeOf<EventInstance<typeof Catalog>>().toEqualTypeOf<
      UserCreated | UserRenamed
    >();
    expectTypeOf<
      EventInstance<typeof Catalog, 'userRenamed'>
    >().toEqualTypeOf<UserRenamed>();

    function publishInstance(event: EventInstance<typeof Catalog>): string {
      switch (event.token) {
        case 'user.created':
          return event.payload.email;
        case 'user.renamed':
          return event.payload.name;
        default: {
          const leftover: never = event;
          return leftover;
        }
      }
    }
    expect(
      publishInstance(
        new UserCreated({ id: '1', name: 'Ada', email: 'ada@ex.com' }),
      ),
    ).toBe('ada@ex.com');
    expect(publishInstance(new UserRenamed({ id: '1', name: 'Ada' }))).toBe(
      'Ada',
    );
    // @ts-expect-error an instance is required
    publishInstance({
      token: 'user.created',
      payload: { id: '1', name: 'Ada', email: 'ada@ex.com' },
    });

    function publish(event: EventMessage<typeof Catalog>): void {
      void event;
    }
    publish({
      key: 'userCreated',
      payload: { id: '1', name: 'Ada', email: 'ada@ex.com' },
    });
    // @ts-expect-error email is required for userCreated
    publish({ key: 'userCreated', payload: { id: '1', name: 'Ada' } });
    publish({
      // @ts-expect-error catalog key, not the event token
      key: 'user.created',
      payload: { id: '1', name: 'Ada', email: 'ada@ex.com' },
    });

    // @ts-expect-error the event map is static
    type InstanceMessage = EventMessage<Catalog>;
    const _ignored: InstanceMessage | undefined = undefined;
    void _ignored;
  });

  it('parses an event and looks it up on the catalog', () => {
    const event = UserCreated.parse({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });
    expect(event).toBeInstanceOf(UserCreated);
    expect(event.payload.email).toBe('ada@ex.com');
    expect(event.token).toBe('user.created');
    expectTypeOf(event.token).toEqualTypeOf<'user.created'>();
    expect(DomainEvents.get('userCreated')).toBe(UserCreated);
    expect(() => UserCreated.parse({ id: '1', name: 'Ada', email: 1 })).toThrow(
      CodedError,
    );
  });

  it('converts a catalog instance to a message and back', () => {
    class UserRenamed extends Event(
      'user.renamed',
      z.object({ id: z.string(), name: z.string() }),
    ) {}
    class Catalog extends EventCatalog('domain', {
      userCreated: UserCreated,
      userRenamed: UserRenamed,
    }) {}
    class UserInvited extends Event('user.invited', userSchema) {}
    const created = new UserCreated({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });
    // @ts-expect-error a different token is a different event
    const _samePayload: UserCreated = new UserInvited({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });
    void _samePayload;

    expect(Catalog.message(created)).toEqual({
      key: 'userCreated',
      payload: created.payload,
    });
    const parsed = Catalog.parse(Catalog.message(created));
    expect(parsed).toBeInstanceOf(UserCreated);
    expect(parsed.payload).toEqual(created.payload);
    expect(Catalog.message(new UserRenamed({ id: '1', name: 'Ada' })).key).toBe(
      'userRenamed',
    );
    expect(() =>
      Catalog.message(
        new UserInvited(created.payload) as unknown as UserCreated,
      ),
    ).toThrow(/not in catalog/);
    expect(() => Catalog.parse(null)).toThrow(/expected \{ key, payload \}/);
    expect(() => Catalog.parse({ key: 'missing', payload: {} })).toThrow(
      /not in catalog/,
    );
    expect(() =>
      Catalog.parse({ key: 'userCreated', payload: { id: 1 } }),
    ).toThrow(CodedError);
  });

  it('binds a handler to one event', () => {
    class OnCreated extends EventHandler('on.user.created', UserCreated) {
      handle(event: UserCreated): void {
        expectTypeOf(event.payload.email).toEqualTypeOf<string>();
        expect(event.payload.email).toBe('ada@ex.com');
      }
    }

    const created = new UserCreated({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });
    expect(OnCreated.token).toBe('on.user.created');
    expect(OnCreated.event).toBe(UserCreated);
    new OnCreated().handle(created);

    // @ts-expect-error handle is required
    class Missing extends EventHandler('missing', UserCreated) {}
    void Missing;
  });

  it('rejects a catalog that registers one event token twice', () => {
    class Again extends Event('user.created', userSchema) {}
    expect(() => EventCatalog('domain', { a: UserCreated, b: Again })).toThrow(
      /duplicate event/,
    );
  });

  it('lets a schema override parse', () => {
    expect(Trimmed.parse('  ada  ')).toBe('ada');
    expectTypeOf(Trimmed.token).toEqualTypeOf<'Trimmed'>();
  });
});
