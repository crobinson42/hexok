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
      draft.publishAt = null;
    });
  }

  /**
   * Hold publication until `publishAt`. Only a draft or an already scheduled post.
   * `publishAt` must be a future UTC timestamp.
   */
  schedule(input: { publishAt: string; emailSubscribers: boolean }): this {
    if (this.props.status === 'published') {
      throw DomainError.AlreadyPublished();
    }
    const time = Date.parse(input.publishAt);
    if (!Number.isFinite(time) || time <= Date.now()) {
      throw DomainError.PublishAtInvalid({ publishAt: input.publishAt });
    }
    const publishAt = new Date(time).toISOString();
    return this.set((draft) => {
      draft.status = 'scheduled';
      draft.publishAt = publishAt;
      draft.emailSubscribers = input.emailSubscribers;
    });
  }

  /** Drop a future publication. Does not apply to a live or draft post. */
  cancelSchedule(): this {
    if (this.props.status !== 'scheduled') {
      throw DomainError.NotScheduled();
    }
    return this.set((draft) => {
      draft.status = 'draft';
      draft.publishAt = null;
      draft.emailSubscribers = false;
    });
  }

  unpublish(): this {
    if (this.props.status !== 'published') {
      throw DomainError.NotPublished();
    }
    return this.set((draft) => {
      draft.status = 'draft';
      draft.publishAt = null;
      draft.emailSubscribers = false;
    });
  }
}
