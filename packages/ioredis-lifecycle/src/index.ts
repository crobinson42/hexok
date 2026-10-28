export { LifecycleError } from './errors.js';
export type { LogSink } from './log-sink.js';
export { openRedis } from './open-redis.js';
export {
  type AttachOptions,
  type LifecycleState,
  RedisLifecycle,
  type RedisLifecycleOptions,
  type RunOptions,
  type StopCleanup,
  type StopContext,
} from './redis-lifecycle.js';
export { sleep } from './timing.js';
