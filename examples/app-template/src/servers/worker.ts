import { pathToFileURL } from 'node:url';
import { EmailSubscribersHandler } from '../app/use-cases/posts/event-handlers/email-subscribers.js';
import { EmailUnpublishedHandler } from '../app/use-cases/posts/event-handlers/email-unpublished.js';
import { EmailSubscribers } from '../app/use-cases/posts/internal/email-subscribers.js';
import { PublishDuePosts } from '../app/use-cases/posts/scheduled/publish-due-posts.js';
import { SubscriberReminder } from '../app/use-cases/posts/scheduled/subscriber-reminder.js';
import { WelcomeSubscriberHandler } from '../app/use-cases/subscribers/event-handlers/welcome-subscriber.js';
import {
  createNotifications,
  createPublishers,
  createRuntime,
} from './composition.js';
import {
  assertDistinctHandlerGroups,
  subscribeHandler,
} from './utils/subscribe-handler.js';

export async function main(): Promise<void> {
  const runtime = await createRuntime();
  /** Adapters connect in `start`. `register` and `subscribe` need that connection. */
  await runtime.scheduleCoordinator.start();
  await runtime.domainEventsQueue.start();
  await runtime.clientEventsBroadcast.start();

  const notifications = await createNotifications(runtime);
  const { domainEvents, clientEvents } = createPublishers(runtime);

  const emailSubscribers = new EmailSubscribers({
    subscribers: runtime.subscribers,
    email: notifications.email,
    sms: notifications.sms,
    from: notifications.from,
    logger: runtime.logger,
  });

  /** Setup domain event handlers. */
  const domainQueueHandlers = [
    new EmailSubscribersHandler({ emailSubscribers }),
    new EmailUnpublishedHandler({ emailSubscribers }),
    new WelcomeSubscriberHandler({
      email: notifications.email,
      sms: notifications.sms,
      from: notifications.from,
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

  runtime.logger.info('domain events queue subscriptions', { subscriptions });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
