# Build performance

Notes on why the Vercel build is shaped the way it is, so the tuning below is not
accidentally undone. Baseline measurements come from commit `dd30b81a7` (2026-07-23),
on the Hobby builder Vercel reports as **2 cores, 8 GB**:

| Project | Duration |
| --- | --- |
| `aglyn-console` | 20m 57s |
| `aglyn-tenant` | 9m 23s |
| `aglyn-docs` | 0m 25s |

## Next app builds must not depend on `^build` (AGL-738)

`nx.json` sets `dependsOn: []` on the `@nx/next:build` target default. **This is deliberate.**
Restoring `["^build"]` re-adds roughly four fifths of the build.

Every `@aglyn/*` alias in `tsconfig.base.json` — and in the generated per-app
`tsconfig.next.json` files — resolves to library **source** (`src/index.ts`), never to
`dist/`. Next.js compiles that source with its own SWC pipeline as part of the app build,
which is the same thing `transpilePackages` would buy us; the tsconfig paths already
achieve it. So the 41-task dependency phase was building `dist/libs/**` that the app build
then never opened.

Measured locally, clean tree, `--skip-nx-cache`:

| | Wall | CPU |
| --- | --- | --- |
| `nx build console --prod` with the dependency phase | 2m 55.8s | 551.8s |
| `nx build console --prod` without it | **0m 38.6s** | 108.0s |

Verified rather than assumed:

* With `dist/` deleted and never regenerated, both `console` and `tenant` build successfully —
  proof the artifacts were unused, not merely redundant.
* The console's route table is byte-identical across the two builds (60 routes).
* Nothing in `dist/apps/**` references `dist/libs`.
* `grep -rn 'dist/libs'` across the repo finds only `outputPath` declarations — no consumer.

`inputs` still includes `^production`, so a change to any library source still invalidates the
app build cache. Dropping the *dependency* did not drop the *dependency tracking*.

Libraries are still buildable on demand for the npm publish path
(`tools/scripts/publish.mjs`, which runs against `dist/libs/**`):

```bash
npx nx run-many -t build --exclude='console,tenant,docs,www'
```

## `parallel` is 3, not 1 (AGL-735)

`nx.json` had `"parallel": 1`, so library builds ran strictly one at a time and one of the
builder's two cores idled through the whole dependency phase. At 3, a full `run-many` over all
44 buildable projects measures 75s wall against 211s CPU — about 2.8x overlap, no memory
pressure.

This matters much less now that app builds skip the dependency phase, but it still applies to
`run-many`, to `nx affected` in local work, and to the publish path.

Two consequences worth knowing:

* Log output interleaves. When reading a failed build, match each error to the `> nx run <project>`
  line above it rather than assuming the nearest one.
* Do not raise this much further without measuring. These are Rollup and SWC processes and 8 GB
  is not much; the app build already OOM-killed once under webpack (AGL-563).

## Unresolved imports fail the build (AGL-739)

`tools/rollup-skip-typecheck.js` downgrades TypeScript diagnostics to warnings, because the
`@nx/rollup:rollup` executor sets `rootDir` to the project directory on Vercel and floods the log
with TS6059 (see the header comment in that file). **`TS2307` is exempt and stays fatal.**

TS2307 means an import did not resolve at all, so everything downstream of it widens to `any` —
which then hides whatever real type errors that module was catching. `shared-ui-theme` shipped 13
such diagnostics on every green build until AGL-739; the cause was a stale local `paths` override
in its `tsconfig.lib.json`, mapping a library (`@aglyn/shared-util-guards`) that no longer exists.

Libraries should **not** declare their own `compilerOptions.paths`. `tsconfig.base.json` is the
single source of truth; a local override re-anchors resolution and the rollup executor then
resolves the entries against the workspace root rather than the tsconfig that declared them.

Type-level diagnostics (TS2339, TS2488, …) remain warnings here. `npm run typecheck` is the gate
for those.

## `@nx/rollup:rollup` is deprecated (AGL-737)

22 libraries still use it and it is removed in Nx v24. That migration is deliberately deferred to
the Nx upgrade rather than done here: with app builds no longer running the dependency phase, the
executor is off the deploy critical path, and migrating it now would mean re-validating 22 bundle
outputs for a saving that no longer lands on any deploy.
