---
title: Company infrastructure
description: Logger, queue, integration events, webhooks, broadcast, email, SMS, schedule, quarantine, and auth packages that apps install beside hexok.
---

`hexok` stays the primitive kit. These packages are company drivers. An application installs the ones it uses. They are not dependencies of `hexok`.

Each package page is that package's README. The list is generated from the published workspaces, so a new package cannot ship without a page. See [Packages](/hexok/packages/).

Each adapter extends `Adapter` with its port. The composition root constructs it and passes it like any other adapter.

`@hexok/integration-events` is not an adapter. It publishes and subscribes versioned events between applications through any `Queue` adapter. See [its page](/hexok/packages/integration-events/).

`@hexok/webhooks` is not an adapter either. It sends an `EventCatalog`'s events to endpoints a product stores, signed as Standard Webhooks, over a `Queue` adapter that supports delay. The product implements its `WebhookEndpoints` port. See [its page](/hexok/packages/webhooks/).

`@hexok/auth` proves who a call is. Its `Authenticator` port turns a credential into the identity it proves, and `resolving` is the seam where the app turns that identity into its own actor. `Sessions` runs login, logout, and authentication for an app that signs its own users in. `@hexok/auth-redis` stores the sessions and `@hexok/auth-jose` signs the tokens. Only the gateway and the composition root import these packages. Use cases receive the app's actor, so an app can swap to an identity provider without changing a use case. See [its page](/hexok/packages/auth/).
