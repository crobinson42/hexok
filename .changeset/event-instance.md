---
"hexok": minor
---

Add `EventInstance<typeof Catalog>` for the event objects in a catalog. Each instance carries its token. `Catalog.message` and `Catalog.parse` convert between an instance and `EventMessage`. `EventHandler` binds a handler class to one event.
