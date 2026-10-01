import { Adapter, type EventInstance } from 'hexok';
import { describe, expect, it } from 'vitest';
import type { PostEntity } from './entities/post.js';
import { SubscriberEntity } from './entities/subscriber.js';
import { DomainError } from './errors/domain.js';
import type { BlogEvents } from './events/catalog.js';
import { PostPublishedEvent } from './events/post-published.js';
import { EmailSubscribersHandler } from './handlers/email-subscribers.js';
import { createHttpApp } from './http.js';
import { EmailSender } from './ports/email-sender.js';
import { EventPublisher } from './ports/event-publisher.js';
import { PostRepository } from './ports/post-repository.js';
import { SubscriberRepository } from './ports/subscriber-repository.js';
import { PublishPost } from './use-cases/publish-post.js';
import { SavePost } from './use-cases/save-post.js';
import { SubscribeToPosts } from './use-cases/subscribe.js';
import { UnpublishPost } from './use-cases/unpublish-post.js';

const ctx = { ipAddress: '127.0.0.1' };

class InMemoryPosts extends Adapter(PostRepository) {
  readonly #rows = new Map<string, PostEntity>();

  override async get(id: string): Promise<PostEntity | null> {
    return this.#rows.get(id) ?? null;
  }

  override async save(post: PostEntity): Promise<void> {
    this.#rows.set(post.props.id, post);
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

class RecordingPublisher extends Adapter(EventPublisher) {
  readonly events: EventInstance<typeof BlogEvents>[] = [];

  override async publish(
    event: EventInstance<typeof BlogEvents>,
  ): Promise<void> {
    this.events.push(event);
  }
}

class RecordingEmail extends Adapter(EmailSender) {
  readonly sent: { to: string; subject: string; body: string }[] = [];

  override async send(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

function publishedEvent(
  event: EventInstance<typeof BlogEvents> | undefined,
): PostPublishedEvent {
  expect(event).toBeInstanceOf(PostPublishedEvent);
  if (!(event instanceof PostPublishedEvent)) {
    throw new Error('expected PostPublishedEvent');
  }
  return event;
}

async function expectDomainCode(
  code: 'IpAddressMissing' | 'PostNotFound',
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

async function withHttp(
  deps: Parameters<typeof createHttpApp>[0],
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createHttpApp(deps).listen(0);
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a tcp port');
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  }
}

describe('SavePost', () => {
  it('assigns an id and stores a draft when id is omitted', async () => {
    const posts = new InMemoryPosts();
    const saved = await new SavePost(posts).execute(ctx, {
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
    const save = new SavePost(posts);
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

  it('throws IpAddressMissing before saving when ipAddress is empty', async () => {
    const posts = new InMemoryPosts();
    await expectDomainCode('IpAddressMissing', () =>
      new SavePost(posts).execute(
        { ipAddress: '' },
        { id: 'post-1', title: 'Hello', body: 'Text' },
      ),
    );
    expect(await posts.get('post-1')).toBeNull();
  });
});

describe('PublishPost', () => {
  it('publishes a draft and records emailSubscribers true', async () => {
    const posts = new InMemoryPosts();
    const publisher = new RecordingPublisher();
    const saved = await new SavePost(posts).execute(ctx, {
      id: undefined,
      title: 'Hello',
      body: 'Text',
    });
    const published = await new PublishPost(posts, publisher).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
    });

    expect(published.props.status).toBe('published');
    expect(publisher.events).toHaveLength(1);
    const event = publishedEvent(publisher.events[0]);
    expect(event.payload.postId).toBe(saved.props.id);
    expect(event.payload.emailSubscribers).toBe(true);
    expect((await posts.get(saved.props.id))?.props.status).toBe('published');
  });

  it('records emailSubscribers false', async () => {
    const posts = new InMemoryPosts();
    const publisher = new RecordingPublisher();
    const saved = await new SavePost(posts).execute(ctx, {
      id: undefined,
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost(posts, publisher).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: false,
    });

    expect(publisher.events).toHaveLength(1);
    expect(publishedEvent(publisher.events[0]).payload.emailSubscribers).toBe(
      false,
    );
  });

  it('throws PostNotFound for a missing id', async () => {
    const posts = new InMemoryPosts();
    const publisher = new RecordingPublisher();
    await expectDomainCode('PostNotFound', () =>
      new PublishPost(posts, publisher).execute(ctx, {
        id: 'missing',
        emailSubscribers: true,
      }),
    );
    expect(publisher.events).toHaveLength(0);
  });
});

describe('UnpublishPost', () => {
  it('turns a published post into a draft and records no event', async () => {
    const posts = new InMemoryPosts();
    const publisher = new RecordingPublisher();
    const saved = await new SavePost(posts).execute(ctx, {
      id: undefined,
      title: 'Hello',
      body: 'Text',
    });
    await new PublishPost(posts, publisher).execute(ctx, {
      id: saved.props.id,
      emailSubscribers: true,
    });
    expect(publisher.events).toHaveLength(1);

    const draft = await new UnpublishPost(posts).execute(ctx, {
      id: saved.props.id,
    });

    expect(draft.props.status).toBe('draft');
    expect((await posts.get(saved.props.id))?.props.status).toBe('draft');
    expect(publisher.events).toHaveLength(1);
  });
});

describe('SubscribeToPosts', () => {
  it('returns the same id when the email is already subscribed', async () => {
    const subscribers = new InMemorySubscribers();
    const subscribe = new SubscribeToPosts(subscribers);
    const first = await subscribe.execute(ctx, { email: 'ada@ex.com' });
    const second = await subscribe.execute(ctx, { email: 'ada@ex.com' });

    expect(second.props.id).toBe(first.props.id);
    const listed = await subscribers.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.props.email).toBe('ada@ex.com');
    expect(listed[0]?.props.id).toBe(first.props.id);
  });
});

describe('EmailSubscribersHandler', () => {
  async function handlerWithOneSubscriber(): Promise<{
    handler: EmailSubscribersHandler;
    email: RecordingEmail;
  }> {
    const subscribers = new InMemorySubscribers();
    await subscribers.save(
      SubscriberEntity.create({ id: 'sub-1', email: 'ada@ex.com' }),
    );
    const email = new RecordingEmail();
    return {
      handler: new EmailSubscribersHandler(subscribers, email),
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
      { to: 'ada@ex.com', subject: 'New post', body: 'Hello' },
    ]);
  });
});

describe('createHttpApp', () => {
  it('POST /posts returns a draft with an id', async () => {
    await withHttp(
      {
        posts: new InMemoryPosts(),
        subscribers: new InMemorySubscribers(),
        publisher: new RecordingPublisher(),
      },
      async (base) => {
        const response = await fetch(`${base}/posts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Hello', body: 'Text' }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          id: string;
          title: string;
          status: string;
        };
        expect(body.title).toBe('Hello');
        expect(body.id.length).toBeGreaterThan(0);
        expect(body.status).toBe('draft');
      },
    );
  });

  it('POST /posts/:id/publish returns published and records the flag', async () => {
    const publisher = new RecordingPublisher();
    await withHttp(
      {
        posts: new InMemoryPosts(),
        subscribers: new InMemorySubscribers(),
        publisher,
      },
      async (base) => {
        const created = await fetch(`${base}/posts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Hello', body: 'Text' }),
        });
        const draft = (await created.json()) as { id: string };
        const response = await fetch(`${base}/posts/${draft.id}/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emailSubscribers: true }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { status: string };
        expect(body.status).toBe('published');
        expect(publisher.events).toHaveLength(1);
        expect(
          publishedEvent(publisher.events[0]).payload.emailSubscribers,
        ).toBe(true);
      },
    );
  });

  it('POST /subscribers returns the email', async () => {
    await withHttp(
      {
        posts: new InMemoryPosts(),
        subscribers: new InMemorySubscribers(),
        publisher: new RecordingPublisher(),
      },
      async (base) => {
        const response = await fetch(`${base}/subscribers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'ada@ex.com' }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { email: string };
        expect(body.email).toBe('ada@ex.com');
      },
    );
  });

  it('POST /posts/:id/publish returns 404 for an unknown id', async () => {
    await withHttp(
      {
        posts: new InMemoryPosts(),
        subscribers: new InMemorySubscribers(),
        publisher: new RecordingPublisher(),
      },
      async (base) => {
        const response = await fetch(`${base}/posts/missing/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emailSubscribers: true }),
        });
        expect(response.status).toBe(404);
      },
    );
  });
});
