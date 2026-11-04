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
import { onShutdown } from './utils/shutdown.js';
import {
  assertDistinctHandlerGroups,
  subscribeHandler,
} from './utils/subscribe-handler.js';

export async function main(): Promise<void> {
  const runtime = await createRuntime();
  // Registered before start, so a signal during startup still stops what has started.
  onShutdown(runtime.logger, () => runtime.stop());
  /** Adapters connect in `start`. `register` and `subscribe` need that connection. Scheduled jobs publish to the queue, so the queue starts first and stops last. */
  await runtime.domainEventsQueue.start();
  await runtime.scheduleCoordinator.start();

  const notifications = await createNotifications(runtime);
  const { domainEvents } = createPublishers(runtime);

  const emailSubscribers = new EmailSubscribers({
    subscribers: runtime.subscribers,
    email: notifications.email,
    sms: notifications.sms,
    from: notifications.from,
    logger: runtime.logger,
  });

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

  runtime.scheduleCoordinator.register(
    new SubscriberReminder({ emailSubscribers }).registration(),
  );
  runtime.scheduleCoordinator.register(
    new PublishDuePosts({
      posts: runtime.posts,
      domainEvents,
      logger: runtime.logger,
    }).registration(),
  );
  runtime.scheduleCoordinator.register({
    name: 'queue.maintain',
    cron: '15 * * * *',
    timezone: 'UTC',
    onTick: async ({ signal }) => {
      if (signal.aborted) return;
      await runtime.domainEventsQueue.maintain({
        dryRun: false,
        idleConsumerMs: 3_600_000,
      });
    },
  });

  assertDistinctHandlerGroups(domainQueueHandlers);

  const subscriptions: Array<{ topic: string; group: string }> = [];
  for (const handler of domainQueueHandlers) {
    subscriptions.push(
      await subscribeHandler(runtime.domainEventsQueue, handler, {
        maxDeliveries: 'unlimited',
      }),
    );
  }

  runtime.logger.info('domain events queue subscriptions', { subscriptions });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
