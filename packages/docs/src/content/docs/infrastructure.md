---
title: Company infrastructure
description: Logger, queue, integration events, webhooks, broadcast, email, SMS, schedule, and quarantine packages that apps install beside hexok.
---

`hexok` stays the primitive kit. These packages are company drivers. An application installs the ones it uses. They are not dependencies of `hexok`.

Each package page is that package's README. The list is generated from the published workspaces, so a new package cannot ship without a page. See [Packages](/hexok/packages/).

Each adapter extends `Adapter` with its port. The composition root constructs it and passes it like any other adapter.

`@hexok/integration-events` is not an adapter. It publishes and subscribes versioned events between applications through any `Queue` adapter. See [its page](/hexok/packages/integration-events/).

`@hexok/webhooks` is not an adapter either. It sends an `EventCatalog`'s events to endpoints a product stores, signed as Standard Webhooks, over a `Queue` adapter that supports delay. The product implements its `WebhookEndpoints` port. See [its page](/hexok/packages/webhooks/).
