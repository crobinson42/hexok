---
title: Core
description: Result, error maps, and Standard Schema — the primitives every other layer uses.
sidebar:
  order: 0
---

`plinth/core` is small on purpose. Entities throw a `CodedError`. `validate` returns a `Result`. Use cases throw a `CodedError` whose keys come from an `ErrorMap`. Schemas follow Standard Schema V1.

- [Result](/core/result/) — success-or-code from `validate` / custom flows
- [CodedError](/core/coded-error/) — thrown by entities and use cases
- [Error map](/core/error-map/) — keys **are** the error union
- [Standard Schema](/core/standard-schema/) — `validate` and `Infer`
