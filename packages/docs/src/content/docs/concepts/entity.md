---
title: Entity
description: A schema-backed object with rules, change tracking, and a checked write path.
---

An entity is one thing your software stores and changes, such as a blog post. You pair a name with a schema, then add methods for the rules. Callers build an instance with `create`, `restore`, or `parse`, change it through those methods, and read the props back out when it is time to save.

```ts
class Post extends Entity('Post', PostSchema) {}
```

## Why it exists

A post has data and rules. The data is an id, a title, a body, and whether it is published. A rule says that publishing records `publishedAt`, and that a blank title is refused. The entity keeps both on one object.

The schema runs when the post is created from typed props, when unknown input is parsed, and again when a method writes. A failed write restores the previous props. The instance also remembers whether it is new and which fields changed, so a repository can save it without a second copy of those rules.

## How it's used

Publishing is a method. It refuses a blank title with a [catalog error](/hexok/concepts/error/), then updates the draft.

```ts
class Post extends Entity('Post', PostSchema) {
  publish(now: Date): this {
    if (this.props.title.trim() === '') throw BlogError.BlankTitle()
    return this.set((draft) => {
      draft.published = true
      draft.publishedAt = now
    })
  }
}

const post = Post.create({
  id: 'p1',
  title: 'Hello',
  body: 'First post',
  published: false,
})
post.publish(new Date())
await posts.save(post.toProps())
```

`create` checks the props and marks the post new. A repository loading a stored row uses `restore`, which keeps those props and treats the post as already saved. A request body is untyped, so the edge uses `parse`: the schema runs, and the post is treated as existing.

Read `props` for the current data. Write only through `set` or a method that calls it. `toProps()` is the frozen snapshot you persist or return from a use case.

## API

`Entity(token, schema)` returns the class you extend. `token` is a string literal. `schema` is a [Standard Schema](https://standardschema.dev) or a [Schema](/hexok/concepts/schema/) class.

Build instances with `create`, `restore`, or `parse`.

| Member | Role |
| --- | --- |
| `Post.token` | The name you passed in. |
| `Post.schema` | The Standard Schema used by `create`, `parse`, `set`, and `validate`. |
| `Post.create(props)` | Check `props` and return a new instance. `isNew` stays true until `commit`. |
| `Post.restore(props)` | Build an instance from stored props. The schema waits until `validate` or a writing `set`. `isNew` is false. |
| `Post.parse(value)` | Check an unknown value, then build an instance the way `restore` does. `isNew` is false. |
| `props` | The current data, typed read-only. Change it with `set`. |
| `set(draft => …)` | Copy-on-write edit. A write runs the schema. A failed check restores the previous props and throws. |
| `validate()` | Run the schema when this instance has not already passed. A passed instance returns itself. |
| `commit()` | Treat the current props as the saved original. `isNew` becomes false. |
| `isNew` | True after `create`, until `commit`. |
| `isValidated` | True after `create`, `parse`, a writing `set`, or `validate`. False after `restore` until one of those runs. |
| `original` | Props from before the first change on a restored instance. `undefined` while the instance is clean, and while a created instance has not been committed. |
| `isDirty()` | True when the post is new, or a shallow field differs from the saved original. |
| `getChangedKeys()` | Shallow keys that differ. `{ deep: true }` returns dotted paths. |
| `toProps()` | A deep-frozen snapshot for saving or returning. Reused until the next `set`. |
| `toJSON()` | The same snapshot as `toProps()`. |

A schema failure throws a [coded error](/hexok/concepts/error/coded/) with code `VALIDATION` and the message `hexok: Post validation failed`. A domain rule throws a member of your [error catalog](/hexok/concepts/error/).

`DeepReadonly<T>` is the type of `props`, `original`, and `toProps()`. `Date` values stay `Date`.
