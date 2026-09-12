---
title: InternalUseCase
description: Composition-only request/response use case. Sibling of ExternalUseCase.
sidebar:
  order: 2
---

```ts
import { InternalUseCase } from 'hexok/app'
```

Same execute shape as [ExternalUseCase](/api/app/external-use-case/). Omitted from `deriveContract`, `app.contract`, `app.local`, and HTTP. Still in completeness. Invocable via `ctx.run`.

Declare static `key`, `input`, `output`, `errors`, `ports`. Implement `execute`.

## Statics

| Name | Type | Notes |
| --- | --- | --- |
| `trigger` | `'internal'` | Discriminator for `App.from` / `isInternalUseCase`. Do not override. |
| `key` | `string` | Use-case id. Unique among the callable family (external + internal). |
| `input` | `StandardSchemaV1` | Request schema. Validated before `execute`. |
| `output` | `StandardSchemaV1` | Success schema. Types `execute` and `run`. |
| `errors` | `ErrorMap` | Declared refusals. Keys become `errors.CODE()` on `ExecuteCtx`. |
| `ports` | `Record<string, PortToken>` | Port tokens keyed by the alias used in `execute`. |
| `publishes` | `readonly AnyEventCatalog[]` | Catalogs this use case may `publish` to. Use `as const`. |
| `channels` | `readonly EventChannelCtor[]` | Channels available as `channels` on execute ctx. Use `as const`. |

## Instance

Same as ExternalUseCase: `execute(ctx)` and `unwrap(result)`.

## Example

```ts
class CreateUser extends InternalUseCase {
  static readonly key = 'user.create'
  static readonly input = z.object({ id: z.string(), name: z.string() })
  static readonly output = z.object({ id: z.string() })
  static readonly errors = { USER_EXISTS: { message: 'User already exists' } } as const
  static readonly ports = { users: UserRepository }

  async execute({ input, ports, errors }: ExecuteCtx<typeof CreateUser>) {
    if (await ports.users.getUser(input.id)) throw errors.USER_EXISTS()
    await ports.users.saveUser(input)
    return { id: input.id }
  }
}
```

Call it from an external use case with `run(CreateUser, input)`. Nested `run` shares ctx, signal, and the parent publish queue. It does not re-enter interceptors or `App.use`.

## Related

- [ExternalUseCase](/api/app/external-use-case/)
- [ExecuteCtx](/api/app/execute-ctx/)
- [EventUseCase](/api/app/event-use-case/)
- [App](/api/runtime/app/)
