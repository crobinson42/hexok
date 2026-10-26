---
title: Company infrastructure
description: Logger, queue, broadcast, email, SMS, schedule, and quarantine packages that apps install beside hexok.
---

`hexok` stays the primitive kit. These packages are company drivers. An application installs the ones it uses. They are not dependencies of `hexok`.

Each package page is that package's README. The list is generated from the published workspaces, so a new package cannot ship without a page. See [Packages](/hexok/packages/).

Each adapter extends `Adapter` with its port. The composition root constructs it and passes it like any other adapter.
