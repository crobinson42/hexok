import type { Logger } from '@hexok/logger';

/**
 * Run `stop` once on SIGINT or SIGTERM, then exit.
 * A second signal exits without waiting.
 */
export function onShutdown(logger: Logger, stop: () => Promise<void>): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) process.exit(1);
    stopping = true;
    logger.info('shutting down', { signal });
    stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error(error instanceof Error ? error : 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
