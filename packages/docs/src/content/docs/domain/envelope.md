---
title: Envelope
description: Runtime value on the wire. kind is copied from the catalog.
sidebar:
  order: 6
---

An `Envelope` is the runtime value on the wire. `kind` is copied from the catalog. Use cases usually `publish` a `DomainEvent`; the runtime wraps it.

Fields: `key`, `payload`, `catalog`, `kind`, `occurredAt`, optional `ctx` (when the catalog called `.ctx<T>()`), optional `correlationId` / `causationId`, and `meta`.

```ts
type Envelope = {
  key: string
  payload: unknown
  catalog: string
  kind: 'bus' | 'broker'
  occurredAt: Date
  ctx?: unknown
  correlationId?: string
  causationId?: string
  meta: Record<string, unknown>
}
```

See also: [Publish after success](/application/publish-after-success/), [Interceptor](/runtime/interceptor/).
