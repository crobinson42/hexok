import type { UseCase } from 'hexok';
import type { PostEntity } from '../../../../../domain/entities/post.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { ClientEventPublisher } from '../../../../ports/events/client-event-publisher.js';
import type { DomainEventPublisher } from '../../../../ports/events/domain-event-publisher.js';
import type { PostRepository } from '../../../../ports/repos/post-repository.js';
import { ApiUseCase, internalCall } from '../../../context.js';
import { CommitPublishedPost } from '../../internal/commit-published-post.js';

export class PublishPost extends ApiUseCase('post.publish') {
  readonly #commit: CommitPublishedPost;

  constructor(
    private readonly deps: {
      posts: PostRepository;
      domainEvents: DomainEventPublisher;
      clientEvents: ClientEventPublisher;
    },
  ) {
    super();
    this.#commit = new CommitPublishedPost(deps);
  }

  async execute(
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: { id: string; emailSubscribers: boolean; publishAt?: string },
  ): Promise<PostEntity> {
    const publishAt = input.publishAt;
    if (publishAt !== undefined && isFuture(publishAt)) {
      const post = await this.deps.posts.get(input.id);
      if (post === null) {
        throw DomainError.PostNotFound({ id: input.id });
      }
      post.schedule({
        publishAt,
        emailSubscribers: input.emailSubscribers,
      });
      await this.deps.posts.save(post);
      return post;
    }
    return this.#commit.execute(internalCall(), {
      id: input.id,
      emailSubscribers: input.emailSubscribers,
    });
  }
}

function isFuture(publishAt: string): boolean {
  const time = Date.parse(publishAt);
  if (!Number.isFinite(time)) {
    throw DomainError.PublishAtInvalid({ publishAt });
  }
  return time > Date.now();
}
