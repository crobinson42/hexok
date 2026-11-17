import { MemorySessionStore } from '@hexok/auth';
import { generateSecret, JoseSessionToken } from '@hexok/auth-jose';
import { sessionKey } from '@hexok/auth-redis';
import type { EmailMessage, EmailReceipt } from '@hexok/email';
import { EmailError, EmailSender } from '@hexok/email';
import { type Logger, MemoryLogger, NoopLogger } from '@hexok/logger';
import type { SmsMessage, SmsReceipt } from '@hexok/sms';
import { SmsError, SmsSender } from '@hexok/sms';
import { WebhookError } from '@hexok/webhooks';
import { asResult, createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import { Adapter, CodedError, type EventInstance, type UseCase } from 'hexok';
import { describe, expect, it } from 'vitest';
import { OrganizationEntity } from '../domain/entities/organization.js';
import { PostEntity } from '../domain/entities/post.js';
import { SubscriberEntity } from '../domain/entities/subscriber.js';
import { UserEntity } from '../domain/entities/user.js';
import { DomainError } from '../domain/errors/domain.js';
import type { DomainEvents } from '../domain/events/domain-events.js';
import { PostPublishedEvent } from '../domain/events/post-published.js';
import { PostUnpublishedEvent } from '../domain/events/post-unpublished.js';
import { SubscriberJoinedEvent } from '../domain/events/subscriber-joined.js';
import {
  demoOrganization,
  demoTenancyUsers,
} from '../infra/auth/demo-tenancy.js';
import { JwtSessions, type SessionJwt } from '../infra/auth/jwt-sessions.js';
import {
  demoUsers,
  StaticCredentials,
} from '../infra/auth/static-credentials.js';
import { connectRedis } from '../infra/clients/redis-client.js';
import { createApi } from '../servers/api.js';
import { createHttpHandler } from '../servers/http/handler.js';
import { createApiApp } from '../servers/rpc/app.js';
import type { apiContract } from '../servers/rpc/contract.js';
import { createSessions } from '../servers/runtime/sessions.js';
import { DomainEventPublisher } from './ports/events/domain-event-publisher.js';
import { OrganizationRepository } from './ports/repos/organization-repository.js';
import { PostRepository } from './ports/repos/post-repository.js';
import { SubscriberRepository } from './ports/repos/subscriber-repository.js';
import { UserRepository } from './ports/repos/user-repository.js';
import { Membership } from './services/membership.js';
import { Login } from './use-cases/auth/api/command/login.js';
import { Logout } from './use-cases/auth/api/command/logout.js';
import { WhoAmI } from './use-cases/auth/api/command/who-am-i.js';
import {
  type ApiUseCase,
  type Caller,
  internalCallCtx,
} from './use-cases/context.js';
import { AddMember } from './use-cases/organizations/api/command/add-member.js';
import { CreateOrganization } from './use-cases/organizations/api/command/create-organization.js';
import { ListMine } from './use-cases/organizations/api/command/list-mine.js';
import { PublishPost } from './use-cases/posts/api/command/publish-post.js';
import { SavePost } from './use-cases/posts/api/command/save-post.js';
import { UnpublishPost } from './use-cases/posts/api/command/unpublish-post.js';
import { EmailSubscribersHandler } from './use-cases/posts/event-handlers/email-subscribers.js';
import { EmailUnpublishedHandler } from './use-cases/posts/event-handlers/email-unpublished.js';
import { PostPublishedWebhookHandler } from './use-cases/posts/event-handlers/post-published-webhook.js';
import { SubscriberPostPublishedWebhookHandler } from './use-cases/posts/event-handlers/subscriber-post-published-webhook.js';
import { SubscriberPostUnpublishedWebhookHandler } from './use-cases/posts/event-handlers/subscriber-post-unpublished-webhook.js';
import { PublishDuePosts } from './use-cases/posts/scheduled/publish-due-posts.js';
import { SubscriberReminder } from './use-cases/posts/scheduled/subscriber-reminder.js';
import {
  type CheckWebhookUrl,
  SubscribeToPosts,
} from './use-cases/subscribers/api/command/subscribe.js';
import { WelcomeSubscriberHandler } from './use-cases/subscribers/event-handlers/welcome-subscriber.js';
import { CreateUser } from './use-cases/users/api/command/create-user.js';
import { GetUser } from './use-cases/users/api/command/get-user.js';

const from = { email: 'blog@localhost', name: 'Blog' };

const ctx = { caller: { userId: 'ada' } };
const unsigned = {} as UseCase.Ctx<typeof ApiUseCase>;

type PostProps = ConstructorParameters<typeof PostEntity>[0];

class InMemoryPosts extends Adapter(PostRepository) {
  readonly #rows = new Map<string, PostProps>();

  override async get(id: string): Promise<PostEntity | null> {
    const props = this.#rows.get(id);
    return props === undefined
      ? null
      : PostEntity.restore(structuredClone(props));
  }

  override async save(post: PostEntity): Promise<void> {
    this.#rows.set(post.props.id, structuredClone(post.toProps()));
    post.commit();
  }

  override async listDue(now: Date): Promise<readonly PostEntity[]> {
    const at = now.getTime();
    const due: PostEntity[] = [];
    for (const props of this.#rows.values()) {
      const post = PostEntity.restore(structuredClone(props));
      const publishAt = post.props.publishAt;
      if (
        post.props.status === 'scheduled' &&
        publishAt !== null &&
        Date.parse(publishAt) <= at
      ) {
        due.push(post);
      }
    }
    return due;
  }
}

type SubscriberProps = ConstructorParameters<typeof SubscriberEntity>[0];

class InMemorySubscribers extends Adapter(SubscriberRepository) {
  readonly #rows = new Map<string, SubscriberProps>();

  override async getByEmail(
    organizationId: string,
    email: string,
  ): Promise<SubscriberEntity | null> {
    const props = this.#rows.get(`${organizationId}:${email}`);
    return props === undefined
      ? null
      : SubscriberEntity.restore(structuredClone(props));
  }

  override async getById(id: string): Promise<SubscriberEntity | null> {
    for (const props of this.#rows.values()) {
      if (props.id === id)
        return SubscriberEntity.restore(structuredClone(props));
    }
    return null;
  }

  override async list(): Promise<readonly SubscriberEntity[]> {
    return [...this.#rows.values()].map((props) =>
      SubscriberEntity.restore(structuredClone(props)),
    );
  }

  override async listByOrganization(
    organizationId: string,
  ): Promise<readonly SubscriberEntity[]> {
    return [...this.#rows.values()]
      .filter((props) => props.organizationId === organizationId)
      .map((props) => SubscriberEntity.restore(structuredClone(props)));
  }

  override async save(subscriber: SubscriberEntity): Promise<void> {
    this.#rows.set(
      `${subscriber.props.organizationId}:${subscriber.props.email}`,
      structuredClone(subscriber.toProps()),
    );
    subscriber.commit();
  }
}

type UserProps = ConstructorParameters<typeof UserEntity>[0];

class InMemoryUsers extends Adapter(UserRepository) {
  readonly #rows = new Map<string, UserProps>();

  constructor(rows: readonly UserProps[] = []) {
    super();
    for (const row of rows) {
      this.#rows.set(row.id, structuredClone(row));
    }
  }

  override async get(id: string): Promise<UserEntity | null> {
    const props = this.#rows.get(id);
    return props === undefined
      ? null
      : UserEntity.restore(structuredClone(props));
  }

  override async save(user: UserEntity): Promise<void> {
    this.#rows.set(user.props.id, structuredClone(user.toProps()));
    user.commit();
  }
}

type OrganizationProps = ConstructorParameters<typeof OrganizationEntity>[0];

class InMemoryOrganizations extends Adapter(OrganizationRepository) {
  readonly #rows = new Map<string, OrganizationProps>();

  constructor(rows: readonly OrganizationProps[] = []) {
    super();
    for (const row of rows) {
      this.#rows.set(row.id, structuredClone(row));
    }
  }

  override async get(id: string): Promise<OrganizationEntity | null> {
    const props = this.#rows.get(id);
    return props === undefined
      ? null
      : OrganizationEntity.restore(structuredClone(props));
  }

  override async getMany(
    ids: readonly string[],
  ): Promise<readonly OrganizationEntity[]> {
    const found: OrganizationEntity[] = [];
    for (const id of ids) {
      const organization = await this.get(id);
      if (organization !== null) found.push(organization);
    }
    return found;
  }

  override async save(organization: OrganizationEntity): Promise<void> {
    this.#rows.set(
      organization.props.id,
      structuredClone(organization.toProps()),
    );
    organization.commit();
  }
}

function demoIdentity() {
  return {
    users: new InMemoryUsers(demoTenancyUsers),
    organizations: new InMemoryOrganizations([demoOrganization]),
  };
}

class RecordingDomainEvents extends Adapter(DomainEventPublisher) {
  readonly events: EventInstance<typeof DomainEvents>[] = [];

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    this.events.push(event);
  }
}

function recordingPublishers(): { domainEvents: RecordingDomainEvents } {
  return { domainEvents: new RecordingDomainEvents() };
}

function savePost(
  posts: PostRepository,
  identity: ReturnType<typeof demoIdentity> = demoIdentity(),
): SavePost {
  return new SavePost({
    posts,
    membership: new Membership({ users: identity.users }),
    organizations: identity.organizations,
  });
}

class RecordingEmail extends Adapter(EmailSender) {
  readonly sent: EmailMessage[] = [];
  /** Thrown once, then cleared, so a later recipient still receives mail. */
  fail: Error | undefined;

  override async send(message: EmailMessage): Promise<EmailReceipt> {
    if (this.fail !== undefined) {
      const error = this.fail;
      this.fail = undefined;
      throw error;
    }
    this.sent.push(message);
    return { id: 'test' };
  }
}

class RecordingSms extends Adapter(SmsSender) {
  readonly sent: SmsMessage[] = [];
  fail: Error | undefined;

  override async send(message: SmsMessage): Promise<SmsReceipt> {
    if (this.fail !== undefined) throw this.fail;
    this.sent.push(message);
    return { id: 'test', acceptedAt: new Date() };
  }
}

function senders(
  email: EmailSender,
  sms: SmsSender = new RecordingSms(),
  logger: Logger = new NoopLogger(),
) {
  return { email, sms, from, logger };
}

const acceptWebhookUrl: CheckWebhookUrl = async () => {};

const silentWebhooks = {
  publish: async () => 'msg_test',
};

function recordingWebhooks() {
  const published: Array<{
    organizationId: string;
    eventId: string;
    endpointIds?: readonly string[];
    token: string;
    payload: unknown;
  }> = [];
  return {
    published,
    webhooks: {
      async publish(input: {
        organizationId: string;
        eventId: string;
        endpointIds?: readonly string[];
        event: { token: string; payload: unknown };
      }) {
        published.push({
          organizationId: input.organizationId,
          eventId: input.eventId,
          ...(input.endpointIds === undefined
            ? {}
            : { endpointIds: input.endpointIds }),
          token: input.event.token,
          payload: input.event.payload,
        });
        return 'msg_test';
      },
    },
  };
}

function publishedEvent(
  event: EventInstance<typeof DomainEvents> | undefined,
): PostPublishedEvent {
  expect(event).toBeInstanceOf(PostPublishedEvent);
  if (!(event instanceof PostPublishedEvent)) {
    throw new Error('expected PostPublishedEvent');
  }
  return event;
}

async function expectDomainCode(
  code:
    | 'InternalCallerRequired'
    | 'PostNotFound'
    | 'InvalidCredentials'
    | 'SignInRequired'
    | 'SmsRequiresPhone'
    | 'ChannelsRequired'
    | 'ChannelsInvalid'
    | 'WebhookRequiresUrl'
    | 'WebhookUrlRejected'
    | 'UserNotFound'
    | 'UserAlreadyExists'
    | 'OrganizationNotFound'
    | 'AlreadyMember'
    | 'NotAMember',
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(DomainError.is(error) && error.code === code).toBe(true);
    return;
  }
  expect.fail(`expected ${code}`);
}

/**
 * Signed tokens, the same `JoseSessionToken` HTTP uses. The store is in
 * memory so these tests do not need Redis. The integration test below uses
 * `RedisSessionStore`.
 */
function signedSessions(): SessionJwt {
  return new JwtSessions({
    store: new MemorySessionStore<Caller>({
      idleSeconds: 60,
      absoluteSeconds: 600,
    }),
    token: new JoseSessionToken({
      secrets: [generateSecret()],
      issuer: 'app-template',
      audience: 'app-template-api',
    }),
  });
}

/**
 * The HTTP handler over in-memory ports. The typed client calls it without a
 * socket. `signIn()` opens a session for `ada` and returns its token.
 * `apiAs(token)` sends `Authorization: Bearer <token>`. `post` sends a raw
 * body to check the wire.
 */
function http(
  logger: Logger = new NoopLogger(),
  sessions: SessionJwt = signedSessions(),
) {
  const publishers = recordingPublishers();
  const identity = demoIdentity();
  const api = createApi({
    posts: new InMemoryPosts(),
    subscribers: new InMemorySubscribers(),
    users: identity.users,
    organizations: identity.organizations,
    credentials: new StaticCredentials(demoUsers),
    ...publishers,
    checkWebhookUrl: acceptWebhookUrl,
  });
  const handle = createHttpHandler(createApiApp(api, sessions), {
    sessions,
    logger,
  });
  const fetch: typeof globalThis.fetch = (input, init) =>
    handle(new Request(input, init));
  const headers = (token: string | undefined): HeadersInit =>
    token === undefined ? {} : { authorization: `Bearer ${token}` };
  const rpc = (token?: string) =>
    createClient<typeof apiContract>(
      new FetchLink({ url: 'http://test/rpc', fetch, headers: headers(token) }),
    );
  return {
    publishers,
    signIn: () => sessions.toJwt(ctx.caller),
    api: rpc(),
    apiAs: rpc,
    post: (path: string, body: string, init: { token?: string } = {}) =>
      handle(
        new Request(`http://test${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...headers(init.token),
          },
          body,
        }),
      ),
  };
}

/** A signed-in client for post writes. Subscribe stays on `http().api`. */
async function signedHttp(logger?: Logger) {
  const opened = http(logger);
  const token = await opened.signIn();
  return { ...opened, token, api: opened.apiAs(token) };
}

describe('ApiUseCase', () => {
  it('rejects input the schema does not accept before execute runs', async () => {
    const save = savePost(new InMemoryPosts());
    const error = await save
      .execute(ctx, { title: 1, body: 'Text' } as never)
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe('VALIDATION');
    // The guard's message. `PostEntity.create` would fail with its own.
    expect((error as CodedError).message).toBe('post.save input is invalid');
  });
});

describe('auth', () => {
  const credentials = new StaticCredentials(demoUsers);
  const users = new InMemoryUsers(demoTenancyUsers);
  const login = new Login({ credentials, users });
  const whoAmI = new WhoAmI({ users });

  it('returns the caller when the password matches', async () => {
    expect(
      await login.execute({}, { userId: 'ada', password: 'password' }),
    ).toEqual({ userId: 'ada' });
  });

  it('refuses an unknown user and a wrong password the same way', async () => {
    await expectDomainCode('InvalidCredentials', () =>
      login.execute({}, { userId: 'no-such', password: 'password' }),
    );
    await expectDomainCode('InvalidCredentials', () =>
      login.execute({}, { userId: 'ada', password: 'nope' }),
    );
  });

  it('refuses a matching password when the user record is missing', async () => {
    await expectDomainCode('InvalidCredentials', () =>
      new Login({
        credentials,
        users: new InMemoryUsers(),
      }).execute({}, { userId: 'ada', password: 'password' }),
    );
  });

  it('refuses logout and who-am-i with no caller', async () => {
    await expectDomainCode('SignInRequired', () =>
      new Logout().execute(unsigned, {}),
    );
    await expectDomainCode('SignInRequired', () =>
      whoAmI.execute(unsigned, {}),
    );
  });

  it('who-am-i returns the user the session names', async () => {
    expect((await whoAmI.execute(ctx, {})).toJSON()).toEqual({
      id: 'ada',
      name: 'Ada',
      organizationIds: ['hexok'],
    });
  });
});

describe('users', () => {
  it('creates a user with no memberships', async () => {
    const users = new InMemoryUsers();
    const created = await new CreateUser({ users }).execute(
      {},
      { id: 'cam', name: 'Cam' },
    );

    expect(created.toJSON()).toEqual({
      id: 'cam',
      name: 'Cam',
      organizationIds: [],
    });
    expect((await users.get('cam'))?.toJSON()).toEqual(created.toJSON());
  });

  it('refuses a taken id', async () => {
    const users = new InMemoryUsers(demoTenancyUsers);
    await expectDomainCode('UserAlreadyExists', () =>
      new CreateUser({ users }).execute({}, { id: 'ada', name: 'Ada' }),
    );
  });

  it('gets a user by id', async () => {
    const users = new InMemoryUsers(demoTenancyUsers);
    expect(
      (await new GetUser({ users }).execute(ctx, { id: 'bea' })).toJSON(),
    ).toEqual({
      id: 'bea',
      name: 'Bea',
      organizationIds: ['hexok'],
    });
  });

  it('refuses get with no caller', async () => {
    await expectDomainCode('SignInRequired', () =>
      new GetUser({ users: new InMemoryUsers() }).execute(unsigned, {
        id: 'ada',
      }),
    );
  });

  it('refuses a missing user', async () => {
    await expectDomainCode('UserNotFound', () =>
      new GetUser({ users: new InMemoryUsers() }).execute(ctx, { id: 'cam' }),
    );
  });
});

describe('organizations', () => {
  it('creates an organization and adds the caller as a member', async () => {
    const identity = demoIdentity();
    const created = await new CreateOrganization(identity).execute(ctx, {
      name: 'New Co',
    });

    expect(created.props.name).toBe('New Co');
    expect(created.props.id.length).toBeGreaterThan(0);
    expect((await identity.users.get('ada'))?.props.organizationIds).toEqual([
      'hexok',
      created.props.id,
    ]);
  });

  it('lists the caller organizations', async () => {
    const identity = demoIdentity();
    const listed = await new ListMine(identity).execute(ctx, {});

    expect(listed.map((organization) => organization.toJSON())).toEqual([
      demoOrganization,
    ]);
  });

  it('adds a member without checking the caller belongs', async () => {
    const users = new InMemoryUsers([
      ...demoTenancyUsers,
      { id: 'cam', name: 'Cam', organizationIds: [] },
    ]);
    const organizations = new InMemoryOrganizations([demoOrganization]);
    const member = await new AddMember({ organizations, users }).execute(ctx, {
      organizationId: 'hexok',
      userId: 'cam',
    });

    expect(member.props.organizationIds).toEqual(['hexok']);
  });

  it('refuses a second membership of the same organization', async () => {
    const identity = demoIdentity();
    await expectDomainCode('AlreadyMember', () =>
      new AddMember(identity).execute(ctx, {
        organizationId: 'hexok',
        userId: 'ada',
      }),
    );
  });

  it('refuses create when the caller user is missing', async () => {
    await expectDomainCode('UserNotFound', () =>
      new CreateOrganization({
        users: new InMemoryUsers(),
        organizations: new InMemoryOrganizations(),
      }).execute(ctx, { name: 'New Co' }),
    );
  });

  it('refuses create, add-member, and list-mine with no caller', async () => {
    const identity = demoIdentity();
    await expectDomainCode('SignInRequired', () =>
      new CreateOrganization(identity).execute(unsigned, { name: 'New Co' }),
    );
    await expectDomainCode('SignInRequired', () =>
      new AddMember(identity).execute(unsigned, {
        organizationId: 'hexok',
        userId: 'ada',
      }),
    );
    await expectDomainCode('SignInRequired', () =>
      new ListMine(identity).execute(unsigned, {}),
    );
  });
});

describe('signed-in post writes', () => {
  it('refuses save, publish, and unpublish with no caller', async () => {
    const posts = new InMemoryPosts();
    const domainEvents = new RecordingDomainEvents();
    await expectDomainCode('SignInRequired', () =>
      savePost(posts).execute(unsigned, {
        organizationId: demoOrganization.id,
        title: 'Hello',
        body: 'Text',
      }),
    );
    await expectDomainCode('SignInRequired', () =>
      new PublishPost({
        posts,
        membership: new Membership({ users: demoIdentity().users }),
        domainEvents,
      }).execute(unsigned, {
        id: 'post-1',
      }),
    );
    await expectDomainCode('SignInRequired', () =>
      new UnpublishPost({
        posts,
        membership: new Membership({ users: demoIdentity().users }),
        domainEvents,
      }).execute(unsigned, {
        id: 'post-1',
      }),
    );
  });

  it('refuses save when the caller is not a member', async () => {
    const posts = new InMemoryPosts();
    await expectDomainCode('NotAMember', () =>
      savePost(posts, {
        users: new InMemoryUsers([
          { id: 'ada', name: 'Ada', organizationIds: [] },
        ]),
        organizations: demoIdentity().organizations,
      }).execute(ctx, {
        organizationId: demoOrganization.id,
        title: 'Hello',
        body: 'Text',
      }),
    );
  });
});

describe('SavePost', () => {
  it('assigns an id and stores a draft when id is omitted', async () => {
    const posts = new InMemoryPosts();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });

    expect(saved.props.id.length).toBeGreaterThan(0);
    expect(saved.props.status).toBe('draft');
    expect(saved.isNew).toBe(false);
    const stored = await posts.get(saved.props.id);
    expect(stored?.props.id).toBe(saved.props.id);
    expect(stored?.props.title).toBe('Hello');
    expect(stored?.props.body).toBe('Text');
    expect(stored?.props.status).toBe('draft');
  });

  it('updates the title and keeps status for an existing id', async () => {
    const posts = new InMemoryPosts();
    const save = savePost(posts);
    const saved = await save.execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    const updated = await save.execute(ctx, {
      id: saved.props.id,
      organizationId: demoOrganization.id,
      title: 'Next',
      body: 'Text',
    });

    expect(updated.props.id).toBe(saved.props.id);
    expect(updated.props.title).toBe('Next');
    expect(updated.props.status).toBe('draft');
    const stored = await posts.get(saved.props.id);
    expect(stored?.props.title).toBe('Next');
    expect(stored?.props.status).toBe('draft');
  });
});

describe('PublishPost', () => {
  it('publishes a draft and records emailSubscribers true', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    const published = await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
    });

    expect(published.props.status).toBe('published');
    expect(publishers.domainEvents.events).toHaveLength(1);
    const event = publishedEvent(publishers.domainEvents.events[0]);
    expect(event.payload.postId).toBe(saved.props.id);
    expect(event.payload.emailSubscribers).toBe(true);
    expect((await posts.get(saved.props.id))?.props.status).toBe('published');
  });

  it('records emailSubscribers false', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: false,
    });

    expect(publishers.domainEvents.events).toHaveLength(1);
    expect(
      publishedEvent(publishers.domainEvents.events[0]).payload
        .emailSubscribers,
    ).toBe(false);
  });

  it('throws PostNotFound for a missing id', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    await expectDomainCode('PostNotFound', () =>
      new PublishPost({
        posts,
        membership: new Membership({ users: demoIdentity().users }),
        domainEvents: publishers.domainEvents,
      }).execute(ctx, {
        id: 'missing',
        emailSubscribers: true,
      }),
    );
    expect(publishers.domainEvents.events).toHaveLength(0);
  });

  it('stores a future publishAt and emits nothing', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    const publishAt = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
      publishAt,
    });

    expect(scheduled.props.status).toBe('scheduled');
    expect(scheduled.props.publishAt).toBe(publishAt);
    expect(scheduled.props.emailSubscribers).toBe(true);
    expect(publishers.domainEvents.events).toHaveLength(0);
  });

  it('publishes immediately when publishAt is not in the future', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    const published = await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: false,
      publishAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(published.props.status).toBe('published');
    expect(published.props.publishAt).toBeNull();
    expect(publishers.domainEvents.events).toHaveLength(1);
  });
});

describe('UnpublishPost', () => {
  it('turns a published post into a draft and records PostUnpublishedEvent', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
    });
    expect(publishers.domainEvents.events).toHaveLength(1);

    const draft = await new UnpublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
    });

    expect(draft.props.status).toBe('draft');
    expect(draft.props.publishAt).toBeNull();
    expect((await posts.get(saved.props.id))?.props.status).toBe('draft');
    expect(publishers.domainEvents.events).toHaveLength(2);
    const unpublished = publishers.domainEvents.events[1];
    expect(unpublished).toBeInstanceOf(PostUnpublishedEvent);
    if (!(unpublished instanceof PostUnpublishedEvent)) {
      throw new Error('expected PostUnpublishedEvent');
    }
    expect(unpublished.payload.postId).toBe(saved.props.id);
    expect(unpublished.payload.title).toBe('Hello');
  });

  it('cancels a scheduled post without an unpublished event', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
      publishAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const draft = await new UnpublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, { id: saved.props.id });

    expect(draft.props.status).toBe('draft');
    expect(draft.props.publishAt).toBeNull();
    expect(publishers.domainEvents.events).toHaveLength(0);
  });
});

describe('PublishDuePosts', () => {
  it('publishes a post whose publishAt has passed', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Due',
      body: 'Text',
    });
    const publishAt = new Date(Date.now() + 60_000).toISOString();
    await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
      publishAt,
    });
    const stored = await posts.get(saved.props.id);
    if (stored === null) throw new Error('expected stored post');
    stored.set((draft) => {
      draft.publishAt = new Date(Date.now() - 1000).toISOString();
    });
    await posts.save(stored);

    const count = await new PublishDuePosts({
      posts,
      domainEvents: publishers.domainEvents,
      logger: new NoopLogger(),
    }).execute(internalCallCtx());

    expect(count).toBe(1);
    expect((await posts.get(saved.props.id))?.props.status).toBe('published');
    expect(publishers.domainEvents.events).toHaveLength(1);
    expect(
      publishedEvent(publishers.domainEvents.events[0]).payload
        .emailSubscribers,
    ).toBe(true);
  });

  it('leaves a future post scheduled', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      organizationId: demoOrganization.id,
      title: 'Later',
      body: 'Text',
    });
    await new PublishPost({
      posts,
      membership: new Membership({ users: demoIdentity().users }),
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: false,
      publishAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const count = await new PublishDuePosts({
      posts,
      domainEvents: publishers.domainEvents,
      logger: new NoopLogger(),
    }).execute(internalCallCtx());

    expect(count).toBe(0);
    expect((await posts.get(saved.props.id))?.props.status).toBe('scheduled');
    expect(publishers.domainEvents.events).toHaveLength(0);
  });
});

describe('SubscribeToPosts', () => {
  it('returns the same id when the email is already subscribed', async () => {
    const subscribers = new InMemorySubscribers();
    const publishers = recordingPublishers();
    const subscribe = new SubscribeToPosts({
      subscribers,
      organizations: demoIdentity().organizations,
      domainEvents: publishers.domainEvents,
      checkWebhookUrl: acceptWebhookUrl,
    });
    const first = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
    });
    const second = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
    });

    expect(second.props.id).toBe(first.props.id);
    const listed = await subscribers.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.props.email).toBe('ada@ex.com');
    expect(listed[0]?.props.id).toBe(first.props.id);
    expect(publishers.domainEvents.events).toHaveLength(1);
    const joined = publishers.domainEvents.events[0];
    expect(joined).toBeInstanceOf(SubscriberJoinedEvent);
    if (!(joined instanceof SubscriberJoinedEvent)) {
      throw new Error('expected SubscriberJoinedEvent');
    }
    expect(joined.payload.subscriberId).toBe(first.props.id);
    expect(joined.payload.email).toBe('ada@ex.com');
    expect(joined.payload.channels).toEqual(['email']);
  });

  it('treats the same email in two organizations as two subscribers', async () => {
    const subscribers = new InMemorySubscribers();
    const identity = demoIdentity();
    await identity.organizations.save(
      OrganizationEntity.create({ id: 'other', name: 'Other' }),
    );
    const subscribe = new SubscribeToPosts({
      subscribers,
      organizations: identity.organizations,
      domainEvents: recordingPublishers().domainEvents,
      checkWebhookUrl: acceptWebhookUrl,
    });
    const hexok = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
    });
    const other = await subscribe.execute(ctx, {
      organizationId: 'other',
      email: 'ada@ex.com',
    });
    expect(other.props.id).not.toBe(hexok.props.id);
    expect(await subscribers.list()).toHaveLength(2);
  });

  it('stores email, sms, or both and rejects sms without a phone', async () => {
    const subscribers = new InMemorySubscribers();
    const subscribe = new SubscribeToPosts({
      subscribers,
      organizations: demoIdentity().organizations,
      domainEvents: recordingPublishers().domainEvents,
      checkWebhookUrl: acceptWebhookUrl,
    });
    const both = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
      phone: '+15550001111',
      channels: ['email', 'sms'],
    });
    expect(both.props.channels).toEqual(['email', 'sms']);
    const smsOnly = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'bea@ex.com',
      phone: '+15550002222',
      channels: ['sms'],
    });
    expect(smsOnly.props.channels).toEqual(['sms']);
    expect(smsOnly.props.phone).toBe('+15550002222');
    await expectDomainCode('SmsRequiresPhone', () =>
      subscribe.execute(ctx, {
        organizationId: demoOrganization.id,
        email: 'cy@ex.com',
        channels: ['sms'],
      }),
    );
    await expectDomainCode('ChannelsRequired', () =>
      subscribe.execute(ctx, {
        organizationId: demoOrganization.id,
        email: 'cy@ex.com',
        channels: [],
      }),
    );
    await expectDomainCode('ChannelsInvalid', () =>
      subscribe.execute(ctx, {
        organizationId: demoOrganization.id,
        email: 'cy@ex.com',
        channels: ['email', 'email'],
      }),
    );
  });

  it('stores a webhook subscriber without email or sms delivery', async () => {
    const subscribers = new InMemorySubscribers();
    const subscribe = new SubscribeToPosts({
      subscribers,
      organizations: demoIdentity().organizations,
      domainEvents: recordingPublishers().domainEvents,
      checkWebhookUrl: acceptWebhookUrl,
    });
    const subscriber = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
      channels: ['webhook'],
      url: ' https://ada.example/hooks ',
    });
    expect(subscriber.props.channels).toEqual(['webhook']);
    expect(subscriber.props.phone).toBeUndefined();
    expect(subscriber.props.webhookUrl).toBe('https://ada.example/hooks');
    expect(subscriber.props.webhookSecret?.startsWith('whsec_')).toBe(true);
    const again = await subscribe.execute(ctx, {
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
      channels: ['email'],
      url: 'https://other.example/hooks',
    });
    expect(again.props.id).toBe(subscriber.props.id);
    expect(again.props.channels).toEqual(['webhook']);
    expect(again.props.webhookUrl).toBe('https://ada.example/hooks');
    expect(again.props.webhookSecret).toBe(subscriber.props.webhookSecret);
  });

  it('rejects a webhook without a url, and an unsafe url', async () => {
    const subscribers = new InMemorySubscribers();
    const subscribe = new SubscribeToPosts({
      subscribers,
      organizations: demoIdentity().organizations,
      domainEvents: recordingPublishers().domainEvents,
      checkWebhookUrl: async () => {
        throw WebhookError.UnsafeUrl({ reason: 'blocked' });
      },
    });
    await expectDomainCode('WebhookRequiresUrl', () =>
      subscribe.execute(ctx, {
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['webhook'],
      }),
    );
    try {
      await subscribe.execute(ctx, {
        organizationId: demoOrganization.id,
        email: 'bea@ex.com',
        channels: ['webhook'],
        url: 'http://127.0.0.1/hooks',
      });
      expect.fail('expected WebhookUrlRejected');
    } catch (error) {
      expect(DomainError.is(error) && error.code === 'WebhookUrlRejected').toBe(
        true,
      );
      if (!DomainError.is(error) || error.code !== 'WebhookUrlRejected') {
        throw error;
      }
      expect(error.data.reason).toBe('blocked');
    }
  });
});

function published(emailSubscribers: boolean): PostPublishedEvent {
  return new PostPublishedEvent({
    postId: 'post-1',
    organizationId: demoOrganization.id,
    title: 'Hello',
    emailSubscribers,
  });
}

describe('PostPublishedWebhookHandler', () => {
  it('publishes the public event, without internal fields, under a stable eventId', async () => {
    const published: unknown[] = [];
    const handler = new PostPublishedWebhookHandler({
      webhooks: {
        publish: async (input) => {
          published.push({
            organizationId: input.organizationId,
            eventId: input.eventId,
            token: input.event.token,
            payload: input.event.payload,
          });
          return 'msg_test';
        },
      },
    });
    await handler.handle(
      new PostPublishedEvent({
        postId: 'post-1',
        organizationId: demoOrganization.id,
        title: 'Hello',
        emailSubscribers: true,
      }),
    );
    expect(published).toEqual([
      {
        organizationId: demoOrganization.id,
        eventId: 'post.published:post-1',
        token: 'post.published',
        payload: { postId: 'post-1', title: 'Hello' },
      },
    ]);
  });
});

describe('SubscriberPostPublishedWebhookHandler', () => {
  it('publishes once when emailSubscribers is true, and nothing when it is false', async () => {
    const recorded = recordingWebhooks();
    const handler = new SubscriberPostPublishedWebhookHandler({
      webhooks: recorded.webhooks,
    });
    await handler.handle(published(false));
    expect(recorded.published).toEqual([]);
    await handler.handle(published(true));
    expect(recorded.published).toEqual([
      {
        organizationId: demoOrganization.id,
        eventId: 'subscriber.post.published:post-1',
        token: 'subscriber.post.published',
        payload: { postId: 'post-1', title: 'Hello' },
      },
    ]);
  });
});

describe('SubscriberPostUnpublishedWebhookHandler', () => {
  it('publishes one public event for the removed post', async () => {
    const recorded = recordingWebhooks();
    await new SubscriberPostUnpublishedWebhookHandler({
      webhooks: recorded.webhooks,
    }).handle(
      new PostUnpublishedEvent({
        postId: 'post-1',
        organizationId: demoOrganization.id,
        title: 'Hello',
      }),
    );
    expect(recorded.published).toEqual([
      {
        organizationId: demoOrganization.id,
        eventId: 'subscriber.post.unpublished:post-1',
        token: 'subscriber.post.unpublished',
        payload: { postId: 'post-1', title: 'Hello' },
      },
    ]);
  });
});

describe('EmailSubscribersHandler', () => {
  async function handlerWithOneSubscriber(): Promise<{
    handler: EmailSubscribersHandler;
    email: RecordingEmail;
  }> {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    return {
      handler: new EmailSubscribersHandler({
        subscribers,
        ...senders(email),
      }),
      email,
    };
  }

  it('sends nothing when emailSubscribers is false', async () => {
    const { handler, email } = await handlerWithOneSubscriber();
    await handler.handle(published(false));
    expect(email.sent).toEqual([]);
  });

  it('sends one email with the post title when emailSubscribers is true', async () => {
    const { handler, email } = await handlerWithOneSubscriber();
    await handler.handle(published(true));
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'New post',
        text: 'Hello',
        idempotencyKey: 'post.published:post-1:sub-1',
      },
    ]);
  });

  it('does not email a subscriber of another organization', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: 'other',
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email),
    }).handle(published(true));
    expect(email.sent).toEqual([]);
  });

  it('sends one email per subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-2',
        organizationId: demoOrganization.id,
        email: 'bea@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email),
    }).handle(published(true));
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'New post',
        text: 'Hello',
        idempotencyKey: 'post.published:post-1:sub-1',
      },
      {
        to: ['bea@ex.com'],
        from,
        subject: 'New post',
        text: 'Hello',
        idempotencyKey: 'post.published:post-1:sub-2',
      },
    ]);
  });

  it('texts only when sms is chosen', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email', 'sms'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email, sms),
    }).handle(published(true));
    expect(sms.sent).toEqual([{ to: '+15550001111', body: 'Hello' }]);
    expect(email.sent).toHaveLength(1);
  });

  it('does not text an email-only subscriber who stored a phone', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email, sms),
    }).handle(published(true));
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toEqual([]);
  });

  it('does not email an sms-only subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['sms'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email, sms),
    }).handle(published(true));
    expect(email.sent).toEqual([]);
    expect(sms.sent).toEqual([{ to: '+15550001111', body: 'Hello' }]);
  });

  it('logs a failed sms and still emails the next subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email', 'sms'],
      }),
    );
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-2',
        organizationId: demoOrganization.id,
        email: 'bea@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    const logger = new MemoryLogger();
    sms.fail = SmsError.Unsubscribed();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email, sms, logger),
    }).handle(published(true));
    expect(email.sent).toHaveLength(2);
    expect(logger.records).toHaveLength(1);
    expect(logger.records[0]?.fields).toEqual({ subscriberId: 'sub-1' });
  });

  it('logs a rejected email and still sends to the next subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-2',
        organizationId: demoOrganization.id,
        email: 'bea@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const logger = new MemoryLogger();
    email.fail = EmailError.Rejected();
    await new EmailSubscribersHandler({
      subscribers,
      ...senders(email, new RecordingSms(), logger),
    }).handle(published(true));
    expect(email.sent).toEqual([
      {
        to: ['bea@ex.com'],
        from,
        subject: 'New post',
        text: 'Hello',
        idempotencyKey: 'post.published:post-1:sub-2',
      },
    ]);
    expect(logger.records).toHaveLength(1);
    expect(logger.records[0]?.fields).toEqual({ subscriberId: 'sub-1' });
  });

  it('rethrows a transient mail failure and skips SMS', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email', 'sms'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    const handler = new EmailSubscribersHandler({
      subscribers,
      ...senders(email, sms),
    });
    email.fail = EmailError.RateLimited();
    await expect(handler.handle(published(true))).rejects.toSatisfy(
      (error: unknown) => EmailError.is(error) && error.code === 'RateLimited',
    );
    expect(sms.sent).toEqual([]);

    email.fail = EmailError.Unavailable();
    await expect(handler.handle(published(true))).rejects.toSatisfy(
      (error: unknown) => EmailError.is(error) && error.code === 'Unavailable',
    );
  });

  it('rethrows an error that is not a mail or SMS catalog member', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    email.fail = new Error('down');
    await expect(
      new EmailSubscribersHandler({
        subscribers,
        ...senders(email),
      }).handle(published(true)),
    ).rejects.toThrow('down');
  });
});

describe('SubscriberReminder', () => {
  it('sends the standing reminder to each subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const recorded = recordingWebhooks();

    const sent = await new SubscriberReminder({
      subscribers,
      ...senders(email),
      webhooks: recorded.webhooks,
    }).execute(internalCallCtx());

    expect(sent).toBe(1);
    const day = new Date().toISOString().slice(0, 10);
    expect(recorded.published).toEqual([
      {
        organizationId: demoOrganization.id,
        eventId: `subscriber.reminder:${day}:${demoOrganization.id}`,
        token: 'subscriber.reminder',
        payload: { day },
      },
    ]);
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'Posts you follow',
        text: 'A published post is waiting.',
        idempotencyKey: `post.subscriber-reminder:${day}:sub-1`,
      },
    ]);
  });

  it('sends nothing when the schedule signal is already aborted', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const recorded = recordingWebhooks();
    const controller = new AbortController();
    controller.abort();
    const sent = await new SubscriberReminder({
      subscribers,
      ...senders(email),
      webhooks: recorded.webhooks,
    }).execute(internalCallCtx(controller.signal));
    expect(sent).toBe(0);
    expect(email.sent).toEqual([]);
    expect(recorded.published).toEqual([]);
  });

  it('registers a daily UTC job that runs the reminder', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const reminder = new SubscriberReminder({
      subscribers,
      ...senders(email),
      webhooks: silentWebhooks,
    });
    const job = reminder.registration();

    expect(job.name).toBe('subscriber-reminder');
    expect(job.cron).toBe('0 0 * * *');
    expect(job.timezone).toBe('UTC');
    await job.onTick({ signal: new AbortController().signal });
    expect(email.sent).toHaveLength(1);
  });
});

describe('EmailUnpublishedHandler', () => {
  it('emails the post title when a post is unpublished', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const handler = new EmailUnpublishedHandler({
      subscribers,
      ...senders(email),
    });
    await handler.handle(
      new PostUnpublishedEvent({
        postId: 'post-1',
        organizationId: demoOrganization.id,
        title: 'Hello',
      }),
    );
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'Post removed',
        text: 'Hello',
        idempotencyKey: 'post.unpublished:post-1:sub-1',
      },
    ]);
  });
});

describe('WelcomeSubscriberHandler', () => {
  it('sends one welcome email to the new subscriber', async () => {
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    const handler = new WelcomeSubscriberHandler({
      ...senders(email, sms),
      webhooks: silentWebhooks,
    });
    await handler.handle(
      new SubscriberJoinedEvent({
        subscriberId: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'Welcome',
        text: 'You are subscribed.',
        idempotencyKey: 'subscriber.joined:sub-1',
      },
    ]);
    expect(sms.sent).toEqual([]);
  });

  it('texts a welcome when sms is the only channel', async () => {
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    const handler = new WelcomeSubscriberHandler({
      ...senders(email, sms),
      webhooks: silentWebhooks,
    });
    await handler.handle(
      new SubscriberJoinedEvent({
        subscriberId: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['sms'],
      }),
    );
    expect(email.sent).toEqual([]);
    expect(sms.sent).toEqual([
      { to: '+15550001111', body: 'You are subscribed.' },
    ]);
  });

  it('publishes a welcome to that subscriber when webhook is a channel', async () => {
    const recorded = recordingWebhooks();
    await new WelcomeSubscriberHandler({
      ...senders(new RecordingEmail()),
      webhooks: recorded.webhooks,
    }).handle(
      new SubscriberJoinedEvent({
        subscriberId: 'sub-1',
        organizationId: demoOrganization.id,
        email: 'ada@ex.com',
        channels: ['webhook'],
      }),
    );
    expect(recorded.published).toEqual([
      {
        organizationId: demoOrganization.id,
        eventId: 'subscriber.welcome:sub-1',
        endpointIds: ['sub-1'],
        token: 'subscriber.welcome',
        payload: { subscriberId: 'sub-1' },
      },
    ]);
  });
});

describe('HTTP', () => {
  it('posts.save returns a draft with an id', async () => {
    const { api } = await signedHttp();

    const draft = await api.posts.save({
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });

    expect(draft.title).toBe('Hello');
    expect(draft.id.length).toBeGreaterThan(0);
    expect(draft.status).toBe('draft');
  });

  it('posts.publish returns published and records the flag', async () => {
    const { api, publishers } = await signedHttp();
    const draft = await api.posts.save({
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });

    const post = await api.posts.publish({
      id: draft.id,
      emailSubscribers: true,
    });

    expect(post.status).toBe('published');
    expect(publishers.domainEvents.events).toHaveLength(1);
    expect(
      publishedEvent(publishers.domainEvents.events[0]).payload
        .emailSubscribers,
    ).toBe(true);
  });

  it('subscribers.subscribe returns the email', async () => {
    const { api } = http();

    const subscriber = await api.subscribers.subscribe({
      organizationId: demoOrganization.id,
      email: 'ada@ex.com',
    });

    expect(subscriber.email).toBe('ada@ex.com');
  });

  it('sends a declared domain error with its data', async () => {
    const { api } = await signedHttp();

    const result = await asResult(api.posts.publish({ id: 'missing' }));

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(404);
    if (result.error.code !== 'PostNotFound') throw result.error;
    expect(result.error.data.id).toBe('missing');
  });

  it('answers a published post with 409 and the error envelope', async () => {
    const { api, post, token } = await signedHttp();
    const draft = await api.posts.save({
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });
    await api.posts.publish({ id: draft.id });

    const response = await post(
      '/rpc/posts/publish',
      JSON.stringify({ input: { id: draft.id } }),
      { token },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'AlreadyPublished', message: 'Post is already published' },
    });
  });

  it('answers invalid input with 422 and the issues', async () => {
    const { post } = http();

    const response = await post(
      '/rpc/subscribers/subscribe',
      JSON.stringify({
        input: {
          organizationId: demoOrganization.id,
          email: 'ada@ex.com',
          channels: ['fax'],
        },
      }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; data: { issues: Array<{ path: unknown[] }> } };
    };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.data.issues[0]?.path).toEqual(['channels', 0]);
  });

  it('answers malformed JSON with 400', async () => {
    const { post } = http();

    const response = await post('/rpc/posts/save', '{"input":');

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('answers a path outside both prefixes with 404', async () => {
    const { post } = http();

    const response = await post('/posts', '{}');

    expect(response.status).toBe(404);
  });

  it('refuses a post write with no caller', async () => {
    const { api } = http();

    const result = await asResult(
      api.posts.save({
        organizationId: demoOrganization.id,
        title: 'Hello',
        body: 'Text',
      }),
    );

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe('SignInRequired');
  });

  it('reads the caller from a session token', async () => {
    const { apiAs, signIn } = http();
    const token = await signIn();

    const draft = await apiAs(token).posts.save({
      organizationId: demoOrganization.id,
      title: 'Hello',
      body: 'Text',
    });

    expect(draft.title).toBe('Hello');
  });

  it('auth.login returns a token for a known password', async () => {
    const { api, apiAs } = http();

    const { token } = await api.auth.login({
      userId: 'ada',
      password: 'password',
    });

    expect(await apiAs(token).auth.whoAmI({})).toEqual({
      id: 'ada',
      name: 'Ada',
      organizationIds: ['hexok'],
    });
  });

  it('auth.login refuses a wrong password without echoing it', async () => {
    const { api } = http();

    const result = await asResult(
      api.auth.login({ userId: 'ada', password: 'nope' }),
    );

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe('InvalidCredentials');
    expect(JSON.stringify(result.error)).not.toContain('nope');
  });

  it('auth.whoAmI returns the caller the token proves', async () => {
    const { apiAs, signIn } = http();
    const token = await signIn();

    expect(await apiAs(token).auth.whoAmI({})).toEqual({
      id: 'ada',
      name: 'Ada',
      organizationIds: ['hexok'],
    });
  });

  it('auth.whoAmI without a token is 401', async () => {
    const { api } = http();

    const result = await asResult(api.auth.whoAmI({}));

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe('SignInRequired');
  });

  it('auth.logout ends the session the token names', async () => {
    const { apiAs, signIn } = http();
    const token = await signIn();
    const other = await signIn();

    expect(await apiAs(token).auth.logout({})).toBeNull();

    const again = await asResult(
      apiAs(token).posts.save({
        organizationId: demoOrganization.id,
        title: 'Hello',
        body: 'Text',
      }),
    );
    if (again.ok) throw new Error('expected an error');
    expect(again.error.status).toBe(401);
    expect(again.error.code).toBe('Unauthenticated');
    // Another sign-in of the same user keeps its own session.
    const kept = await apiAs(other).posts.save({
      organizationId: demoOrganization.id,
      title: 'Hi',
      body: 'Text',
    });
    expect(kept.title).toBe('Hi');
  });

  it('answers auth.logout without a token with 401', async () => {
    const { api } = http();

    const result = await asResult(api.auth.logout({}));

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe('SignInRequired');
  });

  it('users.create is public and organizations.listMine returns the seeded org', async () => {
    const opened = http();
    const created = await opened.api.users.create({
      id: 'cam',
      name: 'Cam',
    });
    expect(created).toEqual({ id: 'cam', name: 'Cam', organizationIds: [] });

    const api = opened.apiAs(await opened.signIn());
    expect(await api.users.get({ id: 'cam' })).toEqual(created);
    expect(await api.organizations.listMine({})).toEqual([demoOrganization]);
  });

  it('organizations.create adds the caller and addMember joins another user', async () => {
    const opened = http();
    await opened.api.users.create({ id: 'cam', name: 'Cam' });
    const api = opened.apiAs(await opened.signIn());

    const organization = await api.organizations.create({ name: 'New Co' });
    expect(organization.name).toBe('New Co');
    expect((await api.auth.whoAmI({})).organizationIds).toEqual([
      'hexok',
      organization.id,
    ]);

    const member = await api.organizations.addMember({
      organizationId: organization.id,
      userId: 'cam',
    });
    expect(member.organizationIds).toEqual([organization.id]);
  });

  it('answers a token the authenticator rejects with 401', async () => {
    const logger = new MemoryLogger();
    const { post } = http(logger);

    const response = await post(
      '/rpc/posts/save',
      JSON.stringify({ input: { title: 'Hello', body: 'Text' } }),
      { token: 'wrong' },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'Unauthenticated', message: 'The token is not valid' },
    });
    // Not a signed token. The client does not see `invalid`.
    expect(logger.records).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'authentication refused',
        fields: { code: 'invalid' },
      }),
    ]);
  });
});

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

describe.skipIf(!process.env.REDIS_URL)(
  'auth on Redis behind signed tokens',
  () => {
    it('login stores the caller in Redis and returns a token that does not name them', async () => {
      const url = process.env.REDIS_URL ?? '';
      const { sessions, store } = createSessions({
        env: {
          AUTH_TOKEN_SECRETS: generateSecret(),
          AUTH_TOKEN_ISSUER: 'app-template',
          AUTH_TOKEN_AUDIENCE: 'app-template-api',
        },
        redisUrl: url,
        logger: new NoopLogger(),
      });
      await store.start();
      const redis = await connectRedis(url);
      try {
        const { api, apiAs } = http(new NoopLogger(), sessions);
        const { token } = await api.auth.login({
          userId: 'ada',
          password: 'password',
        });
        const [encodedHeader, encodedPayload] = token.split('.');
        expect(token.split('.')).toHaveLength(3);
        expect(json(encodedHeader)).toMatchObject({
          alg: 'HS256',
          typ: 'session+jwt',
        });
        const payload = json(encodedPayload);
        expect(payload).not.toHaveProperty('userId');
        const id = payload.jti;
        expect(typeof id).toBe('string');

        const key = sessionKey(String(id), 'app-template:session:');
        expect(JSON.parse((await redis.hGetAll(key)).i ?? '')).toEqual({
          userId: 'ada',
        });
        expect(await apiAs(token).auth.whoAmI({})).toEqual({
          id: 'ada',
          name: 'Ada',
          organizationIds: ['hexok'],
        });
        expect(await apiAs(token).auth.logout({})).toBeNull();
        expect(await redis.hGetAll(key)).toEqual({});
      } finally {
        await redis.close();
        await store.stop();
      }
    });
  },
);

function json(part: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(part ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;
}
