import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { PostEntity } from '../../../../../domain/entities/post.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { PostUnpublishedEvent } from '../../../../../domain/events/post-unpublished.js';
import type { DomainEventPublisher } from '../../../../ports/events/domain-event-publisher.js';
import type { PostRepository } from '../../../../ports/repos/post-repository.js';
import { ApiUseCase } from '../../../context.js';

export const unpublishPostInput = z.object({
  id: z.string().min(1),
});

export type UnpublishPostInput = z.infer<typeof unpublishPostInput>;

export class UnpublishPost extends ApiUseCase('post.unpublish', {
  input: unpublishPostInput,
}) {
  constructor(
    private readonly deps: {
      posts: PostRepository;
      domainEvents: DomainEventPublisher;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: UnpublishPostInput,
  ): Promise<PostEntity> {
    const post = await this.deps.posts.get(input.id);
    if (post === null) {
      throw DomainError.PostNotFound({ id: input.id });
    }
    if (post.props.status === 'scheduled') {
      post.cancelSchedule();
      await this.deps.posts.save(post);
      return post;
    }
    post.unpublish();
    await this.deps.posts.save(post);
    await this.deps.domainEvents.publish(
      new PostUnpublishedEvent({
        postId: post.props.id,
        title: post.props.title,
      }),
    );
    return post;
  }
}
