# @hexok/logger-sentry

Ships `warn` and `error` from the hexok `Logger` port to a Sentry client the app constructs. Install with `npm i @hexok/logger-sentry`. `@sentry/node` `>=8` is an optional peer and is not imported.

```ts
import { SentryLogger, type SentryLike } from '@hexok/logger-sentry';

const logger = new SentryLogger({ client: Sentry as unknown as SentryLike });
logger.error(new Error('failed'), { requestId: '1' });
```

`error(Error)` calls `captureException(err, { extra })`. A string `error` and `warn` call `captureMessage(message, { level, extra })`. `debug` and `info` make no call. `child` returns a new logger over the same client. There is no `minLevel`.
