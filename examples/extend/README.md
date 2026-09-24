# Overrides

Two small overrides of hexok primitives.

`TrimmedName` overrides `Schema.parse` to trim a string before the schema runs. `FixedClock` overrides `Adapter.start` and refuses to answer until the application has started it.
