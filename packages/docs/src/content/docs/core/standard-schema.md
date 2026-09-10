---
title: Standard Schema
description: Schema protocol. Domain validation is binary — issues collapse to VALIDATION.
sidebar:
  order: 4
---

Plinth uses [Standard Schema V1](https://standardschema.dev/). Zod (and other libraries that implement `~standard`) work as `input` / `output` / entity `schema`.

`validate` is **sync only**. Issues collapse to `'VALIDATION'` — the domain trust boundary is binary. Async schemas belong at the RPC boundary and throw.

```ts
const parsed = validate(Incident.schema, body)
if (!parsed.ok) return parsed
```

`Infer<S>` is the schema output type.

See also: [Entity](/domain/entity/), [Mapper](/infrastructure/mapper/).
