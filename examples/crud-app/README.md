# CRUD example

Read these files in order:

1. `src/domain/incident.ts` — business rule: `incident.close(now)`
2. `src/ports.ts` — `IncidentRepository` is a TypeScript interface + token
3. `src/use-cases/close-incident.ts` — load → decide → save → publish → return
4. `src/create-app.ts` — composition root (`provide` / `bind` / `ctx`)
5. `src/main.ts` — **`start()` before handlers run**

Linger on `CloseIncident.execute`. It is the whole story.

## Publish after success

`publish(...)` **enqueues**. The runtime flushes the queue only if `execute` returns. A throw drops the queue.

## `start()`

Event use cases (`NotifyOnClose`) do **not** run until `app.start()`. `main.ts` starts the bus so the demo actually notifies.

## Context

`.ctx<AppContext>(defaultContext)` types `ctx` in execute. Tests can `app.as({ requestId: 'test' })`.
