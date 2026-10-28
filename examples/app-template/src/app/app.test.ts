import type { EmailMessage, EmailReceipt } from '@hexok/email';
import { EmailSender } from '@hexok/email';
import { NoopLogger } from '@hexok/logger';
import type { SmsMessage, SmsReceipt } from '@hexok/sms';
import { SmsError, SmsSender } from '@hexok/sms';
import { asResult, createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import { Adapter, CodedError, type EventInstance } from 'hexok';
import { describe, expect, it } from 'vitest';
import type { PostEntity } from '../domain/entities/post.js';
import { SubscriberEntity } from '../domain/entities/subscriber.js';
import { DomainError } from '../domain/errors/domain.js';
import type { DomainEvents } from '../domain/events/domain-events.js';
import { PostPublishedEvent } from '../domain/events/post-published.js';
import { PostUnpublishedEvent } from '../domain/events/post-unpublished.js';
import { SubscriberJoinedEvent } from '../domain/events/subscriber-joined.js';
import { createApi } from '../servers/api.js';
import { createHttpHandler } from '../servers/http/handler.js';
import { createApiApp } from '../servers/rpc/app.js';
import type { apiContract } from '../servers/rpc/contract.js';
import { Authenticator, type Caller } from './ports/auth/authenticator.js';
import { DomainEventPublisher } from './ports/events/domain-event-publisher.js';
import { PostRepository } from './ports/repos/post-repository.js';
import { SubscriberRepository } from './ports/repos/subscriber-repository.js';
import { type InternalCtx, internalCall } from './use-cases/context.js';
import { PublishPost } from './use-cases/posts/api/command/publish-post.js';
import { SavePost } from './use-cases/posts/api/command/save-post.js';
import { UnpublishPost } from './use-cases/posts/api/command/unpublish-post.js';
import { EmailSubscribersHandler } from './use-cases/posts/event-handlers/email-subscribers.js';
import { EmailUnpublishedHandler } from './use-cases/posts/event-handlers/email-unpublished.js';
import { EmailSubscribers } from './use-cases/posts/internal/email-subscribers.js';
import { PublishDuePosts } from './use-cases/posts/scheduled/publish-due-posts.js';
import { SubscriberReminder } from './use-cases/posts/scheduled/subscriber-reminder.js';
import { EndSession } from './use-cases/sessions/api/command/end-session.js';
import { SubscribeToPosts } from './use-cases/subscribers/api/command/subscribe.js';
import { WelcomeSubscriberHandler } from './use-cases/subscribers/event-handlers/welcome-subscriber.js';

const from = { email: 'blog@localhost', name: 'Blog' };

const ctx = { caller: { userId: 'ada', sessionId: 'ada-session' } };

class InMemoryPosts extends Adapter(PostRepository) {
  readonly #rows = new Map<string, PostEntity>();

  override async get(id: string): Promise<PostEntity | null> {
    return this.#rows.get(id) ?? null;
  }

  override async save(post: PostEntity): Promise<void> {
    this.#rows.set(post.props.id, post);
  }

  override async listDue(now: Date): Promise<readonly PostEntity[]> {
    const at = now.getTime();
    return [...this.#rows.values()].filter((post) => {
      const publishAt = post.props.publishAt;
      return (
        post.props.status === 'scheduled' &&
        publishAt !== null &&
        Date.parse(publishAt) <= at
      );
    });
  }
}

class InMemorySubscribers extends Adapter(SubscriberRepository) {
  readonly #byEmail = new Map<string, SubscriberEntity>();

  override async getByEmail(email: string): Promise<SubscriberEntity | null> {
    return this.#byEmail.get(email) ?? null;
  }

  override async list(): Promise<readonly SubscriberEntity[]> {
    return [...this.#byEmail.values()];
  }

  override async save(subscriber: SubscriberEntity): Promise<void> {
    this.#byEmail.set(subscriber.props.email, subscriber);
  }
}

class RecordingDomainEvents extends Adapter(DomainEventPublisher) {
  readonly events: EventInstance<typeof DomainEvents>[] = [];

  override async publish(
    event: EventInstance<typeof DomainEvents>,
  ): Promise<void> {
    this.events.push(event);
  }
}

/** Tokens map to callers. A revoked session stops checking out. */
class InMemoryAuthenticator extends Adapter(Authenticator) {
  readonly #revoked = new Set<string>();

  constructor(private readonly callers: ReadonlyMap<string, Caller>) {
    super();
  }

  override async authenticate(token: string): Promise<Caller | null> {
    const caller = this.callers.get(token);
    if (caller === undefined || this.#revoked.has(caller.sessionId)) {
      return null;
    }
    return caller;
  }

  override async revoke(caller: Caller): Promise<void> {
    this.#revoked.add(caller.sessionId);
  }
}

function recordingPublishers(): { domainEvents: RecordingDomainEvents } {
  return { domainEvents: new RecordingDomainEvents() };
}

function savePost(posts: PostRepository): SavePost {
  return new SavePost({ posts });
}

class RecordingEmail extends Adapter(EmailSender) {
  readonly sent: EmailMessage[] = [];

  override async send(message: EmailMessage): Promise<EmailReceipt> {
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

function emailSubscribers(
  subscribers: SubscriberRepository,
  email: EmailSender,
  sms: SmsSender = new RecordingSms(),
): EmailSubscribers {
  return new EmailSubscribers({
    subscribers,
    email,
    sms,
    from,
    logger: new NoopLogger(),
  });
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
    | 'SignInRequired'
    | 'SmsRequiresPhone'
    | 'ChannelsRequired'
    | 'ChannelsInvalid',
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

/** `ada-token` authenticates as `ada`. */
function adaAuthenticator(): InMemoryAuthenticator {
  return new InMemoryAuthenticator(new Map([['ada-token', ctx.caller]]));
}

/**
 * The HTTP handler over in-memory ports. The typed client calls it without a
 * socket. `apiAs(token)` sends `Authorization: Bearer <token>`. `post` sends
 * a raw body to check the wire.
 */
function http() {
  const publishers = recordingPublishers();
  const authenticator = adaAuthenticator();
  const api = createApi({
    posts: new InMemoryPosts(),
    subscribers: new InMemorySubscribers(),
    ...publishers,
    authenticator,
  });
  const handle = createHttpHandler(createApiApp(api), { authenticator });
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

describe('SavePost', () => {
  it('assigns an id and stores a draft when id is omitted', async () => {
    const posts = new InMemoryPosts();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      title: 'Hello',
      body: 'Text',
    });

    expect(saved.props.id.length).toBeGreaterThan(0);
    expect(saved.props.status).toBe('draft');
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
      title: 'Hello',
      body: 'Text',
    });
    const updated = await save.execute(ctx, {
      id: saved.props.id,
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
      title: 'Hello',
      body: 'Text',
    });
    const published = await new PublishPost({
      posts,
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
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost({
      posts,
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
      title: 'Hello',
      body: 'Text',
    });
    const publishAt = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await new PublishPost({
      posts,
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
      title: 'Hello',
      body: 'Text',
    });
    const published = await new PublishPost({
      posts,
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
  it('turns a published post into a draft and records no event', async () => {
    const posts = new InMemoryPosts();
    const publishers = recordingPublishers();
    const saved = await savePost(posts).execute(ctx, {
      id: undefined,
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost({
      posts,
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
    });
    expect(publishers.domainEvents.events).toHaveLength(1);

    const draft = await new UnpublishPost({
      posts,
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
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost({
      posts,
      domainEvents: publishers.domainEvents,
    }).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
      publishAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const draft = await new UnpublishPost({
      posts,
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
      title: 'Due',
      body: 'Text',
    });
    const publishAt = new Date(Date.now() + 60_000).toISOString();
    await new PublishPost({
      posts,
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
    }).execute(internalCall());

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
      title: 'Later',
      body: 'Text',
    });
    await new PublishPost({
      posts,
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
    }).execute(internalCall());

    expect(count).toBe(0);
    expect((await posts.get(saved.props.id))?.props.status).toBe('scheduled');
    expect(publishers.domainEvents.events).toHaveLength(0);
  });
});

describe('EndSession', () => {
  it('revokes the token', async () => {
    const authenticator = adaAuthenticator();

    await new EndSession({ authenticator }).execute(ctx, {});

    expect(await authenticator.authenticate('ada-token')).toBeNull();
  });

  it('needs a signed-in caller', async () => {
    const end = new EndSession({ authenticator: adaAuthenticator() });

    await expectDomainCode('SignInRequired', () => end.execute({}, {}));
  });
});

describe('SubscribeToPosts', () => {
  it('returns the same id when the email is already subscribed', async () => {
    const subscribers = new InMemorySubscribers();
    const publishers = recordingPublishers();
    const subscribe = new SubscribeToPosts({
      subscribers,
      domainEvents: publishers.domainEvents,
    });
    const first = await subscribe.execute(ctx, { email: 'ada@ex.com' });
    const second = await subscribe.execute(ctx, { email: 'ada@ex.com' });

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

  it('stores email, sms, or both and rejects sms without a phone', async () => {
    const subscribers = new InMemorySubscribers();
    const subscribe = new SubscribeToPosts({
      subscribers,
      domainEvents: recordingPublishers().domainEvents,
    });
    const both = await subscribe.execute(ctx, {
      email: 'ada@ex.com',
      phone: '+15550001111',
      channels: ['email', 'sms'],
    });
    expect(both.props.channels).toEqual(['email', 'sms']);
    const smsOnly = await subscribe.execute(ctx, {
      email: 'bea@ex.com',
      phone: '+15550002222',
      channels: ['sms'],
    });
    expect(smsOnly.props.channels).toEqual(['sms']);
    expect(smsOnly.props.phone).toBe('+15550002222');
    await expectDomainCode('SmsRequiresPhone', () =>
      subscribe.execute(ctx, { email: 'cy@ex.com', channels: ['sms'] }),
    );
    await expectDomainCode('ChannelsRequired', () =>
      subscribe.execute(ctx, { email: 'cy@ex.com', channels: [] }),
    );
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
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    return {
      handler: new EmailSubscribersHandler({
        emailSubscribers: emailSubscribers(subscribers, email),
      }),
      email,
    };
  }

  it('sends nothing when emailSubscribers is false', async () => {
    const { handler, email } = await handlerWithOneSubscriber();
    await handler.handle(
      new PostPublishedEvent({
        postId: 'post-1',
        title: 'Hello',
        emailSubscribers: false,
      }),
    );
    expect(email.sent).toEqual([]);
  });

  it('sends one email with the post title when emailSubscribers is true', async () => {
    const { handler, email } = await handlerWithOneSubscriber();
    await handler.handle(
      new PostPublishedEvent({
        postId: 'post-1',
        title: 'Hello',
        emailSubscribers: true,
      }),
    );
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'New post',
        text: 'Hello',
      },
    ]);
  });
});

describe('EmailSubscribers', () => {
  it('sends one message per subscriber and returns the count', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-2',
        email: 'bea@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();

    const sent = await emailSubscribers(subscribers, email).execute(
      internalCall(),
      {
        subject: 'New post',
        body: 'Hello',
      },
    );

    expect(sent).toBe(2);
    expect(email.sent).toEqual([
      { to: ['ada@ex.com'], from, subject: 'New post', text: 'Hello' },
      { to: ['bea@ex.com'], from, subject: 'New post', text: 'Hello' },
    ]);
  });

  it('rejects a context that does not carry the internal symbol', async () => {
    const email = new RecordingEmail();
    await expectDomainCode('InternalCallerRequired', () =>
      emailSubscribers(new InMemorySubscribers(), email).execute(
        {} as InternalCtx,
        { subject: 'New post', body: 'Hello' },
      ),
    );
    expect(email.sent).toEqual([]);
  });
});

describe('EmailSubscribers sms', () => {
  it('texts only when sms is chosen', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email', 'sms'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    await emailSubscribers(subscribers, email, sms).execute(internalCall(), {
      subject: 'New post',
      body: 'Hello',
    });
    expect(sms.sent).toEqual([{ to: '+15550001111', body: 'Hello' }]);
    expect(email.sent).toHaveLength(1);
  });

  it('does not text an email-only subscriber who stored a phone', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    await emailSubscribers(subscribers, email, sms).execute(internalCall(), {
      subject: 'New post',
      body: 'Hello',
    });
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toEqual([]);
  });

  it('does not email an sms-only subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['sms'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    await emailSubscribers(subscribers, email, sms).execute(internalCall(), {
      subject: 'New post',
      body: 'Hello',
    });
    expect(email.sent).toEqual([]);
    expect(sms.sent).toEqual([{ to: '+15550001111', body: 'Hello' }]);
  });

  it('logs a failed sms and still emails the next subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        phone: '+15550001111',
        channels: ['email', 'sms'],
      }),
    );
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-2',
        email: 'bea@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    sms.fail = SmsError.Unsubscribed();
    const sent = await emailSubscribers(subscribers, email, sms).execute(
      internalCall(),
      { subject: 'New post', body: 'Hello' },
    );
    expect(sent).toBe(2);
    expect(email.sent).toHaveLength(2);
  });
});

describe('SubscriberReminder', () => {
  it('sends the standing reminder to each subscriber', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();

    const sent = await new SubscriberReminder({
      emailSubscribers: emailSubscribers(subscribers, email),
    }).execute(internalCall());

    expect(sent).toBe(1);
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'Posts you follow',
        text: 'A published post is waiting.',
      },
    ]);
  });

  it('registers a daily UTC job that runs the reminder', async () => {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({
        id: 'sub-1',
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const reminder = new SubscriberReminder({
      emailSubscribers: emailSubscribers(subscribers, email),
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
        email: 'ada@ex.com',
        channels: ['email'],
      }),
    );
    const email = new RecordingEmail();
    const handler = new EmailUnpublishedHandler({
      emailSubscribers: emailSubscribers(subscribers, email),
    });
    await handler.handle(
      new PostUnpublishedEvent({ postId: 'post-1', title: 'Hello' }),
    );
    expect(email.sent).toEqual([
      {
        to: ['ada@ex.com'],
        from,
        subject: 'Post removed',
        text: 'Hello',
      },
    ]);
  });
});

describe('WelcomeSubscriberHandler', () => {
  it('sends one welcome email to the new subscriber', async () => {
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    const handler = new WelcomeSubscriberHandler({
      email,
      sms,
      from,
      logger: new NoopLogger(),
    });
    await handler.handle(
      new SubscriberJoinedEvent({
        subscriberId: 'sub-1',
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
      },
    ]);
    expect(sms.sent).toEqual([]);
  });

  it('texts a welcome when sms is the only channel', async () => {
    const email = new RecordingEmail();
    const sms = new RecordingSms();
    const handler = new WelcomeSubscriberHandler({
      email,
      sms,
      from,
      logger: new NoopLogger(),
    });
    await handler.handle(
      new SubscriberJoinedEvent({
        subscriberId: 'sub-1',
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
});

describe('HTTP', () => {
  it('posts.save returns a draft with an id', async () => {
    const { api } = http();

    const draft = await api.posts.save({ title: 'Hello', body: 'Text' });

    expect(draft.title).toBe('Hello');
    expect(draft.id.length).toBeGreaterThan(0);
    expect(draft.status).toBe('draft');
  });

  it('posts.publish returns published and records the flag', async () => {
    const { api, publishers } = http();
    const draft = await api.posts.save({ title: 'Hello', body: 'Text' });

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

    const subscriber = await api.subscribers.subscribe({ email: 'ada@ex.com' });

    expect(subscriber.email).toBe('ada@ex.com');
  });

  it('sends a declared domain error with its data', async () => {
    const { api } = http();

    const result = await asResult(api.posts.publish({ id: 'missing' }));

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(404);
    if (result.error.code !== 'PostNotFound') throw result.error;
    expect(result.error.data.id).toBe('missing');
  });

  it('answers a published post with 409 and the error envelope', async () => {
    const { api, post } = http();
    const draft = await api.posts.save({ title: 'Hello', body: 'Text' });
    await api.posts.publish({ id: draft.id });

    const response = await post(
      '/rpc/posts/publish',
      JSON.stringify({ input: { id: draft.id } }),
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
      JSON.stringify({ input: { email: 'ada@ex.com', channels: ['fax'] } }),
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

  it('sessions.end revokes the token', async () => {
    const { apiAs } = http();

    expect(await apiAs('ada-token').sessions.end({})).toBeNull();

    const again = await asResult(
      apiAs('ada-token').posts.save({ title: 'Hello', body: 'Text' }),
    );
    if (again.ok) throw new Error('expected an error');
    expect(again.error.status).toBe(401);
    expect(again.error.code).toBe('Unauthenticated');
  });

  it('answers sessions.end without a token with 401', async () => {
    const { api } = http();

    const result = await asResult(api.sessions.end({}));

    if (result.ok) throw new Error('expected an error');
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe('SignInRequired');
  });

  it('answers a token the authenticator rejects with 401', async () => {
    const { post } = http();

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
  });
});
