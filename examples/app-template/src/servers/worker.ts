import { pathToFileURL } from 'node:url';
import { EmailSubscribersHandler } from '../app/use-cases/posts/event-handlers/email-subscribers.js';
import { EmailUnpublishedHandler } from '../app/use-cases/posts/event-handlers/email-unpublished.js';
import { PostPublishedWebhookHandler } from '../app/use-cases/posts/event-handlers/post-published-webhook.js';
import { PublishDuePosts } from '../app/use-cases/posts/scheduled/publish-due-posts.js';
import { SubscriberReminder } from '../app/use-cases/posts/scheduled/subscriber-reminder.js';
import { WelcomeSubscriberHandler } from '../app/use-cases/subscribers/event-handlers/welcome-subscriber.js';
import { createChannelDeliveryServices } from './runtime/channel-delivery.js';
import { createPublishers } from './runtime/domain-events.js';
import { createRuntime } from './runtime/index.js';
import { createWebhooks } from './runtime/webhooks.js';
import { onShutdown } from './utils/shutdown.js';
import {
  assertDistinctHandlerGroups,
  subscribeHandler,
} from './utils/subscribe-handler.js';

export async function main(): Promise<void> {
  const runtime = await createRuntime();
  const webhooks = createWebhooks(runtime);
  // Registered before start, so a signal during startup still stops what has started.
  // Domain handlers publish webhooks, so the webhooks queue stops after them.
  onShutdown(runtime.logger, async () => {
    await runtime.stop();
    await webhooks.stop();
  });
  /** Adapters connect in `start`. `register` and `subscribe` need that connection. Scheduled jobs publish to the queue, so the queue starts first and stops last. */
  await webhooks.queue.start();
  await webhooks.webhooks.start();
  await runtime.domainEventsQueue.start();
  await runtime.scheduleCoordinator.start();

  const { email, sms, from } = await createChannelDeliveryServices(runtime);
  const { domainEvents } = createPublishers(runtime);
  const senders = {
    subscribers: runtime.subscribers,
    email,
    sms,
    from,
    logger: runtime.logger,
  };

  const domainQueueHandlers = [
    new EmailSubscribersHandler(senders),
    new EmailUnpublishedHandler(senders),
    new WelcomeSubscriberHandler({ email, sms, from, logger: runtime.logger }),
    new PostPublishedWebhookHandler({ webhooks: webhooks.webhooks }),
  ];

  runtime.scheduleCoordinator.register(
    new SubscriberReminder(senders).registration(),
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
