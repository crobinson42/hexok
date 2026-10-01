import { pathToFileURL } from 'node:url';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
} from 'express';
import { CodedError } from 'hexok';
import { connectRedis } from './adapters/redis-client.js';
import { RedisEventPublisher } from './adapters/redis-events.js';
import { RedisPosts } from './adapters/redis-posts.js';
import { RedisSubscribers } from './adapters/redis-subscribers.js';
import { DomainError } from './errors/domain.js';
import type { EventPublisher } from './ports/event-publisher.js';
import type { PostRepository } from './ports/post-repository.js';
import type { SubscriberRepository } from './ports/subscriber-repository.js';
import { PublishPost } from './use-cases/publish-post.js';
import { SavePost } from './use-cases/save-post.js';
import { SubscribeToPosts } from './use-cases/subscribe.js';
import { UnpublishPost } from './use-cases/unpublish-post.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createHttpApp(deps: {
  posts: PostRepository;
  subscribers: SubscriberRepository;
  publisher: EventPublisher;
}): Express {
  const app = express();
  app.use(express.json());

  const savePost = new SavePost(deps.posts);
  const publishPost = new PublishPost(deps.posts, deps.publisher);
  const unpublishPost = new UnpublishPost(deps.posts);
  const subscribeToPosts = new SubscribeToPosts(deps.subscribers);

  app.post('/posts', async (req, res) => {
    const entity = await savePost.execute(
      { ipAddress: req.socket.remoteAddress ?? '' },
      {
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        title: text(req.body?.title),
        body: text(req.body?.body),
      },
    );
    res.json(entity.toJSON());
  });

  app.post('/posts/:id/publish', async (req: Request<{ id: string }>, res) => {
    const entity = await publishPost.execute(
      { ipAddress: req.socket.remoteAddress ?? '' },
      {
        id: req.params.id,
        emailSubscribers: req.body?.emailSubscribers === true,
      },
    );
    res.json(entity.toJSON());
  });

  app.post(
    '/posts/:id/unpublish',
    async (req: Request<{ id: string }>, res) => {
      const entity = await unpublishPost.execute(
        { ipAddress: req.socket.remoteAddress ?? '' },
        { id: req.params.id },
      );
      res.json(entity.toJSON());
    },
  );

  app.post('/subscribers', async (req, res) => {
    const entity = await subscribeToPosts.execute(
      { ipAddress: req.socket.remoteAddress ?? '' },
      { email: text(req.body?.email) },
    );
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
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  };
  app.use(onError);

  return app;
}

export async function main(): Promise<void> {
  const redis = await connectRedis();
  const app = createHttpApp({
    posts: new RedisPosts(redis),
    subscribers: new RedisSubscribers(redis),
    publisher: new RedisEventPublisher(redis),
  });
  app.listen(Number(process.env.PORT ?? 3000));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
