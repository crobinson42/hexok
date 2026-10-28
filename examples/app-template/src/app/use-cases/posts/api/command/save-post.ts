import { randomUUID } from 'node:crypto';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { PostEntity } from '../../../../../domain/entities/post.js';
import type { PostRepository } from '../../../../ports/repos/post-repository.js';
import { ApiUseCase } from '../../../context.js';

export const savePostInput = z.object({
  id: z.string().optional(),
  title: z.string(),
  body: z.string(),
});

export type SavePostInput = z.infer<typeof savePostInput>;

/** Create or update a post. A new post is a draft. */
export class SavePost extends ApiUseCase('post.save', {
  input: savePostInput,
}) {
  constructor(
    private readonly deps: {
      posts: PostRepository;
    },
  ) {
    super();
  }

  async execute(
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: SavePostInput,
  ): Promise<PostEntity> {
    const id =
      input.id === undefined || input.id === '' ? randomUUID() : input.id;
    const existing = await this.deps.posts.get(id);
    const post =
      existing === null
        ? PostEntity.create({
            id,
            title: input.title,
            body: input.body,
            status: 'draft',
            publishAt: null,
            emailSubscribers: false,
          })
        : existing.set((draft) => {
            draft.title = input.title;
            draft.body = input.body;
          });
    await this.deps.posts.save(post);
    return post;
  }
}
