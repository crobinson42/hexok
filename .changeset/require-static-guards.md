---
"hexok": major
---

Require `static readonly guards` on every ExternalUseCase. Empty `[] as const` is public; omitting the field is a compile-time and runtime error. Guards run before input validation and interceptors.
