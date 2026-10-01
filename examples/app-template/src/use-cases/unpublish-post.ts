import type { UseCase } from 'hexok';
import type { PostEntity } from '../entities/post.js';
import { DomainError } from '../errors/domain.js';
import type { PostRepository } from '../ports/post-repository.js';
import { AppUseCase } from './context.js';

export class UnpublishPost extends AppUseCase('post.unpublish') {
  constructor(private readonly posts: PostRepository) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<PostEntity> {
    const post = await this.posts.get(input.id);
    if (post === null) {
      throw DomainError.PostNotFound({ id: input.id });
    }
    post.unpublish();
    await this.posts.save(post);
    return post;
  }
}
