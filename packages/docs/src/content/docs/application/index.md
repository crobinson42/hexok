---
title: Application
description: Use cases orchestrate. They declare key, schema, errors, ports, and publishes.
sidebar:
  order: 0
---

`plinth/app` is the use-case layer. An `ApiUseCase` is a request/response use case. An `EventUseCase` handles a catalog event. Both are ordinary classes with typed statics.

The entity owns the rule. The use case loads, calls the entity, saves, publishes, and returns.

- [ApiUseCase](/application/api-use-case/) — request/response
- [EventUseCase](/application/event-use-case/) — event handler
- [ExecuteCtx](/application/execute-ctx/) — typed `execute` argument
- [Error factories](/application/error-factories/) — `errors.NOT_FOUND()`
- [unwrap](/application/unwrap/) — Result → value or throw
- [Publish after success](/application/publish-after-success/) — enqueue, flush on return
- [Derived contract](/application/derived-contract/) — key, input, output, errors
