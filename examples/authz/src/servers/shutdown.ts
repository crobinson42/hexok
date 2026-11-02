/** Run `stop` once on SIGINT or SIGTERM, then exit. A second signal exits at once. */
export function onShutdown(stop: () => Promise<void>): void {
  let stopping = false;
  const shutdown = () => {
    if (stopping) process.exit(1);
    stopping = true;
    stop().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
