---
"kerf": minor
---

Error maps and `CodedError` no longer carry HTTP status. Use-case `deriveContract` is transport-neutral (`key`, `input`, `output`, `errors`). Runtime HTTP maps codes to status and derives `POST /rpc/...` paths.
