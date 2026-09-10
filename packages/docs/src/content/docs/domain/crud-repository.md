---
title: CrudRepository
description: Standard repository shape. Authors write their own port; this is what InMemoryRepository can fake.
sidebar:
  order: 9
---

`CrudRepository<E>` is the standard `{ get, save, list?, delete? }` shape. Authors still write their own port interface. This is the contract [InMemoryRepository](/testing/in-memory-repository/) can fake.

Extra methods on the port mean you write a custom fake — the in-memory helper will not invent them.

```ts
interface CrudRepository<E> {
  get(id: string): Promise<E | null>
  save(entity: E): Promise<void>
  list?(): Promise<E[]>
  delete?(id: string): Promise<void>
}
```

See also: [Port](/domain/port/).
