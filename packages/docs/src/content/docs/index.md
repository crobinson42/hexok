---
title: Kerf
description: A TypeScript kit for writing a clean-architecture backend as ordinary classes.
---

Kerf is a TypeScript kit for a clean-architecture backend as **ordinary classes**: Entity, Port, Adapter, UseCase, Event, Interceptor.

Install one package and import a layer: `kerf/core`, `kerf/domain`, `kerf/app`, `kerf/infra`, `kerf/runtime`, `kerf/testing`.

A new hire should open a use-case file and understand the business flow without a glossary of hidden methods, phantom fields, or `meta` bags.

The entity owns the rule (`incident.close(now)`). The use case orchestrates.

## Concerns

- [Core](/core/) — `Result`, error maps, Standard Schema
- [Domain](/domain/) — entities, ports, events, catalogs
- [Application](/application/) — use cases, contracts, publish
- [Infrastructure](/infrastructure/) — adapters and mappers
- [Runtime](/runtime/) — `App.from`, interceptors, HTTP, local client
- [Testing](/testing/) — `App.test` and in-memory fakes
- [Extend](/extend/) — copy-paste interceptors
