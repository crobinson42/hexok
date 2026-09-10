---
title: InMemoryBus
description: In-process bus. Records published. stop() clears subscribers.
sidebar:
  order: 3
---

`InMemoryBus` implements [BusAdapter](/domain/bus-adapter/). Bind it to a `kind: 'bus'` catalog. It records `published` and runs subscribers in-process.

```ts
.bind(DomainEvents, InMemoryBus.create())
```

See also: [InMemoryBroker](/testing/in-memory-broker/), [App.test](/testing/app-test/).
