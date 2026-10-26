# @hexok/docs

Hexok documentation site (Astro + Starlight).

`hexok` concept pages are written under `src/content/docs/concepts/`. Every other published package page is generated from that package's `README.md` when `dev` or `build` runs.

Published at [crobinson42.github.io/hexok](https://crobinson42.github.io/hexok/) when `hexok` is published to npm.

```bash
npm run dev -w @hexok/docs
```

The site is served under `/hexok` (GitHub Pages project path), including locally: http://localhost:4321/hexok/. Root-relative links in Markdown must include that prefix, e.g. `[Entity](/hexok/api/domain/entity/)`.
