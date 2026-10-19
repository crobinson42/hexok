import { pathToFileURL } from 'node:url';
import { ConsoleEmail } from './adapters/console-email.js';
import { connectRedis } from './adapters/redis-client.js';
import { RedisEventSubscriptions } from './adapters/redis-events.js';
import { RedisSubscribers } from './adapters/redis-subscribers.js';
import { EmailSubscribersHandler } from './use-cases/posts/event-handlers/email-subscribers.js';
import { EmailSubscribers } from './use-cases/posts/internal/email-subscribers.js';
import {
  SubscriberReminder,
  scheduleSubscriberReminder,
} from './use-cases/posts/scheduled/subscriber-reminder.js';

export async function main(): Promise<void> {
  const redis = await connectRedis();
  // BLPOP blocks the client, so the subscription loop needs its own connection.
  const events = await connectRedis();
  const subscriptions = new RedisEventSubscriptions(events);
  const emailSubscribers = new EmailSubscribers(
    new RedisSubscribers(redis),
    new ConsoleEmail(),
  );
  // A day. The timer is unref'd, so a quiet worker can still exit.
  scheduleSubscriberReminder(
    new SubscriberReminder(emailSubscribers),
    24 * 60 * 60 * 1000,
  );
  subscriptions.subscribe([new EmailSubscribersHandler(emailSubscribers)]);
  await subscriptions.run();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
