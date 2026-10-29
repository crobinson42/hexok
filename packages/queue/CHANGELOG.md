# @hexok/queue

## 1.0.0

### Major Changes

- [`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985) Thanks [@crobinson42](https://github.com/crobinson42)! - `subscribe` requires `maxDeliveries`. A positive integer runs the handler at most that many times. `'unlimited'` keeps retrying. A retry at the ceiling is acknowledged. The Redis adapter reads the pending delivery count and parks a give-up when a sink is set. A give-up is `source: 'queue'`, `operation: 'deliver'`, subject `topic:id`, and error `queue: deliveries exhausted`. Quarantine has no replay method. A republish is a new entry.

### Patch Changes

- Updated dependencies [[`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985)]:
  - hexok@2.2.2

## 0.2.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`a2ef655`](https://github.com/crobinson42/hexok/commit/a2ef655e3219fc91ae783f8f662107359e1bc253) Thanks [@crobinson42](https://github.com/crobinson42)! - `SmsMessage` and `EmailMessage` take `sensitive`. `Queue.publish` takes `{ sensitive }` as a third argument. An adapter keeps a sensitive message's content out of quarantine and logs.

### Patch Changes

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1

## 0.1.0

### Minor Changes

- [#5](https://github.com/crobinson42/hexok/pull/5) [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial 0.1.0 release of @hexok/queue.

### Patch Changes

- Updated dependencies [[`11e10cd`](https://github.com/crobinson42/hexok/commit/11e10cd90b636215324f3f54c03acdd91a3da159), [`faf7f47`](https://github.com/crobinson42/hexok/commit/faf7f472b56ad6e2b1b17dac86908e20ee6540a6)]:
  - hexok@2.2.0
