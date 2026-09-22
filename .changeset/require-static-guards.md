---
"hexok": major
---

Require `static readonly guards` on every ExternalUseCase. Empty `[] as const` is public; omitting the field is a compile-time and runtime error. Guards run before input validation and interceptors.

`ExecuteCtx` and `EventCtx` take one type argument. `ctx` is no longer overridden by a second generic.

`Guard.allow` may return the next ctx for the call (`void` leaves it unchanged). A replacement is visible to later guards, `execute`, and nested `run`; it does not mutate the `.ctx()` default.

`declare static context` must be mutually assignable with the last branded `OutCtx`. A mismatch types `ExecuteCtx['ctx']` as a `hexok:` string.

`.ctx<C>()` is inbound. At `build`, `C` must be assignable to each branded guard `InCtx` or `build` is a `hexok:` sentence (same mechanism as missing ports). Unbranded guards do not force `.ctx()`.
