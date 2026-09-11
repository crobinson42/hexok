---
title: Infrastructure
description: Adapters implement ports. Mappers convert entity to row at the trust boundary.
sidebar:
  order: 0
---

`hexok/infra` is thin. An adapter implements a port. A mapper converts entity ↔ row. Composition still receives the **impl**, not a factory object.

- [Adapter](/infrastructure/adapter/) — `Adapter.of(token, create)`
- [Mapper](/infrastructure/mapper/) — entity ↔ row
