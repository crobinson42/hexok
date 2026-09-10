---
title: Core
description: Result, error maps, and Standard Schema — the primitives every other package uses.
sidebar:
  order: 0
---

`@plinth/core` is small on purpose. Domain methods return a `Result`. Use cases throw a `CodedError` whose keys come from an `ErrorMap`. Schemas follow Standard Schema V1.

- [Result](/core/result/) — success-or-code
- [CodedError](/core/coded-error/) — thrown at the use-case edge
- [Error map](/core/error-map/) — keys **are** the error union
- [Standard Schema](/core/standard-schema/) — `validate` and `Infer`
