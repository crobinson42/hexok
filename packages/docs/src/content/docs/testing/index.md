---
title: Testing
description: Same completeness as App.from, plus published capture and in-memory fakes.
sidebar:
  order: 0
---

`plinth/testing` is test-only: `App.test` plus in-memory fakes. Completeness is the same as production. `published` captures envelopes after `aroundPublish`.

- [App.test](/testing/app-test/) — `published` and `as(ctx)`
- [InMemoryRepository](/testing/in-memory-repository/) — CRUD fake
- [InMemoryBus](/testing/in-memory-bus/) — in-process bus
- [InMemoryBroker](/testing/in-memory-broker/) — in-process broker
