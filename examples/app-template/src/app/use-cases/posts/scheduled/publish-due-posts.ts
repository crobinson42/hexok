import type { Logger } from '@hexok/logger';
import type { UseCase } from 'hexok';
import type { ClientEventPublisher } from '../../../ports/events/client-event-publisher.js';
import type { DomainEventPublisher } from '../../../ports/events/domain-event-publisher.js';
import type { PostRepository } from '../../../ports/repos/post-repository.js';
import type { InternalUseCase } from '../../context.js';
import { ScheduledUseCase } from '../../scheduled.js';
import { CommitPublishedPost } from '../internal/commit-published-post.js';

/**
 * Every minute, publish posts whose `publishAt` has passed.
 * Register with `schedule.register(job.registration())`.
 * A thrown post is logged and left for the next tick when it is still scheduled.
 */
export class PublishDuePosts extends ScheduledUseCase('post.publish-due', {
  name: 'publish-due-posts',
  cron: '* * * * *',
  timezone: 'UTC',
}) {
  readonly #commit: CommitPublishedPost;

  constructor(
    private readonly deps: {
      posts: PostRepository;
      domainEvents: DomainEventPublisher;
      clientEvents: ClientEventPublisher;
      logger: Logger;
    },
  ) {
    super();
    this.#commit = new CommitPublishedPost(deps);
  }

  async execute(ctx: UseCase.Ctx<typeof InternalUseCase>): Promise<number> {
    const due = await this.deps.posts.listDue(new Date());
    let published = 0;
    for (const scheduled of due) {
      try {
        const current = await this.deps.posts.get(scheduled.props.id);
        if (current === null || current.props.status !== 'scheduled') continue;
        await this.#commit.execute(ctx, {
          id: current.props.id,
          emailSubscribers: current.props.emailSubscribers,
        });
        published += 1;
      } catch (error) {
        this.deps.logger.error(
          error instanceof Error ? error : new Error('publish due post failed'),
          { postId: scheduled.props.id },
        );
      }
    }
    return published;
  }
}
