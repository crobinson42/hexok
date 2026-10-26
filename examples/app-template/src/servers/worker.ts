import { pathToFileURL } from 'node:url';
import { EmailSubscribersHandler } from '../app/use-cases/posts/event-handlers/email-subscribers.js';
import { EmailUnpublishedHandler } from '../app/use-cases/posts/event-handlers/email-unpublished.js';
import { EmailSubscribers } from '../app/use-cases/posts/internal/email-subscribers.js';
import { PublishDuePosts } from '../app/use-cases/posts/scheduled/publish-due-posts.js';
import { SubscriberReminder } from '../app/use-cases/posts/scheduled/subscriber-reminder.js';
import { WelcomeSubscriberHandler } from '../app/use-cases/subscribers/event-handlers/welcome-subscriber.js';
import { BroadcastClientEventPublisher } from '../infra/events/broadcasters/client-events-channel.js';
import { QueueDomainEventPublisher } from '../infra/events/queues/domain-events.js';
import { createRuntime } from './composition.js';
import {
  assertDistinctHandlerGroups,
  subscribeHandler,
} from './utils/subscribe-handler.js';

export async function main(): Promise<void> {
  const runtime = await createRuntime();

  const emailSubscribers = new EmailSubscribers({
    subscribers: runtime.subscribers,
    email: runtime.email,
    sms: runtime.sms,
    from: runtime.from,
    logger: runtime.logger,
  });

  const domainEvents = new QueueDomainEventPublisher({
    queue: runtime.domainEventsQueue,
  });
  const clientEvents = new BroadcastClientEventPublisher({
    broadcast: runtime.clientEventsBroadcast,
  });

  /** Setup domain event handlers. */
  const domainQueueHandlers = [
    new EmailSubscribersHandler({ emailSubscribers }),
    new EmailUnpublishedHandler({ emailSubscribers }),
    new WelcomeSubscriberHandler({
      email: runtime.email,
      sms: runtime.sms,
      from: runtime.from,
      logger: runtime.logger,
    }),
  ];

  /**
   * Register scheduled jobs. These are executed by the schedule coordinator every minute (or according to the cron schedule).
   */
  runtime.scheduleCoordinator.register(
    new SubscriberReminder({ emailSubscribers }).registration(),
  );
  runtime.scheduleCoordinator.register(
    new PublishDuePosts({
      posts: runtime.posts,
      domainEvents,
      clientEvents,
      logger: runtime.logger,
    }).registration(),
  );

  assertDistinctHandlerGroups(domainQueueHandlers);

  const subscriptions: Array<{ topic: string; group: string }> = [];
  for (const handler of domainQueueHandlers) {
    subscriptions.push(
      await subscribeHandler(runtime.domainEventsQueue, handler),
    );
  }

  /**
   * Start the runtime.
   */
  await runtime.scheduleCoordinator.start();
  await runtime.domainEventsQueue.start();
  await runtime.clientEventsBroadcast.start();

  runtime.logger.info('domain events queue subscriptions', { subscriptions });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
