# @hexok/logger

Logger port and in-process adapters. Install with `npm i @hexok/logger`.

```ts
import { MemoryLogger } from '@hexok/logger';

const logger = new MemoryLogger({ minLevel: 'info' });
logger.info('ready', { component: 'api' });
logger.child({ requestId: '1' }).error(new Error('failed'));
```

`debug` < `info` < `warn` < `error`. `ConsoleLogger` and `JsonLineLogger` default `minLevel` to `info`. `MemoryLogger` defaults to `debug`. `NoopLogger.child` returns itself. A memory child appends to the parent record array.

The logger sets `time`, `level`, and `message` after caller fields. `normalizeError` maps only `Error` values and leaves strings as strings. Neither adapter reads `process.env`. Redaction is the application's job.

A structural sink with `debug`, `info`, `warn`, and `error` accepts a `Logger`. `child` is not required on that sink.
