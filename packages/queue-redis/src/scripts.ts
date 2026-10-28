import type { Redis } from 'ioredis';

/**
 * What a check-and-act script did. `gone` means the key, group, or consumer no longer exists, such as when another `maintain()` run removed it first.
 * The scripts reply 1, 0, and -1.
 */
export type ScriptOutcome = 'removed' | 'kept' | 'gone';

/** Lua that returns a group's `XINFO GROUPS` fields by name, or nil when the key or the group does not exist. */
const groupLookup = `
local function groupOf(key, name)
  if redis.call('EXISTS', key) == 0 then return nil end
  for _, row in ipairs(redis.call('XINFO', 'GROUPS', key)) do
    local fields = {}
    for i = 1, #row, 2 do fields[row[i]] = row[i + 1] end
    if fields['name'] == name then return fields end
  end
  return nil
end
`;

/**
 * Deletes a consumer only when it owns no pending entry.
 * DELCONSUMER drops the consumer's pending entries, and no other consumer could then reclaim them.
 */
// Atomic, because a read still blocked in Redis can hand the consumer an entry between XPENDING and DELCONSUMER.
export const releaseConsumerScript = `${groupLookup}
if groupOf(KEYS[1], ARGV[1]) == nil then
  return -1
end
local found = false
for _, row in ipairs(redis.call('XINFO', 'CONSUMERS', KEYS[1], ARGV[1])) do
  for i = 1, #row, 2 do
    if row[i] == 'name' and row[i + 1] == ARGV[2] then found = true end
  end
end
if not found then
  return -1
end
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2]) > 0 then
  return 0
end
redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

/** `kept` when the consumer owns a pending entry. */
export async function releaseConsumer(
  commands: Redis,
  key: string,
  group: string,
  consumer: string,
): Promise<ScriptOutcome> {
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

/** Destroys a group only while it has no consumers and nothing pending. */
// Atomic, because a consumer can join between the XINFO that maintain() read and the destroy, which would drop its cursor.
export const destroyIdleGroupScript = `${groupLookup}
local group = groupOf(KEYS[1], ARGV[1])
if group == nil then
  return -1
end
if group['consumers'] > 0 or group['pending'] > 0 then
  return 0
end
redis.call('XGROUP', 'DESTROY', KEYS[1], ARGV[1])
return 1
`;

/** Deletes a stream only while it has no groups and its last id is no newer than `ARGV[1]` ms. A `0-0` last id is never old. */
// Atomic, because a group or an entry can arrive between the XINFO that maintain() read and the delete.
export const deleteIdleStreamScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return -1
end
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

/** `kept` when the group gained a consumer or a pending entry. */
export async function destroyIdleGroup(
  commands: Redis,
  key: string,
  group: string,
): Promise<ScriptOutcome> {
  const reply = await commands.eval(destroyIdleGroupScript, 1, key, group);
  return verdict(reply, 'group destroy');
}

/** `kept` when the stream gained a group or a newer entry. */
export async function deleteIdleStream(
  commands: Redis,
  key: string,
  cutoffMs: number,
): Promise<ScriptOutcome> {
  const reply = await commands.eval(deleteIdleStreamScript, 1, key, cutoffMs);
  return verdict(reply, 'stream delete');
}

function verdict(reply: unknown, script: string): ScriptOutcome {
  if (reply === 1) return 'removed';
  if (reply === 0) return 'kept';
  if (reply === -1) return 'gone';
  throw new Error(`queue: the ${script} script replied unexpectedly`);
}
