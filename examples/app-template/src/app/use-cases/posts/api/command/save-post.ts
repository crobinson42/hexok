import { randomUUID } from 'node:crypto';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { PostEntity } from '../../../../../domain/entities/post.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { OrganizationRepository } from '../../../../ports/repos/organization-repository.js';
import type { PostRepository } from '../../../../ports/repos/post-repository.js';
import type { Membership } from '../../../../services/membership.js';
import { ApiUseCase } from '../../../context.js';

export const savePostInput = z.object({
  id: z.string().min(1).optional(),
  organizationId: z.string().min(1),
  title: z.string().min(1),
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
      membership: Membership;
      organizations: OrganizationRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: SavePostInput,
  ): Promise<PostEntity> {
    const organization = await this.deps.organizations.get(
      input.organizationId,
    );
    if (organization === null) {
      throw DomainError.OrganizationNotFound({ id: input.organizationId });
    }
    await this.deps.membership.requireOrgMember(
      ctx.caller.userId,
      input.organizationId,
    );
    const id = input.id ?? randomUUID();
    const existing = await this.deps.posts.get(id);
    if (
      existing !== null &&
      existing.props.organizationId !== input.organizationId
    ) {
      throw DomainError.NotAMember({
        userId: ctx.caller.userId,
        organizationId: input.organizationId,
      });
    }
    const post =
      existing === null
        ? PostEntity.create({
            id,
            organizationId: input.organizationId,
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
