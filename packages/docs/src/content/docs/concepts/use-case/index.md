---
title: UseCase
description: One thing a caller can do, with its ports in the constructor and the story in execute.
---

A use case is one thing a caller can do: publish a post, list posts, subscribe an email address. You name it with `UseCase` and write the story in `execute`. The ports it needs arrive through the constructor.

```ts
class PublishPost extends UseCase('post.publish') {}
```

When every call in a family carries the same extra context, such as a trace id, use [`UseCase.context`](/hexok/concepts/use-case/context/) instead. That page covers the context argument, guards, and hooks.

## Why it exists

Publishing a post is a story with a beginning and an end. Load the post, apply the publish rule, save it, and announce that it was published. The use case is that story in one place. Saving and announcing stay behind [ports](/hexok/concepts/port/), so the story reads the same when the database or the event transport changes. A refusal throws an [error catalog](/hexok/concepts/error/) member. Your application catches it at the edge.

## How it's used

`PublishPost` receives the repository and the event publisher. `execute` is the story. Callers see the input and return types you annotate.

```ts
class PublishPost extends UseCase('post.publish') {
  constructor(
    private readonly deps: {
      posts: PostRepository
      events: BlogEventPublisher
    },
  ) {
    super()
  }

  async execute(input: { id: string }): Promise<{ id: string }> {
    const post = await this.deps.posts.get(input.id)
    post.publish(new Date())
    await this.deps.posts.save(post)
    await this.deps.events.publish(new PostPublished(post.toProps()))
    return { id: post.props.id }
  }
}
```

The application constructs `PublishPost` with concrete adapters, `new PublishPost({ posts, events })`, and calls `execute` from a gateway. You choose the HTTP library and assemble that object graph.

Pass every port on `deps`, including a use case with one port. Put the core port first in the type. Call them through `this.deps`. Optional flags chosen for that long-lived instance are a second argument, `config`. A value the caller sends on one request stays on the input to `execute`. A value declared for a whole context family stays on that factory's static spec. Mark both objects `readonly`.

## API

`UseCase(token)` returns the class you extend. `token` is a string literal, such as `'post.publish'`.

| Member | Role |
| --- | --- |
| `PublishPost.token` | The name you passed in. |
| `execute(input)` | Required. Annotate the input and the return type on the subclass. Callers of that class see those types. |
| `constructor` | Ports arrive on `deps`. Optional instance settings arrive on `config`. Call `super()`. |

Declare `execute` as a method. The class is incomplete until you do, and the compiler reports the missing method.

`execute` receives the input you declare and returns what you declare. Checking that input is the application's job: a guard on a [context family](/hexok/concepts/use-case/context/), or the first lines of `execute`. A refusal inside the method throws a catalog member.

Per-call context, guards, and hooks live on the factory from [`UseCase.context`](/hexok/concepts/use-case/context/). Members of that family extend the factory.
