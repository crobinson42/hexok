import type { Authenticator } from '../app/ports/auth/authenticator.js';
import type { DomainEventPublisher } from '../app/ports/events/domain-event-publisher.js';
import type { PostRepository } from '../app/ports/repos/post-repository.js';
import type { SubscriberRepository } from '../app/ports/repos/subscriber-repository.js';
import { PublishPost } from '../app/use-cases/posts/api/command/publish-post.js';
import { SavePost } from '../app/use-cases/posts/api/command/save-post.js';
import { UnpublishPost } from '../app/use-cases/posts/api/command/unpublish-post.js';
import { EndSession } from '../app/use-cases/sessions/api/command/end-session.js';
import { SubscribeToPosts } from '../app/use-cases/subscribers/api/command/subscribe.js';

export type ApiPorts = {
  posts: PostRepository;
  subscribers: SubscriberRepository;
  domainEvents: DomainEventPublisher;
  authenticator: Authenticator;
};

/**
 * The API use cases, built from ports. Any transport calls these:
 * the RPC procedures in `rpc/app.ts`, a CLI, or a test.
 */
export function createApi(ports: ApiPorts) {
  return {
    savePost: new SavePost({ posts: ports.posts }),
    publishPost: new PublishPost({
      posts: ports.posts,
      domainEvents: ports.domainEvents,
    }),
    unpublishPost: new UnpublishPost({
      posts: ports.posts,
      domainEvents: ports.domainEvents,
    }),
    subscribeToPosts: new SubscribeToPosts({
      subscribers: ports.subscribers,
      domainEvents: ports.domainEvents,
    }),
    endSession: new EndSession({ authenticator: ports.authenticator }),
  };
}

export type Api = ReturnType<typeof createApi>;
