# @hexok/quarantine

Quarantine port for a failed outbound attempt. Install with `npm i @hexok/quarantine`. `MemoryQuarantine` is the in-process adapter.

```ts
import { MemoryQuarantine, parkOnThrow } from '@hexok/quarantine';

const quarantine = new MemoryQuarantine();
const { id } = await quarantine.park({
  source: 'email',
  operation: 'send',
  subject: 'key-1',
  payload: { to: ['ada@ex.com'], subject: 'Hello' },
  error: { name: 'email.Unavailable', message: 'Email provider is unavailable', code: 'Unavailable', catalog: 'email' },
  occurredAt: new Date(),
});
```

`park` retains the attempt. `get` returns `null` when the id is missing. `list` filters by `source`, `operation`, `status`, and `since`, newest `occurredAt` first, then park order. `limit` defaults to 100 and must be `1..1000`. `resolve` marks `resolved` or `discarded`. The same outcome again returns. A different outcome throws `Closed`. A missing id throws `Missing`.

`parkOnThrow` parks a thrown error, then rethrows it. A failure of `park` calls `onParkError` and still rethrows the original. A use case that cannot proceed without a record calls `park` itself.

This is not an outbox, not a broker dead-letter stream, and not a logger. Parking does not make the original call succeed. A remote box cannot retain a failure of itself. The payload must be JSON-safe. Redaction is the application's job. Two parks of the same subject are two items. There is no replay method.
