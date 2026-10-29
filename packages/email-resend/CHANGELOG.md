# @hexok/email-resend

## 1.0.0

### Major Changes

- [`9e42ece`](https://github.com/crobinson42/hexok/commit/9e42eced138949d2f17d3a49c0fa5cc51f2b19c5) Thanks [@crobinson42](https://github.com/crobinson42)! - Require Node.js 22. Retries use `p-retry` 8. A failed send still parks the attempt count.

### Patch Changes

- Updated dependencies [[`091523f`](https://github.com/crobinson42/hexok/commit/091523f4119b6ebff19cd1d72ee61cd26c0ed985)]:
  - hexok@2.2.2

## 0.2.0

### Minor Changes

- [#9](https://github.com/crobinson42/hexok/pull/9) [`9df798e`](https://github.com/crobinson42/hexok/commit/9df798e9140639498f7e147cf3cad818c3bb6e9c) Thanks [@crobinson42](https://github.com/crobinson42)! - `ResendLike` accepts the `Resend` client from `resend` without a cast. `ResendEmailPayload` requires `html` or `text`, as the SDK does. `send` passes `attachments` to Resend.

  `Rejected` carries its default message instead of Resend's error text. Set `exposeProviderErrors: true` to keep the text. A `sensitive` message never exposes it and parks only counts. A failed park logs only the error name.

  `ResendEmailPayload` is now a union type that requires `html` or `text`, so an interface can no longer extend it.

### Patch Changes

- Updated dependencies [[`45b26c8`](https://github.com/crobinson42/hexok/commit/45b26c83eb06e4b1320f294e6f8fc430d432c992), [`a2ef655`](https://github.com/crobinson42/hexok/commit/a2ef655e3219fc91ae783f8f662107359e1bc253), [`ef5febe`](https://github.com/crobinson42/hexok/commit/ef5febef9cdb084c346ac4f34953f72cd030592d)]:
  - hexok@2.2.1
  - @hexok/email@0.2.0

## 0.1.0

### Minor Changes

- [#5](https://github.com/crobinson42/hexok/pull/5) [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8) Thanks [@crobinson42](https://github.com/crobinson42)! - Initial 0.1.0 release of @hexok/email-resend.

- [#5](https://github.com/crobinson42/hexok/pull/5) [`dbf1516`](https://github.com/crobinson42/hexok/commit/dbf1516e1551af5d593070eb40757238b20b85d9) Thanks [@crobinson42](https://github.com/crobinson42)! - Add a quarantine port for a failed outbound attempt, and optional park hooks on the email, SMS, and Redis queue adapters.

### Patch Changes

- Updated dependencies [[`11e10cd`](https://github.com/crobinson42/hexok/commit/11e10cd90b636215324f3f54c03acdd91a3da159), [`804ad44`](https://github.com/crobinson42/hexok/commit/804ad44d647cccc69537d5a09abd84ff210f4bf8), [`faf7f47`](https://github.com/crobinson42/hexok/commit/faf7f472b56ad6e2b1b17dac86908e20ee6540a6)]:
  - hexok@2.2.0
  - @hexok/email@0.1.0
