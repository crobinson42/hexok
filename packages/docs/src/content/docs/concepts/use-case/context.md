---
title: UseCase.context
description: A family of use cases that share a per-call context, guards, and hooks.
---

`UseCase.context` builds a family of use cases that share one kind of call. Every member receives a context argument, and the family can refuse a call in a guard or observe it with hooks. Each member still has its own token, its own ports, and its own `execute`.

This sits beside [`UseCase(token)`](/hexok/concepts/use-case/). Reach for it when the call carries something the story should see, such as a trace id or the actor who published the post.

```ts
const ApiUseCase = UseCase.context<ApiContext>()
```

## Why it exists

A gateway often has facts that every API use case needs and none of them should reload: who is calling, and the trace id for this request. Putting that bag on `execute` as a first argument keeps it out of the post payload.

Some of those facts can end the call before the story runs. A missing trace id belongs to the call itself, so a guard on the family refuses it for every member. Hooks cover the surrounding work: starting a timer, recording the outcome, finishing a span. They see the call and the result. The method receives the input the caller passed.

## How it's used

The blog's HTTP use cases share `{ traceId: string }`. One guard refuses an empty trace id. `PublishPost` is a member of that family, so its `execute` takes the context and then the input.

```ts
type ApiContext = { traceId: string }

const ApiUseCase = UseCase.context<ApiContext>().guard((call) => {
  if (call.ctx.traceId.length < 1) throw BlogError.TraceIdMissing()
})

class PublishPost extends ApiUseCase('post.publish') {
  constructor(
    private readonly posts: PostRepository,
    private readonly events: BlogEventPublisher,
  ) {
    super()
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: { id: string },
  ): Promise<{ id: string }> {
    const post = await this.posts.get(input.id)
    post.publish(new Date())
    await this.posts.save(post)
    await this.events.publish(new PostPublished(post.toProps()))
    return { id: post.props.id }
  }
}

await new PublishPost(posts, events).execute(
  { traceId: 'req-1' },
  { id: 'p1' },
)
```

A member that needs a static contract, such as a permission string or an input schema, declares that contract as the second type argument. The schema is data the guard can read. Validating the input stays in the guard or in `execute`.

```ts
const ActorUseCase = UseCase.context<
  { traceId: string; actorId: string },
  { permission: string }
>().guard((call) => {
  if (call.spec.permission.length < 1) throw BlogError.Forbidden()
})

class PublishPost extends ActorUseCase('post.publish', {
  permission: 'posts.publish',
}) {
  async execute(
    ctx: UseCase.Ctx<typeof ActorUseCase>,
    input: { id: string },
  ): Promise<{ id: string }> {
    return { id: input.id }
  }
}
```

## API

### Factory

`UseCase.context<Ctx, Spec>(config?)` returns a factory. `Ctx` is required. Omitting it makes the return type the string `'Pass a type argument: UseCase.context<Ctx>()'`. `Spec` defaults to an empty contract.

`config` accepts no keys yet. Call `UseCase.context<Ctx>()` or `UseCase.context<Ctx>({})`.

`.guard(fn)` and `.hooks(def)` each return the factory again, so the calls can sit in either order and either one can be left off. A further `.guard()` runs after guards already registered.

With an empty `Spec`, a member is `Factory(token)`. When `Spec` has keys, the member is `Factory(token, statics)` and the bag has to satisfy `Spec`. Those entries are copied onto the class as statics. The names `token`, `prototype`, `name`, and `length` stay on the class. Passing one of them is a type error.

`execute` is still required. Annotate `ctx` and `input` on the subclass. A member with no input omits the second parameter. Declare `execute` as a method. Assigning it as a class field, or replacing it after `super()`, skips the guard and the hooks.

When the family has no guard and no hooks, `execute` stays unwrapped.

### The call

A guard and `preExecute` receive:

| Field | Meaning |
| --- | --- |
| `ctx` | The context the caller passed. |
| `spec` | The static contract, typed as `Spec`. This is the family contract, so a guard sees `permission: string` even when one member passed the literal `'posts.publish'`. |
| `token` | This member's token. |
| `input` | The second argument the caller passed to `execute`. Typed `unknown`. The method receives that same value. |

`UseCase.GuardParameters<typeof ApiUseCase>` is that call. `UseCase.Ctx<typeof ApiUseCase>` is `ctx`. Pass the factory from `UseCase.context`. A subclass, and a plain `UseCase` class, resolve to `never`.

### Guards

A guard is `(call) => void | Promise<void>`. Guards run before `execute`, and outside the hook `try`. A throw from a guard skips `preExecute`, `postExecute`, `onCatch`, and `onFinally`.

### Hooks

`.hooks(definition)` registers one set of callbacks for the family. A second `.hooks()` that includes at least one callback throws `hexok: UseCase hooks are already set` when the factory is created. An empty `.hooks({})` adds no callbacks.

| Hook | When it runs | Extra fields |
| --- | --- | --- |
| `preExecute(call)` | After the guards, before the method. | Its return value is `state` for the later hooks. |
| `postExecute(call, state)` | After the method returns. | `call.result` is the method's return value. |
| `onCatch(call, state)` | When `preExecute`, the method, or `postExecute` throws. | `call.error` is that error. The return value is ignored. The original error is thrown again. |
| `onFinally(call, state)` | After a successful return or a caught failure. | `call.status` is `'success'` with `result`, or `'failure'` with `error`. |

`state` is `void` when `preExecute` is omitted. `onCatch` and `onFinally` receive `state` as `undefined` when `preExecute` was omitted or threw. State belongs to that invocation, so overlapping `execute` calls keep their own.

A throw inside `onCatch` replaces the error. `onFinally` still sees the original one, and then the new error propagates.

The method receives the caller's input, and the caller receives the method's return value. Record success in `postExecute` and the failure in `onCatch`. Finish a span in `onFinally`, which runs for both outcomes.
