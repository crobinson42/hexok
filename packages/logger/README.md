# @hexok/logger

Logger port and in-process adapters. Install with `npm i @hexok/logger`.

The adapter classes are closed. Their fields and helpers are private. Wrap one in your own adapter of the port when you need extra logic.

```ts
import { MemoryLogger } from '@hexok/logger';

const logger = new MemoryLogger({ minLevel: 'info' });
logger.info('ready', { component: 'api' });
logger.child({ requestId: '1' }).error(new Error('failed'));
```

`debug` < `info` < `warn` < `error`. `ConsoleLogger` and `JsonLineLogger` default `minLevel` to `info`. `MemoryLogger` defaults to `debug`. `NoopLogger.child` returns itself. A memory child appends to the parent record array.

`TeeLogger` forwards each call to every sink, in constructor order. `child` returns a new tee of each sink's child. A throw from one sink stops later sinks.

The logger sets `time`, `level`, and `message` after caller fields. `normalizeError` maps only `Error` values and leaves strings as strings. Neither adapter reads `process.env`. Redaction is the application's job.

A structural sink with `debug`, `info`, `warn`, and `error` accepts a `Logger`. `child` is not required on that sink.
