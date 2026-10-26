import type { UseCase } from 'hexok';
import type { PostEntity } from '../../../../domain/entities/post.js';
import { DomainError } from '../../../../domain/errors/domain.js';
import { PostPublishedEvent } from '../../../../domain/events/post-published.js';
import { PostPublishedClientEvent } from '../../../../domain/events/post-published-client.js';
import type { ClientEventPublisher } from '../../../ports/events/client-event-publisher.js';
import type { DomainEventPublisher } from '../../../ports/events/domain-event-publisher.js';
import type { PostRepository } from '../../../ports/repos/post-repository.js';
import { InternalUseCase } from '../../context.js';

/**
 * Mark a draft or scheduled post published and emit both catalogs.
 * Callers pass `internalCall()`. A future `publishAt` is not this use case.
 */
export class CommitPublishedPost extends InternalUseCase(
  'post.commit-published',
) {
  constructor(
    private readonly deps: {
      posts: PostRepository;
      domainEvents: DomainEventPublisher;
      clientEvents: ClientEventPublisher;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof InternalUseCase>,
    input: { id: string; emailSubscribers: boolean },
  ): Promise<PostEntity> {
    const post = await this.deps.posts.get(input.id);
    if (post === null) {
      throw DomainError.PostNotFound({ id: input.id });
    }
    post.publish();
    await this.deps.posts.save(post);
    await this.deps.domainEvents.publish(
      new PostPublishedEvent({
        postId: post.props.id,
        title: post.props.title,
        emailSubscribers: input.emailSubscribers,
      }),
    );
    await this.deps.clientEvents.publish(
      new PostPublishedClientEvent({
        postId: post.props.id,
        title: post.props.title,
      }),
    );
    return post;
  }
}
