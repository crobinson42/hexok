---
title: Mapper
description: Translates the value a port speaks into the document an adapter stores, and back.
---

A mapper translates the value a [port](/hexok/concepts/port/) speaks into the document an [adapter](/hexok/concepts/adapter/) stores, and back. You name it with `Mapper`, pass the source the port speaks, and pass the schema of the stored document. The adapter calls `toModel` and `fromModel`.

```ts
class MongoPost extends Mapper('mongo.Post', Post, mongoPostSchema) {}
```

## Why it exists

`PostRepository` speaks in `Post`. A Mongo document for that same post uses `_id` where the entity uses `id`. The mapper keeps that translation inside the database adapter, so `execute` still calls `posts.save(post)`.

The mapper is stateless. The adapter calls `commit()` on the post after the driver write succeeds. Persisting `toProps()` as JSON needs no mapper, so the in-memory adapter on the [Adapter](/hexok/concepts/adapter/) page stores the `Post` itself.

## How it's used

The post is an id, a title, a body, and a published flag. `fromSource` builds the document. `toSource` builds the props the entity restores from.

```ts
type MongoPostDoc = {
  _id: string
  title: string
  body: string
  published: boolean
}

class MongoPost extends Mapper('mongo.Post', Post, mongoPostSchema) {
  protected override fromSource(post: Post) {
    const props = post.toProps()
    return {
      _id: props.id,
      title: props.title,
      body: props.body,
      published: props.published,
    }
  }

  protected override toSource(doc: MongoPostDoc) {
    return {
      id: doc._id,
      title: doc.title,
      body: doc.body,
      published: doc.published,
    }
  }
}
```

The database adapter owns the mapper and the driver collection. `save` writes the document, then commits the post. `get` loads the document and returns the post.

```ts
class MongoPosts extends Adapter(PostRepository) {
  constructor(
    private readonly posts: MongoPost,
    private readonly collection: PostCollection,
  ) {
    super()
  }

  override async get(id: string): Promise<Post> {
    const doc = await this.collection.findOne({ _id: id })
    if (doc === null) throw BlogError.PostMissing()
    return this.posts.fromModel(doc)
  }

  override async save(post: Post): Promise<void> {
    const doc = this.posts.toModel(post)
    await this.collection.updateOne(
      { _id: doc._id },
      { $set: doc },
      { upsert: true },
    )
    post.commit()
  }
}
```

The source argument may be an Entity class, a Schema class, or a raw Standard Schema. Checks stay off unless the factory or that call passes `{ validate: true }`, and a call overrides the factory. With checks off, `toModel` returns the `fromSource` draft and `fromModel` restores the entity. With checks on, both directions run the stored schema, and an entity load uses `parse`. A stored-schema failure throws a [coded error](/hexok/concepts/error/coded/) with code `VALIDATION` and the mapper token. An entity parse failure uses the entity token.

## API

`Mapper(token, source, storedSchema, options?)` returns the class you extend. `token` is a string literal. `source` is the entity, Schema class, or Standard Schema the port speaks. `storedSchema` is the document shape. `options` is `{ validate?: boolean }`.

| Member | Role |
| --- | --- |
| `fromSource(source)` | Protected. Required. An entity source receives the instance. A schema source receives its output. Return the stored draft. |
| `toSource(model)` | Protected. Required. Receives the stored output. Return entity props, or the source schema's output. |
| `toModel(source, options?)` | Public. The adapter calls this. The method is already implemented. |
| `fromModel(value, options?)` | Public. The adapter calls this. The method is already implemented. |
| `token` | The name passed to `Mapper`. |
| `schema` | The stored Standard Schema. A Schema class is stored as its definition. |
| `source` | The entity, Schema class, or Standard Schema this mapper reads and builds. |

Subclasses extend `Mapper(...)`. The constructor stays public. `MapperClass` is exported so an exported subclass can keep `fromSource` and `toSource` protected.
