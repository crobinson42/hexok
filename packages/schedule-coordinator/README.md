# @hexok/schedule-coordinator

Schedule port. Install with `npm i @hexok/schedule-coordinator`. A Redis lock adapter is `@hexok/schedule-coordinator-redis`.

```ts
import { ScheduleCoordinator } from '@hexok/schedule-coordinator';
```

`register` records a cron job whose `onTick` runs in-process. The application decides whether that function enqueues work. There is no `complete()` callback. A duplicate name throws `schedule: job "<name>" is already registered`.
