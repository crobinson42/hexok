# AGENTS.md

Hexok is a TypeScript kit for hexagonal software. This file is for agents working on this repository. The agent skill for building apps with hexok is in `packages/hexok/skills/hexok/`.

## Layout

npm workspaces with Turbo. Node 24 (`.nvmrc`), ESM only.

- `packages/hexok`: the core primitives (`Schema`, `Entity`, `Port`, `Adapter`, `Mapper`, `UseCase`, `Event`, `EventCatalog`, `EventHandler`, `Errors`, `Result`). Published as `hexok`.
- `packages/<capability>`: a port package, such as `queue`, `broadcast`, `email`, `sms`, `logger`, `quarantine`, or `schedule-coordinator`. Published as `@hexok/<capability>`.
- `packages/<capability>-<vendor>`: the adapter for that port, such as `queue-redis` or `email-resend`.
- `packages/typebox`: TypeBox to Standard Schema.
- `packages/docs`: the Astro Starlight site at crobinson42.github.io/hexok. Private.
- `examples/app-template`: a blog API with HTTP, worker, and websocket processes on Redis. Private.
- `examples/extend`: small overrides of primitives. Private.

**Remember**: Code quality is not negotiable. Clear, maintainable code enables rapid development and confident refactoring.

## Commands

Run from the repository root.

```bash
npm ci
npm run lint         # biome check
npm run type-check
npm run test         # vitest
npm run build        # tsc -b
```

Scope a task to one workspace and its dependencies with a Turbo filter:

```bash
npx turbo run test --filter=hexok
npx turbo run type-check --filter=@hexok/queue-redis
```

`test` and `type-check` depend on `^build`. Running `vitest` inside a package without Turbo uses whatever `dist` its dependencies last built.

Format and fix with `npx biome check --write .`.

The docs site runs with `npm run dev --workspace=@hexok/docs`.

## Before you finish

CI runs `lint`, `type-check`, `test`, and `build` in that order. Run all four.

Files named `*.integration.test.ts` need Redis. They skip when `REDIS_URL` is unset, and they throw when `CI` is set without it. Run them locally with:

```bash
docker run --rm -p 6379:6379 redis:7.2
REDIS_URL=redis://127.0.0.1:6379 npm run test
```

## Code

- Biome formats and lints. Single quotes, semicolons, trailing commas, two spaces.
- `tsconfig.base.json` sets `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`. Import types with `type`. Relative imports end in `.js`.
- Tests sit next to the source as `src/**/*.test.ts`. Each package builds from `src` and excludes tests from `dist`.
- A package's public API is its `src/index.ts`.

## Adding a package

Copy the `package.json` scripts, `tsconfig.json`, `tsconfig.check.json`, and `vitest.config.ts` from a sibling package. Add the package to the `references` in the root `tsconfig.json`. A package that will publish needs a changeset.

## Changesets

Every change to a published package needs a changeset in `.changeset/`. Examples and docs are ignored and need none.

```md
---
"hexok": minor
---

`EventHandler` instances carry `token` and `event`, the same values as the statics.
```

The Release workflow opens the "Version Packages" pull request and publishes to npm. Do not run `version-packages` or `release` by hand.

## Keeping things in step

A change to a hexok primitive's public behavior usually touches more than `src`:

- the primitive table and examples in the root `README.md`
- the concept page under `packages/docs/src/content/docs/concepts/`
- the skill reference under `packages/hexok/skills/hexok/references/`
- `examples/app-template` when it uses that primitive

The skill ships inside the `hexok` npm package (`files` includes `skills`), so a stale reference reaches users.

## Commits

Conventional commits. The scope is the package name without `@hexok/`, or `examples`.

```
feat(queue-redis): add explicit stream maintenance
fix: keep branded primitives in DeepReadonly
docs: document the company infrastructure packages
```

Use `feat`, `fix`, `docs`, `ci`, `chore`, and `style`.

## Writing

Docs, READMEs, and the skill use short, plain, declarative sentences. Say what the code does. Match that voice.