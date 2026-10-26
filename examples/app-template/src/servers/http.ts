import { pathToFileURL } from 'node:url';
import { type Logger, NoopLogger } from '@hexok/logger';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
} from 'express';
import { CodedError } from 'hexok';
import type { ClientEventPublisher } from '../app/ports/events/client-event-publisher.js';
import type { DomainEventPublisher } from '../app/ports/events/domain-event-publisher.js';
import type { PostRepository } from '../app/ports/repos/post-repository.js';
import type { SubscriberRepository } from '../app/ports/repos/subscriber-repository.js';
import { PublishPost } from '../app/use-cases/posts/api/command/publish-post.js';
import { SavePost } from '../app/use-cases/posts/api/command/save-post.js';
import { UnpublishPost } from '../app/use-cases/posts/api/command/unpublish-post.js';
import { SubscribeToPosts } from '../app/use-cases/subscribers/api/command/subscribe.js';
import { DomainError } from '../domain/errors/domain.js';
import type { NotificationChannel } from '../domain/schemas/subscriber.js';
import { BroadcastClientEventPublisher } from '../infra/events/broadcasters/client-events-channel.js';
import { QueueDomainEventPublisher } from '../infra/events/queues/domain-events.js';
import { createRuntime } from './composition.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function channels(value: unknown): NotificationChannel[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => item !== 'email' && item !== 'sms')
  ) {
    return [];
  }
  return value;
}

function apiCtx(req: Request): { authToken?: string } {
  const header = req.header('authorization');
  return header === undefined ? {} : { authToken: header };
}

export function createHttpApp(deps: {
  posts: PostRepository;
  subscribers: SubscriberRepository;
  domainEvents: DomainEventPublisher;
  clientEvents: ClientEventPublisher;
  logger?: Logger;
}): Express {
  const logger = deps.logger ?? new NoopLogger();
  const app = express();
  app.use(express.json());

  const savePost = new SavePost({ posts: deps.posts });
  const publishPost = new PublishPost({
    posts: deps.posts,
    domainEvents: deps.domainEvents,
    clientEvents: deps.clientEvents,
  });
  const unpublishPost = new UnpublishPost({
    posts: deps.posts,
    domainEvents: deps.domainEvents,
  });
  const subscribeToPosts = new SubscribeToPosts({
    subscribers: deps.subscribers,
    domainEvents: deps.domainEvents,
  });

  app.post('/posts', async (req, res) => {
    const entity = await savePost.execute(apiCtx(req), {
      id: typeof req.body?.id === 'string' ? req.body.id : undefined,
      title: text(req.body?.title),
      body: text(req.body?.body),
    });
    res.json(entity.toJSON());
  });

  app.post('/posts/:id/publish', async (req: Request<{ id: string }>, res) => {
    const publishAt = req.body?.publishAt;
    const entity = await publishPost.execute(apiCtx(req), {
      id: req.params.id,
      emailSubscribers: req.body?.emailSubscribers === true,
      ...(typeof publishAt === 'string' && publishAt !== ''
        ? { publishAt }
        : {}),
    });
    res.json(entity.toJSON());
  });

  app.post(
    '/posts/:id/unpublish',
    async (req: Request<{ id: string }>, res) => {
      const entity = await unpublishPost.execute(apiCtx(req), {
        id: req.params.id,
      });
      res.json(entity.toJSON());
    },
  );

  app.post('/subscribers', async (req, res) => {
    const entity = await subscribeToPosts.execute(apiCtx(req), {
      email: text(req.body?.email),
      ...(typeof req.body?.phone === 'string' && req.body.phone !== ''
        ? { phone: req.body.phone }
        : {}),
      ...(req.body?.channels === undefined
        ? {}
        : { channels: channels(req.body.channels) }),
    });
    res.json(entity.toJSON());
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (DomainError.is(error) && error.code === 'PostNotFound') {
      res.status(404).json({ error: error.message });
      return;
    }
    if (DomainError.is(error)) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof CodedError && error.code === 'VALIDATION') {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error(error instanceof Error ? error : 'Internal error');
    res.status(500).json({ error: 'Internal error' });
  };
  app.use(onError);

  return app;
}

export async function main(): Promise<void> {
  const runtime = await createRuntime();
  await runtime.domainEventsQueue.start();
  await runtime.clientEventsBroadcast.start();

  const app = createHttpApp({
    posts: runtime.posts,
    subscribers: runtime.subscribers,
    domainEvents: new QueueDomainEventPublisher({
      queue: runtime.domainEventsQueue,
    }),
    clientEvents: new BroadcastClientEventPublisher({
      broadcast: runtime.clientEventsBroadcast,
    }),
    logger: runtime.logger,
  });

  app.listen(Number(process.env.PORT ?? 3000));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
