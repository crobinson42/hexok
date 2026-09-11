---
title: Testing
description: Same completeness as App.from, plus published capture and in-memory fakes.
sidebar:
  order: 0
---

`hexok/testing` is test-only: `App.test` plus in-memory fakes. Completeness is the same as production. `published` captures envelopes after `aroundPublish`.

- [App.test](/testing/app-test/) — `published` and `as(ctx)`
- [InMemoryRepository](/testing/in-memory-repository/) — CRUD fake
- [InMemoryBus](/testing/in-memory-bus/) — in-process bus
- [InMemoryQueue](/testing/in-memory-queue/) — in-process queue
- [InMemoryChannel](/testing/in-memory-channel/) — in-process channel adapter
