# @hexok/logger-newrelic

Forwards `error` from the hexok `Logger` port to New Relic `noticeError`. Install with `npm i @hexok/logger-newrelic`. `newrelic` `>=12` is an optional peer and is not imported.

```ts
import { NewRelicLogger, type NewRelicLike } from '@hexok/logger-newrelic';

const logger = new NewRelicLogger({ client: newrelic as unknown as NewRelicLike });
logger.error(new Error('failed'), { requestId: '1' });
```

`debug`, `info`, and `warn` make no call. A string is forwarded unchanged. Attribute values that are not `string`, `number`, or `boolean` become `typeof`. `child` returns a new logger over the same client.
