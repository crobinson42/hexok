# @hexok/typebox

Adapt a [`typebox`](https://github.com/sinclairzx81/typebox) 1 schematic to a [Standard Schema](https://standardschema.dev) that `hexok` already accepts.

```bash
npm i hexok @hexok/typebox typebox
```

Zod, Valibot, ArkType, and any other Standard Schema library are passed to `hexok` directly. This package is only for `typebox` 1.

```ts
import Type from 'typebox'
import { typebox, typeboxDecode } from '@hexok/typebox'
import { Entity, Schema } from 'hexok'

const userSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
})

class UserSchema extends Schema('User', typebox(userSchema)) {}
class User extends Entity('User', typebox(userSchema)) {}
```

`typebox(schema)` checks with TypeBox `Check`. The inferred output is `Static` (the encode type), which is the value an entity, an event payload, and an `Errors` catalog payload hold.

`typeboxDecode(schema)` checks first, then runs TypeBox `Decode`. The inferred output is `StaticDecode`. Use it at a boundary where a codec turns a wire value into the in-memory value.

Keep the original `Type.Object(...)` value when you need the JSON Schema schematic. `Entity.schema` stores the Standard Schema wrapper.
