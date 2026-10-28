import { Errors } from 'hexok';

/**
 * Lifecycle errors from {@link RedisLifecycle}. Match on `code`.
 * Each message starts with the adapter name and says the fix.
 */
export class LifecycleError extends Errors('ioredis-lifecycle', {
  NotStarted: { message: 'The Redis adapter is not started' },
  Starting: { message: 'The Redis adapter is still starting' },
  Stopped: { message: 'The Redis adapter was stopped' },
  StoppedBeforeReply: {
    message:
      'stop() was called before Redis replied. Redis may or may not have run it',
  },
  StartTimeout: { message: 'Redis was not ready in time' },
  EndedBeforeReady: {
    message: 'The Redis connection ended before it was ready',
  },
}) {}

/** Message builders. `operation` is a method name without parentheses, such as `publish`. */
export const messages = {
  notStarted: (adapter: string, operation: string) =>
    `${adapter}: not started. Call and await start() before ${operation}().`,
  starting: (adapter: string, operation: string) =>
    `${adapter}: start() has not finished. Await start() before ${operation}().`,
  stopped: (adapter: string, operation: string) =>
    `${adapter}: stop() was called. Call start() again before ${operation}().`,
  stoppedDuringStart: (adapter: string) =>
    `${adapter}: stop() was called before start() finished. Call start() again to connect.`,
  startDuringStop: (adapter: string) =>
    `${adapter}: stop() has not finished. Await stop() before start().`,
  closing: (adapter: string) =>
    `${adapter}: stop() is closing the connections. Call start() again to connect.`,
  stoppedBeforeReply: (adapter: string, operation: string) =>
    `${adapter}: stop() was called before Redis replied to ${operation}(). Redis may or may not have run it. Check Redis before you retry.`,
  endedAfterReady: (adapter: string, connection: string) =>
    `${adapter}: the ${connection} connection ended after start(). Commands fail until you call stop() and start() again.`,
  startTimeout: (adapter: string, ms: number) =>
    `${adapter}: Redis was not ready within ${ms}ms. Check that Redis is reachable, or raise startTimeoutMs.`,
  endedBeforeReady: (adapter: string, connection: string) =>
    `${adapter}: the ${connection} connection ended before it was ready. Check the redis options and retryStrategy, then call start() again.`,
};
