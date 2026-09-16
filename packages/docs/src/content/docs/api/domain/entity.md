---
title: Entity
description: Aggregate base class. Mutates via set; create and parse validate; restore does not.
sidebar:
  order: 1
---

```ts
import { Entity, type DeepReadonly, type EntityConstructor } from 'hexok/domain'
```

Subclass with typed props. Writes go through `set`. Validation and declared refusals throw `CodedError`.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `key` | `string` | Entity name in validation and undeclared-error messages. |
| `schema` | `StandardSchemaV1` | Used by `create`, `parse`, `set`, and `validate()`. |
| `errors` | `ErrorMap` | Declared refusal codes. Keys are the `error()` union. |
| `create(props)` | `(props) => instance` | Validates, constructs, `isNew: true`. |
| `restore(props)` | `(props) => instance` | No schema run. `isNew: false`, `isValidated: false`. |
| `parse(value)` | `(unknown) => instance` | Validates like `create`; tracking matches `restore`. |
| `error(code, data?)` | `(code, data?) => never` | Throws a declared entity error. |

`create` / `parse` throw `CodedError` `VALIDATION` if the schema rejects. `restore` stores props as given (no strip/defaults).

An undeclared `error()` code is a type error at the call site and a programming error at runtime.

## Instance

| Name | Type | Notes |
| --- | --- | --- |
| `props` | `DeepReadonly<P>` | Live props. Read-only; write through `set`. |
| `isNew` | `boolean` | True after `create` until `commit`. `restore` / `parse` start false. |
| `isValidated` | `boolean` | True after `create`, `parse`, a writing `set`, or `validate()`. |
| `original` | `DeepReadonly<P> \| undefined` | Pre-mutation props after the first `set` on a restored entity. |
| `set(producer)` | `(producer: (draft: P) => void) => this` | Copy-on-write mutate. Re-validates the schema after a write. |
| `validate()` | `() => this` | Runs the schema if not already passed. No-op when `isValidated`. |
| `getChangedKeys(opts?)` | `(opts?: { deep?: boolean }) => string[]` | Shallow keys that differ from `original`. `{ deep: true }` returns dotted leaf paths. |
| `isDirty()` | `() => boolean` | True after `create` until `commit`, or when any shallow key changed. |
| `commit()` | `() => this` | Accept current props as original; `isNew` becomes false. |
| `toProps()` | `() => DeepReadonly<P>` | Deep frozen snapshot. Reused until the next `set`. |
| `toJSON()` | `() => DeepReadonly<P>` | Same as `toProps()`. |

`commit()` is for adapters after persist.

## Types

| Name | Notes |
| --- | --- |
| `DeepReadonly<T>` | Recursively readonly view of entity props. `Date` values stay `Date`. |
| `EntityConstructor` | Subclass constructor shape for `create` / `restore` / `parse`. |

## Example

```ts
class Incident extends Entity<IncidentProps> {
  static readonly key = 'Incident'
  static readonly schema = z.object({
    id: z.string(),
    status: z.enum(['open', 'closed']),
  })
  static readonly errors = {
    ALREADY_CLOSED: { message: 'Incident already closed' },
  } as const

  close(now: Date): this {
    if (this.props.status === 'closed') Incident.error('ALREADY_CLOSED')
    return this.set((draft) => {
      draft.status = 'closed'
      draft.closedAt = now
    })
  }
}

const incident = Incident.create({ id: '1', status: 'open' })
const restored = Incident.restore({ id: '1', status: 'open' })
```

## Related

- [CodedError](/hexok/api/core/coded-error/)
- [ErrorMap](/hexok/api/core/errors/)
- [Mapper](/hexok/api/infra/mapper/)
- [InMemoryRepository](/hexok/api/testing/in-memory-repository/)
