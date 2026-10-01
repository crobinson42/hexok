import type { UseCase } from 'hexok';
import type { PostEntity } from '../entities/post.js';
import { DomainError } from '../errors/domain.js';
import { PostPublishedEvent } from '../events/post-published.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { PostRepository } from '../ports/post-repository.js';
import { AppUseCase } from './context.js';

export class PublishPost extends AppUseCase('post.publish') {
  constructor(
    private readonly posts: PostRepository,
    private readonly publisher: EventPublisher,
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string; emailSubscribers: boolean },
  ): Promise<PostEntity> {
    const post = await this.posts.get(input.id);
    if (post === null) {
      throw DomainError.PostNotFound({ id: input.id });
    }
    post.publish();
    await this.posts.save(post);
    await this.publisher.publish(
      new PostPublishedEvent({
        postId: post.props.id,
        title: post.props.title,
        emailSubscribers: input.emailSubscribers,
      }),
    );
    return post;
  }
}
