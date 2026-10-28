import type { Redis } from 'ioredis';

/**
 * Deletes a consumer only when it owns no pending entry. Returns 1 when it deleted the consumer and 0 when it kept it.
 * DELCONSUMER drops the consumer's pending entries, and no other consumer could then reclaim them.
 */
// Atomic, because a read still blocked in Redis can hand the consumer an entry between XPENDING and DELCONSUMER.
export const releaseConsumerScript = `
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2]) > 0 then
  return 0
end
redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

/** Resolves `true` when the consumer was deleted, and `false` when it owns a pending entry and was kept. */
export async function releaseConsumer(
  commands: Redis,
  key: string,
  group: string,
  consumer: string,
): Promise<boolean> {
  const reply = await commands.eval(
    releaseConsumerScript,
    1,
    key,
    group,
    consumer,
  );
  if (reply === 1) return true;
  if (reply === 0) return false;
  throw new Error('queue: the consumer release script replied unexpectedly');
}
