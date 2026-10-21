import type { Redis } from 'ioredis';
import type { LogSink } from './log-sink.js';

export interface RedisQueueMaintainOptions {
  readonly dryRun?: boolean;
  readonly idleConsumerMs?: number;
  readonly dropIdleGroups?: { readonly idleMs: number };
  readonly dropIdleStreams?: { readonly idleMs: number };
  readonly topics?: readonly string[];
}

export type RedisQueueStuckReason =
  | 'no-consumers'
  | 'pending-owned-by-idle-consumer';

export type RedisQueueMaintainSkipReason =
  | 'not-a-stream'
  | 'missing'
  | 'xinfo-failed'
  | 'never-delivered'
  | 'never-written'
  | 'empty-topic';

export interface RedisQueueMaintainReport {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly trimmed: readonly string[];
  readonly consumersRemoved: readonly {
    readonly topic: string;
    readonly group: string;
    readonly consumer: string;
    readonly idleMs: number;
  }[];
  readonly groupsDestroyed: readonly {
    readonly topic: string;
    readonly group: string;
  }[];
  readonly streamsDeleted: readonly {
    readonly topic: string;
    readonly length: number;
  }[];
  readonly stuck: readonly {
    readonly topic: string;
    readonly group: string;
    readonly pending: number;
    readonly reason: RedisQueueStuckReason;
  }[];
  readonly skipped: readonly {
    readonly key: string;
    readonly reason: RedisQueueMaintainSkipReason;
  }[];
}

interface MaintainInput {
  readonly commands: Redis;
  readonly keyPrefix: string;
  readonly retentionMs: number;
  readonly options: RedisQueueMaintainOptions;
  readonly logger: LogSink;
}

interface ReportBuilder {
  dryRun: boolean;
  scanned: number;
  trimmed: string[];
  consumersRemoved: Array<RedisQueueMaintainReport['consumersRemoved'][number]>;
  groupsDestroyed: Array<RedisQueueMaintainReport['groupsDestroyed'][number]>;
  streamsDeleted: Array<RedisQueueMaintainReport['streamsDeleted'][number]>;
  stuck: Array<RedisQueueMaintainReport['stuck'][number]>;
  skipped: Array<RedisQueueMaintainReport['skipped'][number]>;
}

interface StreamInfo {
  length: number;
  lastGeneratedId: string;
  firstId: string | undefined;
}

interface GroupInfo {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
}

interface ConsumerInfo {
  name: string;
  pending: number;
  idleMs: number;
}

const OWN_CONSUMER_PREFIX = 'hexok:';

export async function maintainStreams(
  input: MaintainInput,
): Promise<RedisQueueMaintainReport> {
  const dryRun = input.options.dryRun !== false;
  const report: ReportBuilder = {
    dryRun,
    scanned: 0,
    trimmed: [],
    consumersRemoved: [],
    groupsDestroyed: [],
    streamsDeleted: [],
    stuck: [],
    skipped: [],
  };
  const now = Date.now();
  const keys = input.options.topics
    ? input.options.topics.map((topic) => `${input.keyPrefix}${topic}`)
    : await scanKeys(input.commands, input.keyPrefix);
  for (const key of keys) {
    await processKey(input, report, key, now);
  }
  return report;
}

async function scanKeys(commands: Redis, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  let cursor = '0';
  do {
    if (seen.has(cursor)) {
      throw new Error('queue: SCAN cursor repeated');
    }
    seen.add(cursor);
    const page = await commands.scan(
      cursor,
      'MATCH',
      `${escapeGlob(prefix)}*`,
      'COUNT',
      100,
    );
    const next = page[0];
    const found = page[1];
    if (typeof next !== 'string' || !Array.isArray(found)) {
      throw new Error('queue: SCAN returned an unexpected page');
    }
    cursor = String(next);
    for (const key of found) {
      if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
    }
  } while (cursor !== '0');
  return keys;
}

function escapeGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, (char) => `\\${char}`);
}

async function processKey(
  input: MaintainInput,
  report: ReportBuilder,
  key: string,
  now: number,
): Promise<void> {
  report.scanned += 1;
  const topic = topicOf(input.keyPrefix, key);
  if (topic === undefined) {
    report.skipped.push({ key, reason: 'empty-topic' });
    return;
  }
  let rawStream: unknown;
  try {
    rawStream = await input.commands.xinfo('STREAM', key);
  } catch (error) {
    report.skipped.push({ key, reason: skipReason(error) });
    if (skipReason(error) === 'xinfo-failed') {
      input.logger.error(
        error instanceof Error ? error : new Error('queue: XINFO failed'),
        { topic },
      );
    }
    return;
  }
  const stream = streamInfo(rawStream);
  if (!stream) {
    report.skipped.push({ key, reason: 'xinfo-failed' });
    return;
  }
  const stale =
    stream.firstId !== undefined &&
    isOlderThan(stream.firstId, input.retentionMs, now);
  if (report.dryRun) {
    if (stale) report.trimmed.push(topic);
  } else {
    try {
      const minId = `${now - input.retentionMs}-0`;
      await input.commands.xtrim(key, 'MINID', '~', minId);
      if (stale) report.trimmed.push(topic);
    } catch (error) {
      input.logger.error(
        error instanceof Error ? error : new Error('queue: XTRIM failed'),
        { topic },
      );
    }
  }

  let rawGroups: unknown;
  try {
    rawGroups = await input.commands.xinfo('GROUPS', key);
  } catch (error) {
    report.skipped.push({ key, reason: skipReason(error) });
    input.logger.error(
      error instanceof Error ? error : new Error('queue: XINFO GROUPS failed'),
      { topic },
    );
    return;
  }
  const groups = groupList(rawGroups);
  if (groups === undefined) {
    report.skipped.push({ key, reason: 'xinfo-failed' });
    return;
  }
  let remainingGroups = groups.length;
  let blocked = false;
  for (const group of groups) {
    try {
      const destroyed = await processGroup(
        input,
        report,
        key,
        topic,
        group,
        now,
      );
      if (destroyed) remainingGroups -= 1;
    } catch (error) {
      blocked = true;
      report.skipped.push({ key, reason: 'xinfo-failed' });
      input.logger.error(
        error instanceof Error
          ? error
          : new Error('queue: XINFO CONSUMERS failed'),
        { topic, group: group.name },
      );
    }
  }
  if (blocked || !input.options.dropIdleStreams) return;
  if (remainingGroups > 0) return;
  const idleMs = input.options.dropIdleStreams.idleMs;
  if (!isOlderThan(stream.lastGeneratedId, idleMs, now)) {
    if (streamIdTime(stream.lastGeneratedId) === undefined) {
      report.skipped.push({ key, reason: 'never-written' });
    }
    return;
  }
  if (!report.dryRun) {
    try {
      await input.commands.del(key);
    } catch (error) {
      input.logger.error(
        error instanceof Error ? error : new Error('queue: DEL failed'),
        { topic },
      );
      return;
    }
  }
  report.streamsDeleted.push({ topic, length: stream.length });
}

async function processGroup(
  input: MaintainInput,
  report: ReportBuilder,
  key: string,
  topic: string,
  group: GroupInfo,
  now: number,
): Promise<boolean> {
  let remaining = group.consumers;
  const idleConsumerMs = input.options.idleConsumerMs;
  if (idleConsumerMs !== undefined && group.consumers > 0) {
    const raw = await input.commands.xinfo('CONSUMERS', key, group.name);
    const consumers = consumerList(raw);
    if (consumers === undefined) {
      throw new Error('queue: XINFO CONSUMERS failed');
    }
    for (const consumer of consumers) {
      if (consumer.pending > 0 && consumer.idleMs >= idleConsumerMs) {
        report.stuck.push({
          topic,
          group: group.name,
          pending: consumer.pending,
          reason: 'pending-owned-by-idle-consumer',
        });
      }
      if (
        consumer.pending !== 0 ||
        consumer.idleMs < idleConsumerMs ||
        !consumer.name.startsWith(OWN_CONSUMER_PREFIX)
      ) {
        continue;
      }
      if (!report.dryRun) {
        try {
          await input.commands.xgroup(
            'DELCONSUMER',
            key,
            group.name,
            consumer.name,
          );
        } catch (error) {
          input.logger.error(
            error instanceof Error
              ? error
              : new Error('queue: DELCONSUMER failed'),
            { topic, group: group.name },
          );
          continue;
        }
      }
      report.consumersRemoved.push({
        topic,
        group: group.name,
        consumer: consumer.name,
        idleMs: consumer.idleMs,
      });
      remaining -= 1;
    }
  }
  if (group.pending > 0 && remaining <= 0) {
    report.stuck.push({
      topic,
      group: group.name,
      pending: group.pending,
      reason: 'no-consumers',
    });
  }
  const drop = input.options.dropIdleGroups;
  if (!drop || remaining > 0 || group.pending > 0) return false;
  if (!isOlderThan(group.lastDeliveredId, drop.idleMs, now)) {
    if (streamIdTime(group.lastDeliveredId) === undefined) {
      report.skipped.push({ key, reason: 'never-delivered' });
    }
    return false;
  }
  if (!report.dryRun) {
    try {
      await input.commands.xgroup('DESTROY', key, group.name);
    } catch (error) {
      input.logger.error(
        error instanceof Error
          ? error
          : new Error('queue: XGROUP DESTROY failed'),
        { topic, group: group.name },
      );
      return false;
    }
  }
  report.groupsDestroyed.push({ topic, group: group.name });
  return true;
}

function topicOf(prefix: string, key: string): string | undefined {
  if (!key.startsWith(prefix)) return undefined;
  const topic = key.slice(prefix.length);
  if (topic === '') return undefined;
  return topic;
}

function skipReason(error: unknown): RedisQueueMaintainSkipReason {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('WRONGTYPE')) return 'not-a-stream';
  if (message.includes('no such key')) return 'missing';
  return 'xinfo-failed';
}

function streamInfo(raw: unknown): StreamInfo | undefined {
  const fields = pairs(raw);
  if (!fields) return undefined;
  const length = asNumber(fields.length) ?? 0;
  const lastGeneratedId = asString(fields['last-generated-id']) ?? '0-0';
  const firstId = entryId(fields['first-entry']);
  return { length, lastGeneratedId, firstId };
}

function groupList(raw: unknown): GroupInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const groups: GroupInfo[] = [];
  for (const item of raw) {
    const fields = pairs(item);
    if (!fields) return undefined;
    const name = asString(fields.name);
    if (name === undefined) return undefined;
    groups.push({
      name,
      consumers: asNumber(fields.consumers) ?? 0,
      pending: asNumber(fields.pending) ?? 0,
      lastDeliveredId: asString(fields['last-delivered-id']) ?? '0-0',
    });
  }
  return groups;
}

function consumerList(raw: unknown): ConsumerInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const consumers: ConsumerInfo[] = [];
  for (const item of raw) {
    const fields = pairs(item);
    if (!fields) return undefined;
    const name = asString(fields.name);
    const idleMs = asNumber(fields.idle);
    if (name === undefined || idleMs === undefined) return undefined;
    consumers.push({
      name,
      pending: asNumber(fields.pending) ?? 0,
      idleMs,
    });
  }
  return consumers;
}

function pairs(raw: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (let i = 0; i < raw.length - 1; i += 2) {
    const key = raw[i];
    if (typeof key !== 'string') return undefined;
    out[key] = raw[i + 1];
  }
  return out;
}

function entryId(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return typeof value[0] === 'string' ? value[0] : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function streamIdTime(id: string): number | undefined {
  const head = id.split('-')[0] ?? '';
  if (head === '' || head === '0') return undefined;
  const ms = Number(head);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return ms;
}

function isOlderThan(id: string, idleMs: number, now: number): boolean {
  const time = streamIdTime(id);
  if (time === undefined) return false;
  return time <= now - idleMs;
}
