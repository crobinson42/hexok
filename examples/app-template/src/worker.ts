import { pathToFileURL } from 'node:url';
import { ConsoleEmail } from './adapters/console-email.js';
import { connectRedis } from './adapters/redis-client.js';
import { RedisEventSubscriptions } from './adapters/redis-events.js';
import { RedisSubscribers } from './adapters/redis-subscribers.js';
import { EmailSubscribersHandler } from './handlers/email-subscribers.js';

export async function main(): Promise<void> {
  const redis = await connectRedis();
  // BLPOP blocks the client, so the subscription loop needs its own connection.
  const events = await connectRedis();
  const subscriptions = new RedisEventSubscriptions(events);
  subscriptions.subscribe([
    new EmailSubscribersHandler(
      new RedisSubscribers(redis),
      new ConsoleEmail(),
    ),
  ]);
  await subscriptions.run();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
