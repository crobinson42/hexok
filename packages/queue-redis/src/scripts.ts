import { randomUUID } from 'node:crypto';
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

/**
 * Deletes a stream only while it has no groups and its last id is at least `ARGV[1]` ms old. A `0-0` last id is never old.
 * Stream ids carry Redis time, so the age is measured on the Redis clock from `TIME`, not on this process's clock.
 * `TIME` before a write is allowed, because scripts replicate their effects, the default since Redis 5.
 */
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
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if ms == nil or ms == 0 or ms > now - tonumber(ARGV[1]) then
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
  idleMs: number,
): Promise<ScriptOutcome> {
  const reply = await commands.eval(deleteIdleStreamScript, 1, key, idleMs);
  return verdict(reply, 'stream delete');
}

/** Lua that sets `now` to the Redis clock in milliseconds. */
const redisNow = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;

/**
 * A delayed-set member: `<id>:<sensitive flag>:<group byte length>:<group>:<encoded payload>`.
 * The random id keeps two identical payloads from merging into one member.
 * A retry names the group that returned it, so only that group handles the replacement. A delayed publish names no group.
 */
export function delayedMember(
  encoded: string,
  sensitive: boolean,
  group = '',
): { readonly id: string; readonly member: string } {
  const id = randomUUID();
  const flag = sensitive ? '1' : '0';
  return {
    id,
    member: `${id}:${flag}:${Buffer.byteLength(group)}:${group}:${encoded}`,
  };
}

/** Adds `ARGV[2]` to the delayed set `KEYS[1]`, due `ARGV[1]` ms from now on the Redis clock. */
export const addDelayedScript = `${redisNow}
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[1]), ARGV[2])
return 1
`;

/** Adds a member to the delayed set, timed by Redis, so a publisher's clock cannot make it due early. */
export async function addDelayed(
  commands: Redis,
  delayedKey: string,
  entry: { readonly delayMs: number; readonly member: string },
): Promise<void> {
  const reply = await commands.eval(
    addDelayedScript,
    1,
    delayedKey,
    entry.delayMs,
    entry.member,
  );
  if (reply !== 1) {
    throw new Error('queue: the delayed add script replied unexpectedly');
  }
}

/**
 * Moves due members of the delayed set `KEYS[1]` into the stream `KEYS[2]`, oldest due first, and replies how many it moved.
 * It moves at most `ARGV[3]`, and never past the back-pressure mark `ARGV[2]`. It replies -1 and moves nothing while the stream is at the mark.
 * Due is measured on the Redis clock. Each `XADD` trims with `MAXLEN ~ ARGV[1]`, as `publish()` does.
 * A member that names a group gets a `group` field, which every other group acks without handling.
 */
// Atomic, so two subscriptions promoting at once move each member once.
export const promoteDueScript = `${redisNow}
local room = tonumber(ARGV[2]) - redis.call('XLEN', KEYS[2])
if room <= 0 then
  return -1
end
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, math.min(room, tonumber(ARGV[3])))
for _, member in ipairs(due) do
  local first = string.find(member, ':', 1, true)
  local second = string.find(member, ':', first + 1, true)
  local third = string.find(member, ':', second + 1, true)
  local length = tonumber(string.sub(member, second + 1, third - 1))
  local fields = {'payload', string.sub(member, third + length + 2)}
  if string.sub(member, first + 1, second - 1) == '1' then
    table.insert(fields, 'sensitive')
    table.insert(fields, '1')
  end
  if length > 0 then
    table.insert(fields, 'group')
    table.insert(fields, string.sub(member, third + 1, third + length))
  end
  redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[1], '*', unpack(fields))
  redis.call('ZREM', KEYS[1], member)
end
return #due
`;

/** Resolves how many entries moved, or -1 when the stream was at its back-pressure mark. */
export async function promoteDue(
  commands: Redis,
  delayedKey: string,
  streamKey: string,
  limits: {
    readonly maxLen: number;
    readonly mark: number;
    readonly max: number;
  },
): Promise<number> {
  const reply = await commands.eval(
    promoteDueScript,
    2,
    delayedKey,
    streamKey,
    limits.maxLen,
    limits.mark,
    limits.max,
  );
  if (typeof reply !== 'number') {
    throw new Error('queue: the promote script replied unexpectedly');
  }
  return reply;
}

/**
 * Acks entry `ARGV[2]` of the stream `KEYS[1]` for group `ARGV[1]`, and adds its replacement `ARGV[4]` to the delayed set `KEYS[2]`, due `ARGV[3]` ms from now on the Redis clock.
 * It adds nothing and replies 0 when the entry was no longer pending, so a retry is never doubled.
 */
// Atomic, so there is no moment when both the entry and its replacement exist, or neither does.
export const retryLaterScript = `
if redis.call('XACK', KEYS[1], ARGV[1], ARGV[2]) == 0 then
  return 0
end
${redisNow}
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[4])
return 1
`;

/** Resolves false when the entry was no longer pending and no replacement was added. */
export async function retryLater(
  commands: Redis,
  keys: { readonly stream: string; readonly delayed: string },
  entry: { readonly group: string; readonly id: string },
  replacement: { readonly delayMs: number; readonly member: string },
): Promise<boolean> {
  const reply = await commands.eval(
    retryLaterScript,
    2,
    keys.stream,
    keys.delayed,
    entry.group,
    entry.id,
    replacement.delayMs,
    replacement.member,
  );
  if (reply !== 0 && reply !== 1) {
    throw new Error('queue: the retry script replied unexpectedly');
  }
  return reply === 1;
}

function verdict(reply: unknown, script: string): ScriptOutcome {
  if (reply === 1) return 'removed';
  if (reply === 0) return 'kept';
  if (reply === -1) return 'gone';
  throw new Error(`queue: the ${script} script replied unexpectedly`);
}
