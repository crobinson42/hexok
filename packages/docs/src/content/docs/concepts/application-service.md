---
title: Application service
description: Shared app-layer policy that is not I/O. Not a Hexok primitive.
---

An application service is shared policy that several [use cases](/hexok/concepts/use-case/) run, and that is not I/O. Hexok has no `Service()`. The application owns the class.

The [entity](/hexok/concepts/entity/) owns the rule. The service owns the script: load through a [port](/hexok/concepts/port/), run the rule, throw a catalog error. An [adapter](/hexok/concepts/adapter/) does not implement it.

```ts
class Membership {
  constructor(private readonly deps: { users: UserRepository }) {}

  async requireOrgMember(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const user = await this.deps.users.get(userId)
    if (user === null) throw DomainError.UserNotFound({ id: userId })
    user.requireMember(organizationId)
  }
}
```

`User.requireMember` is the domain rule. `Membership.requireOrgMember` loads the user and calls it. `UserRepository` is the port. A Redis adapter stores users. It does not decide membership.

## Why it exists

Save, publish, and unpublish all refuse a caller who is not a member of the post's organization. That check is one script. Putting it in each `execute` copies it. Putting it on a port lets an adapter skip the entity. The application service keeps the script in `app/` and the rule on the entity.

A use case is still one caller action. The service is not a use case. It has no token and no `execute`. Use cases that need it list it on `deps`.

## How it's used

Put the class under `app/services/`. Take ports on `deps`. Call entity methods. Throw catalog members. Do not import a database client, a queue, or a vendor SDK.

```ts
class SavePost extends ApiUseCase('post.save', { input: savePostInput }) {
  constructor(
    private readonly deps: {
      posts: PostRepository
      membership: Membership
      organizations: OrganizationRepository
    },
  ) {
    super()
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: SavePostInput,
  ): Promise<PostEntity> {
    await this.deps.membership.requireOrgMember(
      ctx.caller.userId,
      input.organizationId,
    )
    // …
  }
}
```

The composition root constructs the service with port adapters and passes it into each use case.

Tests construct the real service with in-memory ports. Do not stub `requireOrgMember`.

## What it is not

A [port](/hexok/concepts/port/) is a job with more than one implementation: memory, Redis, Resend. Membership policy has one correct implementation. `Port('Membership')` lets an adapter skip the entity.

It is not an adapter. Adapters live in `infra/` and implement ports.

It is not context. The per-call bag is facts such as `{ caller }`. A function on `ctx.auth` hides the user store behind the request.

Do not add `Service()` to hexok for this. The application already owns the class.
