---
title: Company infrastructure
description: Logger, queue, broadcast, email, SMS, schedule, and quarantine packages that apps install beside hexok.
---

`hexok` stays the primitive kit. These packages are company drivers. An application installs the ones it uses. They are not dependencies of `hexok`.

| Package | Role | Install |
| --- | --- | --- |
| `@hexok/logger` | Logger port, console, JSON-line, noop, and memory adapters | `npm i @hexok/logger` |
| `@hexok/logger-sentry` | Sentry shipper | `npm i @hexok/logger-sentry` |
| `@hexok/logger-newrelic` | New Relic `noticeError` shipper | `npm i @hexok/logger-newrelic` |
| `@hexok/queue` | Queue port | `npm i @hexok/queue` |
| `@hexok/queue-redis` | Redis Streams queue | `npm i @hexok/queue-redis` |
| `@hexok/quarantine` | Quarantine port and memory adapter for a failed outbound attempt | `npm i @hexok/quarantine` |
| `@hexok/broadcast` | Broadcast port | `npm i @hexok/broadcast` |
| `@hexok/broadcast-redis` | Redis pub/sub broadcast | `npm i @hexok/broadcast-redis` |
| `@hexok/email` | Email port and `EmailError` | `npm i @hexok/email` |
| `@hexok/email-resend` | Resend email adapter | `npm i @hexok/email-resend` |
| `@hexok/email-mailgun` | Mailgun email adapter | `npm i @hexok/email-mailgun` |
| `@hexok/sms` | SMS port and `SmsError` | `npm i @hexok/sms` |
| `@hexok/sms-twilio` | Twilio SMS adapter | `npm i @hexok/sms-twilio` |
| `@hexok/schedule-coordinator` | Schedule port | `npm i @hexok/schedule-coordinator` |
| `@hexok/schedule-coordinator-redis` | Redis schedule lock | `npm i @hexok/schedule-coordinator-redis` |

Each adapter extends `Adapter` with its port. The composition root constructs it and passes it like any other adapter.

`@hexok/quarantine` keeps a failed outbound attempt so it can be inspected. `MemoryQuarantine` is the in-process adapter. Email, SMS, and Redis queue adapters take an optional structural `quarantine` and park outages only. `send` and `publish` still throw. A handler `'drop'` is not parked. There is no replay method.

```ts
import { Queue } from '@hexok/queue';
import { RedisQueue } from '@hexok/queue-redis';

const queue = new RedisQueue({ redis: 'redis://127.0.0.1:6379' });
await queue.start();

const port: Queue = queue;
await port.publish('jobs', { id: '1' });
```
