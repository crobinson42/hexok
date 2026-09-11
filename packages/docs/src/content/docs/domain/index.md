---
title: Domain
description: Entities, ports, events, and catalogs — ordinary classes with no I/O.
sidebar:
  order: 0
---

`hexok/domain` is where business types live. Entities never I/O, never publish, never hold ports. Ports are TypeScript interfaces plus a token. Events are classes registered on a catalog.

- [Entity](/domain/entity/) — mutable aggregate; `set` is the write, `props` is `DeepReadonly`
- [Port](/domain/port/) — interface + token
- [DomainEvent](/domain/domain-event/) — event class
- [EventCatalog](/domain/event-catalog/) — bus or queue registry
- [Envelope](/domain/envelope/) — wire shape
- [BusAdapter](/domain/bus-adapter/) — fire-and-forget pub/sub
- [QueueAdapter](/domain/queue-adapter/) — work queue, acked consume
- [ChannelAdapter](/domain/channel-adapter/) — local presence and send
- [CrudRepository](/domain/crud-repository/) — standard `{ get, save }`
- [UnitOfWork](/domain/unit-of-work/) — commit/rollback hooks
- [Transactional](/domain/transactional/) — `bindTo(uow)`
- [RequestScoped](/domain/request-scoped/) — `fork()` per call
