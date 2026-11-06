# @hexok/integration-events

## 0.2.0

### Minor Changes

- [#21](https://github.com/crobinson42/hexok/pull/21) [`65f4594`](https://github.com/crobinson42/hexok/commit/65f45942bef5c4e9353ec8075a6878eeed658808) Thanks [@crobinson42](https://github.com/crobinson42)! - `publish` validates each payload in the JSON form the queue carries and sends that form, so a `Date`, `bigint`, or other value that does not survive JSON fails at `publish` instead of at every consumer. `downgrade.map` receives the schema's output. A failed park makes the delivery throw, so the queue retries it instead of dropping it. A failed or concurrent `subscribe` leaves nothing half subscribed. Parked records carry `attempts`.

### Patch Changes

- Updated dependencies [[`b671d05`](https://github.com/crobinson42/hexok/commit/b671d05d2da64ef685a7aaf91b8a579dcda60073)]:
  - hexok@2.2.5

## 0.1.0

### Minor Changes

- [#19](https://github.com/crobinson42/hexok/pull/19) [`df8d786`](https://github.com/crobinson42/hexok/commit/df8d786f69ebb91253c5c8071d2bdb921e29199a) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `@hexok/integration-events`. A `Contract` names a product's topics and versioned `Message` classes. `IntegrationPublisher` publishes them as CloudEvents envelopes through a `Queue`, with a downgraded copy for each earlier version. `IntegrationSubscriber` subscribes `EventHandler`s with one consumer group per service and handler.

### Patch Changes

- Updated dependencies [[`c456d74`](https://github.com/crobinson42/hexok/commit/c456d741b5fde1d356646c4eb043d766cee6b03e)]:
  - hexok@2.2.4
