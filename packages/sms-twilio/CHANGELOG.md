# @hexok/sms-twilio

## 0.2.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`970d7dd`](https://github.com/crobinson42/hexok/commit/970d7dd03e374631a7d9c7de99a1a148b068fc67) Thanks [@crobinson42](https://github.com/crobinson42)! - A failed send logs only `code`, `status`, and `attempt`, a failed park logs only the error `name`, and `Rejected` uses its catalog message. `exposeProviderErrors` restores the raw errors, except on a `sensitive` message, which parks `{ sensitive, bodyLength }` instead of `to` and `body`.

### Patch Changes

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`a2ef655`](https://github.com/crobinson42/hexok/commit/a2ef655e3219fc91ae783f8f662107359e1bc253), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1
  - @hexok/sms@0.2.0

## 0.1.0

### Minor Changes

- [#5](https://github.com/crobinson42/hexok/pull/5) [`dbf1516`](https://github.com/crobinson42/hexok/commit/dbf1516e1551af5d593070eb40757238b20b85d9) Thanks [@crobinson42](https://github.com/crobinson42)! - Add a quarantine port for a failed outbound attempt, and optional park hooks on the email, SMS, and Redis queue adapters.

- [#5](https://github.com/crobinson42/hexok/pull/5) [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial 0.1.0 release of @hexok/sms-twilio.

### Patch Changes

- Updated dependencies [[`11e10cd`](https://github.com/crobinson42/hexok/commit/11e10cd90b636215324f3f54c03acdd91a3da159), [`faf7f47`](https://github.com/crobinson42/hexok/commit/faf7f472b56ad6e2b1b17dac86908e20ee6540a6), [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8)]:
  - hexok@2.2.0
  - @hexok/sms@0.1.0
