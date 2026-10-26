import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { PostEntity } from '../../../../../domain/entities/post.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { ClientEventPublisher } from '../../../../ports/events/client-event-publisher.js';
import type { DomainEventPublisher } from '../../../../ports/events/domain-event-publisher.js';
import type { PostRepository } from '../../../../ports/repos/post-repository.js';
import { ApiUseCase, internalCall } from '../../../context.js';
import { CommitPublishedPost } from '../../internal/commit-published-post.js';

/** `emailSubscribers` defaults to false. A missing `publishAt` publishes now. */
export const publishPostInput = z.object({
  id: z.string().min(1),
  emailSubscribers: z.boolean().optional(),
  publishAt: z.string().min(1).optional(),
});

export type PublishPostInput = z.infer<typeof publishPostInput>;

export class PublishPost extends ApiUseCase('post.publish', {
  input: publishPostInput,
}) {
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
    input: PublishPostInput,
  ): Promise<PostEntity> {
    const publishAt = input.publishAt;
    const emailSubscribers = input.emailSubscribers === true;
    if (publishAt !== undefined && isFuture(publishAt)) {
      const post = await this.deps.posts.get(input.id);
      if (post === null) {
        throw DomainError.PostNotFound({ id: input.id });
      }
      post.schedule({ publishAt, emailSubscribers });
      await this.deps.posts.save(post);
      return post;
    }
    return this.#commit.execute(internalCall(), {
      id: input.id,
      emailSubscribers,
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
