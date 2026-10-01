# UseCase

A use case is one thing a caller can do: publish a post, save a draft, subscribe an email address. Name it with `UseCase` and write the story in `execute`. The ports it needs arrive through the constructor.

```ts
class PublishPost extends UseCase('post.publish') {}
```

When every call in a family carries the same extra context, such as a trace id or the caller IP, use `UseCase.context` below. Plain `UseCase(token)` has `execute(input)` and never wraps that method.

## Why it exists

Publishing a post is a story with a beginning and an end. Load the post, apply the publish rule, save it, and announce that it was published. The use case is that story in one place. Saving and announcing stay behind ports, so the story reads the same when the database or the event transport changes. A refusal throws an error-catalog member. The application catches it at the edge.

## How to use it

`PublishPost` receives the repository and the event publisher. `execute` is the story. Callers see the input and return types you annotate.

```ts
class PublishPost extends UseCase('post.publish') {
  constructor(
    private readonly posts: PostRepository,
    private readonly events: BlogEventPublisher,
  ) {
    super();
  }

  async execute(input: { id: string }): Promise<{ id: string }> {
    const post = await this.posts.get(input.id);
    post.publish(new Date());
    await this.posts.save(post);
    await this.events.publish(new PostPublished(post.toProps()));
    return { id: post.props.id };
  }
}
```

The application constructs `PublishPost` with concrete adapters and calls `execute` from a gateway. One action is one class and one token. A caller who can save a draft and later publish it gets `SavePost` (`post.save`) and `PublishPost` (`post.publish`).

Declare `execute` as a method. A class field, or an assignment after `super()`, is the wrong shape. The class is incomplete until `execute` exists, and the compiler reports the missing method.

`execute` receives the input you declare and returns what you declare. Checking that input is the application's job: a guard on a context family, or the first lines of `execute`. Hexok does not validate `execute` and does not read a static key named `input`.

## API

`UseCase(token)` returns the class you extend. `token` is a string literal, such as `'post.publish'`.

| Member | Role |
| --- | --- |
| `PublishPost.token` | The name you passed in. |
| `execute(input)` | Required. Annotate the input and the return type on the subclass. |
| `constructor` | Receive ports here and call `super()`. |

A subclass of plain `UseCase(token)` takes one argument. Adding a context argument there is a type error. Reach for the family factory instead.

## UseCase.context

`UseCase.context` builds a family of use cases that share one kind of call. Every member receives a context argument. The family can refuse a call in a guard or observe it with hooks. Each member still has its own token, its own ports, and its own `execute`.

Use it when the call carries something the story should see, such as a trace id or the actor who published the post. Putting that bag on `execute` as a first argument keeps it out of the post payload. The use case instance stays long-lived. The gateway builds a new context per request.

```ts
type ApiContext = { traceId: string };

const ApiUseCase = UseCase.context<ApiContext>().guard((call) => {
  if (call.ctx.traceId.length < 1) throw BlogError.TraceIdMissing();
});

class PublishPost extends ApiUseCase('post.publish') {
  constructor(
    private readonly posts: PostRepository,
    private readonly events: BlogEventPublisher,
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: { id: string },
  ): Promise<{ id: string }> {
    const post = await this.posts.get(input.id);
    post.publish(new Date());
    await this.posts.save(post);
    await this.events.publish(new PostPublished(post.toProps()));
    return { id: post.props.id };
  }
}

await new PublishPost(posts, events).execute({ traceId: 'req-1' }, { id: 'p1' });
```

A member that needs a static contract, such as a permission string or an input schema the application will read, declares that contract as the second type argument. The schema is data the guard can read. Validating the input stays in the guard or in `execute`.

```ts
const ActorUseCase = UseCase.context<
  { traceId: string; actorId: string },
  { permission: string }
>().guard((call) => {
  if (call.spec.permission.length < 1) throw BlogError.Forbidden();
});

class PublishPost extends ActorUseCase('post.publish', {
  permission: 'posts.publish',
}) {
  async execute(
    ctx: UseCase.Ctx<typeof ActorUseCase>,
    input: { id: string },
  ): Promise<{ id: string }> {
    return { id: input.id };
  }
}
```

### Factory

`UseCase.context<Ctx, Spec>(config?)` returns a factory. `Ctx` is required. Omitting it makes the return type the string `'Pass a type argument: UseCase.context<Ctx>()'`. `Spec` defaults to an empty contract, so a member is `Factory(token)` only.

`config` accepts no keys yet. Call `UseCase.context<Ctx>()` or `UseCase.context<Ctx>({})`. `guard` and `hooks` are methods on the factory, not fields of that object.

`.guard(fn)` and `.hooks(def)` each return the factory again, so the calls can sit in either order and either one can be left off. A further `.guard()` runs after guards already registered. A second `.hooks()` that includes at least one callback throws `hexok: UseCase hooks are already set` when the factory is created. An empty `.hooks({})` adds no callbacks and does not wrap `execute`.

When `Spec` has keys, the member is `Factory(token, statics)` and the bag has to satisfy `Spec`. Those entries are copied onto the class as statics. Literals stay narrow. The names `token`, `prototype`, `name`, and `length` stay on the class. Passing one of them is a type error.

`execute` is still required. Annotate `ctx` and `input` on the subclass. A member with no input omits the second parameter. Declare `execute` as a method. Assigning it as a class field, or replacing it after `super()`, skips the guard and the hooks.

When the family has no guard and no hooks, `execute` stays unwrapped so a missing method is still a class-site error.

`UseCase.Ctx<typeof ApiUseCase>` is the context type. Pass the factory from `UseCase.context`. A subclass, and a plain `UseCase(token)` class, resolve to `never`. Annotate member `execute` parameters with it. A guard passed into the factory names `ctx` and `spec` from the application's own types. A function passed into the factory must not mention `UseCase.Ctx` or `UseCase.GuardParameters` of that still-inferred factory.

### The call

A guard and `preExecute` receive `{ ctx, spec, token, input }`.

| Field | Meaning |
| --- | --- |
| `ctx` | The context the caller passed. |
| `spec` | The static contract, typed as `Spec`. A guard sees `permission: string` even when one member passed the literal `'posts.publish'`. |
| `token` | This member's token. |
| `input` | The second argument the caller passed to `execute`. Typed `unknown`. The method receives that same value. |

`UseCase.GuardParameters<typeof ApiUseCase>` is that call. `UseCase.Ctx<typeof ApiUseCase>` is `ctx`.

Family hook `input` stays `unknown` on purpose. One factory hook is checked against every member. `SavePost` and `SubscribeToPosts` do not share an input type. Member annotations are what callers of that class see. Read `ctx` and `spec` in a family hook. Input-field logic belongs on `execute` or in a guard that already knows the member.

### Guards

A guard is `(call) => void | Promise<void>`. Guards run before `execute`, and outside the hook `try`. A throw from a guard skips `preExecute`, `postExecute`, `onCatch`, and `onFinally`. A zero-argument guard typechecks. A one-argument guard receives the call, not the bare context.

### Hooks

`.hooks(definition)` registers one set of callbacks for the family. `State` is inferred from `preExecute`'s return. It is `void` when `preExecute` is omitted. Later hooks receive `Awaited<State>`. `onCatch` and `onFinally` receive `Awaited<State> | undefined` because `preExecute` may have thrown or been omitted.

| Hook | When it runs | Extra fields |
| --- | --- | --- |
| `preExecute(call)` | After the guards, before the method. | Its return value is `state` for the later hooks. |
| `postExecute(call, state)` | After the method returns. | `call.result` is the method's return value. |
| `onCatch(call, state)` | When `preExecute`, the method, or `postExecute` throws. | `call.error` is that error. The return value is ignored. The original error is thrown again. |
| `onFinally(call, state)` | After a successful return or a caught failure. | `call.status` is `'success'` with `result`, or `'failure'` with `error`. |

The pipeline is: guards, then `preExecute`, then the method with the caller's argument, then `postExecute`, then `onCatch` which rethrows, then `onFinally`. `postExecute` runs only after `preExecute` returns. `onFinally` always runs for attempts that entered the hooks. State is local to that invocation. Overlapping `execute` calls do not share it.

The method receives the caller's input, and the caller receives the method's return value. Hooks do not replace either one. Record success in `postExecute` and the failure in `onCatch`. Finish a span in `onFinally`, which runs for both outcomes. A throw inside `onCatch` replaces the error after `onFinally` has seen the original one.

There is no `around` hook. Leave `AsyncLocalStorage` to the application.
