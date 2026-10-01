# Mapper

A mapper translates the value a port speaks into the document an adapter stores, and back. Use one when those shapes differ: `_id` instead of `id`, a GeoJSON point instead of a `[lat, lng]` pair, a driver row instead of entity props. Persisting `toProps()` as JSON needs no mapper.

The mapper is stateless. Domain code does not import the stored schema. The adapter owns the mapper and calls it. The adapter commits the entity after the driver write succeeds. The mapper does not commit.

```ts
class MongoUser extends Mapper('mongo.User', User, mongoUserSchema) {
  protected fromSource(user: User) {
    const props = user.toProps();
    const [lat, lng] = props.location;
    return {
      _id: props.id,
      name: props.name,
      location: { type: 'Point' as const, coordinates: [lng, lat] },
    };
  }

  protected toSource(doc: { _id: string; name: string; location: { coordinates: [number, number] } }) {
    const [lng, lat] = doc.location.coordinates;
    return { id: doc._id, name: doc.name, location: [lat, lng] };
  }
}
```

Extend `Mapper(...)`, not `MapperClass`. Export a named class. An anonymous class expression cannot emit the protected methods.

## Why it exists

The domain port stays in domain types. Each adapter has its own stored shape. One mapper keeps that translation next to the adapter, so `execute` still calls `posts.save(post)` and never sees `_id` or coordinate order.

## How to use it

`fromSource` feeds `toModel`. `toSource` feeds `fromModel`. The adapter calls the public pair.

```ts
class MongoUsers extends Adapter(UserRepository) {
  constructor(private readonly users: MongoUser) {
    super();
  }

  override async save(user: User): Promise<void> {
    const doc = this.users.toModel(user);
    await this.collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    user.commit();
  }

  override async get(id: string): Promise<User | null> {
    const doc = await this.collection.findOne({ _id: id });
    if (doc === null) return null;
    return this.users.fromModel(doc);
  }
}
```

The source argument is an Entity class, a Schema class, or a raw Standard Schema. The same primitive covers a schema or a plain object, not only an entity.

Checks are off unless the factory or that call passes `{ validate: true }`. A call overrides the factory.

- Off: `toModel` returns the `fromSource` draft unchecked. `fromModel` uses `Entity.restore` or returns a schema draft as given, so `isValidated` stays false.
- On: both directions run the stored schema. An entity load uses `parse`. A stored-schema failure throws `CodedError` `VALIDATION` with the mapper token. An entity parse failure uses the entity token.

## API

`Mapper(token, source, storedSchema, options?)` returns the class you extend. `token` is a string literal. `options` is `{ validate?: boolean }`.

| Member | Role |
| --- | --- |
| `fromSource(source)` | Protected. Required. Entity source receives the instance. A schema source receives its output. Return the stored draft. |
| `toSource(model)` | Protected. Required. Receives the stored output. Return entity props, or the source schema's output. |
| `toModel(source, options?)` | Public. Adapters call this. Do not override. |
| `fromModel(value, options?)` | Public. Adapters call this. Do not override. |
| `token` | The name passed to `Mapper`. |
| `schema` | The stored Standard Schema. A Schema class is stored as its definition. |
| `source` | The entity, Schema class, or Standard Schema this mapper reads and builds. |

`MapperClass` is exported so an exported subclass's `.d.ts` can name the base and keep `fromSource` and `toSource` protected. A protected constructor on the subclass makes `new Subclass()` a type error. Leave the constructor public.
