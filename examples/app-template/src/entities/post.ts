import { Entity } from 'hexok';
import { DomainError } from '../errors/domain.js';
import { PostSchema } from '../schemas/post.js';

export class PostEntity extends Entity('Post', PostSchema) {
  publish(): this {
    if (this.props.status === 'published') {
      throw DomainError.AlreadyPublished();
    }
    return this.set((draft) => {
      draft.status = 'published';
    });
  }

  unpublish(): this {
    if (this.props.status === 'draft') {
      throw DomainError.NotPublished();
    }
    return this.set((draft) => {
      draft.status = 'draft';
    });
  }
}
