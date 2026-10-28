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
  return verdict(reply, 'consumer release');
}

/**
 * Acks the consumer's pending entries that are gone from the stream, and returns their ids.
 * Redis 6.2 keeps such an entry pending and `XAUTOCLAIM` returns it as `nil`, without its id.
 */
export const ackDeletedScript = `
local gone = {}
for _, row in ipairs(redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', ARGV[3], ARGV[2])) do
  if #redis.call('XRANGE', KEYS[1], row[1], row[1]) == 0 then
    gone[#gone + 1] = row[1]
  end
end
if #gone > 0 then
  redis.call('XACK', KEYS[1], ARGV[1], unpack(gone))
end
return gone
`;

/** How many of the consumer's pending entries one {@link ackDeleted} call checks. */
const ACK_DELETED_SCAN = 1000;

/** Acks the consumer's pending entries that are gone from the stream. Resolves their ids. */
export async function ackDeleted(
  commands: Redis,
  key: string,
  group: string,
  consumer: string,
): Promise<string[]> {
  const reply = await commands.eval(
    ackDeletedScript,
    1,
    key,
    group,
    consumer,
    ACK_DELETED_SCAN,
  );
  return Array.isArray(reply) ? reply.map(String) : [];
}

/** Destroys a group only while it has no consumers and nothing pending. Returns 1 when it destroyed it and 0 when it kept it. */
// Atomic, because a consumer can join between the XINFO that maintain() read and the destroy, which would drop its cursor.
export const destroyIdleGroupScript = `
if #redis.call('XINFO', 'CONSUMERS', KEYS[1], ARGV[1]) > 0 then
  return 0
end
if redis.call('XPENDING', KEYS[1], ARGV[1])[1] > 0 then
  return 0
end
redis.call('XGROUP', 'DESTROY', KEYS[1], ARGV[1])
return 1
`;

/**
 * Deletes a stream only while it has no groups and its last id is no newer than `ARGV[1]` ms. A `0-0` last id is never old.
 * Returns 1 when it deleted the stream and 0 when it kept it.
 */
// Atomic, because a group or an entry can arrive between the XINFO that maintain() read and the delete.
export const deleteIdleStreamScript = `
if #redis.call('XINFO', 'GROUPS', KEYS[1]) > 0 then
  return 0
end
local info = redis.call('XINFO', 'STREAM', KEYS[1])
local last = ''
for i = 1, #info, 2 do
  if info[i] == 'last-generated-id' then last = info[i + 1] end
end
local ms = tonumber(string.match(last, '^(%d+)-'))
if ms == nil or ms == 0 or ms > tonumber(ARGV[1]) then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

/** Resolves `true` when the group was destroyed, and `false` when it gained a consumer or a pending entry and was kept. */
export async function destroyIdleGroup(
  commands: Redis,
  key: string,
  group: string,
): Promise<boolean> {
  const reply = await commands.eval(destroyIdleGroupScript, 1, key, group);
  return verdict(reply, 'group destroy');
}

/** Resolves `true` when the stream was deleted, and `false` when it gained a group or a newer entry and was kept. */
export async function deleteIdleStream(
  commands: Redis,
  key: string,
  cutoffMs: number,
): Promise<boolean> {
  const reply = await commands.eval(deleteIdleStreamScript, 1, key, cutoffMs);
  return verdict(reply, 'stream delete');
}

/** Each check-and-act script replies 1 when it acted and 0 when it declined. */
function verdict(reply: unknown, script: string): boolean {
  if (reply === 1) return true;
  if (reply === 0) return false;
  throw new Error(`queue: the ${script} script replied unexpectedly`);
}
