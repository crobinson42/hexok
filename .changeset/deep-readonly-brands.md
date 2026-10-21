---
"hexok": patch
---

`DeepReadonly` leaves branded primitives alone, so `z.string().brand()` stays that brand on `props`, `original`, and `toProps()`.
