# @hexok/integration-events

## 0.1.0

### Minor Changes

- [#19](https://github.com/crobinson42/hexok/pull/19) [`df8d786`](https://github.com/crobinson42/hexok/commit/df8d786f69ebb91253c5c8071d2bdb921e29199a) Thanks [@crobinson42](https://github.com/crobinson42)! - Add `@hexok/integration-events`. A `Contract` names a product's topics and versioned `Message` classes. `IntegrationPublisher` publishes them as CloudEvents envelopes through a `Queue`, with a downgraded copy for each earlier version. `IntegrationSubscriber` subscribes `EventHandler`s with one consumer group per service and handler.

### Patch Changes

- Updated dependencies [[`c456d74`](https://github.com/crobinson42/hexok/commit/c456d741b5fde1d356646c4eb043d766cee6b03e)]:
  - hexok@2.2.4
