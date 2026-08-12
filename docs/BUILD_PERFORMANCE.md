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

## Every library builds on `@nx/js:swc` (AGL-737)

There is no `@nx/rollup:rollup` target left in the workspace. 22 libraries moved to `@nx/js:swc`,
joining the 21 already on it; `shared-svg-icons` stays on Vite because it compiles `.svg` imports.

Same 44 projects, same machine, `parallel: 3`, `--skip-nx-cache`:

| Executor | Wall | CPU |
| --- | --- | --- |
| `@nx/rollup:rollup` | 2m 21.8s | 459.0s |
| `@nx/js:swc` | **1m 5.5s** | 228.2s |

Three helper scripts went with it — `tools/rollup-external-packages.js`,
`tools/rollup-suppress-use-client.js` and `tools/rollup-skip-typecheck.js`. All three existed to
work around Rollup-specific breakage, and `'use client'` directives now survive into the output
instead of being stripped and warned about.

The migration is worth understanding, because almost none of the work was the executor swap.

### Stale config, not incompatibility

Switching executors surfaced 32 "type errors" in `shared-ui-jsx` — `theme.palette.tertiary` and
`theme.shape.appIconBorderRadius` not existing, i.e. the MUI module augmentation in
`libs/shared/ui/theme/src/vendor/mui.ts` not being in scope. That reads like a real cross-library
augmentation problem. It was not. Every one of them was downstream of a single unresolved import.

`@nx/js:swc` writes `types` into the generated `dist` package.json with `??=`, so a `types` field
in the **source** `package.json` wins. Three libraries — `shared-ui-theme`, `shared-ui-jsx`,
`shared-ui-next` — hardcoded `"types": "./libs/shared/ui/<name>/src/index.d.ts"`, a path that does
not exist inside the output directory. Consumers therefore could not resolve the library at all,
every imported type widened to `any`, and the augmentation errors followed. Deleting those three
fields — nx computes the correct `./src/index.d.ts` — took all 32 errors with them.

Two related cleanups landed in the same pass:

* **`rootDir` removed from 10 `tsconfig.lib.json` files**, where it pointed at the workspace root.
  This is what made the Rollup TypeScript plugin emit `.d.ts` paths starting with `..`, which
  `rollup-skip-typecheck.js` had to intercept to avoid a fatal Rollup error.
* **Asset globs normalized** to the string form (`libs/<path>/*.md`) rather than the object form
  anchored at the workspace root, which was reproducing the full source path inside `dist`.

Do not add `compilerOptions.paths`, `compilerOptions.rootDir`, or a `types` field to a library.
`tsconfig.base.json` and the executor own those. Every build problem in this document traced back
to a local override of something that already had a correct workspace-level answer.

## Unresolved imports fail the build (AGL-739)

Under Rollup this needed enforcing by hand: `skipTypeCheck: true` plus a patch script downgraded
every TypeScript diagnostic to a warning, so `shared-ui-theme` printed 13 of them — including
TS2307, "Cannot find module" — on every green build. The cause was a stale local `paths` override
in its `tsconfig.lib.json` mapping `@aglyn/shared-util-guards`, a library that no longer exists.

`@nx/js:swc` runs a real `tsc` for declaration emit, so **any** type error now fails the build.
That is strictly stronger than the TS2307-only rule the Rollup path was given, and it is why the
patch script could be deleted rather than kept.

`npm run typecheck` (135/135) remains the repo-wide gate and covers configurations the build does
not, such as the spec tsconfigs.

## The console's 41-library graph is justified (AGL-740)

Audited rather than pruned. Counting import sites across the console's 320 source files, all 35
direct dependencies are genuinely used and none is present in the graph without one:

| | Libraries | Shape |
| --- | --- | --- |
| Static imports | 22 | `@aglyn/aglyn` alone is 172 sites across 140 files; `shared-ui-jsx` 126/112; `tenant-feature-instance` 124/115 |
| Dynamic imports only | 13 | every `plugins-*`, reached solely through `import()` in the generated manifests |
| Unused | 0 | — |

The remaining 6 of the 41 are transitive, pulled in by libraries rather than by the console.

The issue's premise — that the console statically depends on every plugin, undermining the plugin
platform — does not hold. `apps/console/constants/plugins.{client,server}.generated.ts` reach every
plugin through `import()`, and the build code-splits them accordingly: plugin code appears in
per-plugin server chunks (`server/chunks/libs_plugins_<name>_…`) and in **no** client chunk. Nx
still records a graph edge, which is correct — a statically analyzable `import()` is a build-time
dependency — but a graph edge is not the same as eager bundling, and the bundle-size and cold-start
argument for pruning does not apply.

Removing these edges would mean resolving plugins at runtime instead, which is the signed
remote-realm-bundle path, and that is deliberately default-OFF.

One real consequence to know: because the plugins are graph dependencies, `inputs: ["^production"]`
means a source change to any plugin invalidates the console's build cache. That is correct — the
console does compile that plugin's code — but it means plugin churn costs full console rebuilds.

The tenant-scoped libraries flagged as suspicious in the issue (`tenant-feature-instance`,
`tenant-data-admin`, `tenant-runtime`) are not misplaced: the besigner renders tenant feature
instances, and the first two are among the console's most heavily used dependencies.

## The Next dev cache prunes itself at serve time (AGL-927)

`apps/console/.next/dev/cache/turbopack` grows without bound across a long dev session. It
reached 126 GB once and 58 GB a second time, on a 460 GB volume — large enough that it becomes
the machine's disk problem rather than the project's.

Nothing under `.next` is source. It is entirely derived from the repo, so the only cost of
deleting it is one cold rebuild, and a dev server that is about to start is going to pay build
cost anyway. So each Next app's `serve` target carries `"dependsOn": ["clean-next-cache"]`,
which runs `tools/scripts/clean-next.mjs --prune --app=<app>` first. Over 10 GB the app's
`.next` is removed and the server starts fresh; under it, nothing happens. `nx serve console`
and `npm run serve:console:emulated` both go through the target, so there is no way to start a
dev server the normal way and skip the check.

Run it by hand with `npm run clean:next` (report only) or `npm run clean:next:prune` (delete
regardless of size). Override the limit with `--threshold=<GB>` or `NEXT_CACHE_MAX_GB`.

**The guard.** An app whose `.next` is being served by a running dev server is never touched,
including under `--force` — deleting a cache mid-serve breaks the running server. "In use" is
decided by each `next` process's working directory rather than by port, so it still holds for a
server started on a custom `--port`, and a second checkout (a git worktree, see
`docs/E2E_LOCAL.md`) has its own `.next` and is correctly treated as unrelated.

**Reading the numbers.** The script sizes with `du`, which on APFS can report noticeably more
than the free space you actually get back — a 58 GB prune returned closer to 7 GiB of
immediately observable `df`, partly because the replacement cache starts rebuilding at once and
partly because APFS reclaim lags. The threshold is a `du` number and so prunes somewhat earlier
than its face value suggests, which is the conservative direction.

## If your tools start failing for no reason, check the disk first (AGL-1425)

**The symptom.** Bash commands fail with `ENOSPC`, or hang for minutes, or a shell dies
outright and cannot be recovered. Unrelated commands break at the same time. Nothing says "the
disk is full", so the obvious readings are "the tool is broken" or "the machine is wedged" —
which is why this costs a session to diagnose every time.

**The path.** `apps/console/.next/dev/cache/turbopack`. On 2026-08-11 it reached **110 GB** on
one checkout and took the volume to 1.8 GiB free of 460 GiB, with `apps/tenant/.next/dev`
likewise full. Check it first:

```
du -sh apps/*/.next/dev/cache/turbopack     # sizes
df -h .                                     # what is actually left
npm run clean:next                          # both, plus a verdict
```

**The fix**, with the dev server for that app stopped:

```
rm -rf apps/console/.next/dev/cache/turbopack     # or: npm run clean:next:prune
```

Stopping the server first is not optional. Deleting the cache underneath a running dev server
corrupts that session, and on a shared machine the server may belong to someone else — this is
exactly why the prune in the section above refuses to touch a cache in use.

### Why the prune alone was not enough

The serve-time prune landed first, and the runaway happened anyway. The reason is the guard:
the 110 GB cache had a concurrent session's dev server attached to it, so every prune correctly
refused, and the cache went on growing. The refusal was even reported — as a tidy one-line note,
at the exact moment someone could have acted on it.

So `clean-next.mjs` now also runs a **free-disk preflight**, and it runs whether or not the
prune did anything. It is the last thing the script does, so a prune that just fixed the problem
does not then fail the target it rescued:

| Free space      | Result                                                     |
| --------------- | ---------------------------------------------------------- |
| under 10 GiB    | **exit 1** — the serve target fails and no server starts     |
| under 30 GiB    | loud warning on stderr, server starts normally               |
| unreadable      | one line, never blocks                                       |

Blocking is a deliberate exception to this script's standing rule of never failing the serve
target. An unprunable cache is an annoyance; starting Turbopack with 8 GiB of headroom reliably
produces the cascade described at the top of this section, and one clear message is cheaper than
finding it again. Overrides: `DEV_DISK_MIN_FREE_GB`, `DEV_DISK_WARN_FREE_GB`, or
`DEV_DISK_CHECK=off` to skip entirely.

Because it lives in `clean-next-cache`, it covers every route people actually use — `nx serve
console`, `nx serve tenant`, `nx serve www`, any `--configuration=production` or `--port`
variant, the `.claude/launch.json` entries (which all shell out to `nx serve`), and the
`serve:*:emulated` npm scripts. It does **not** cover `apps/docs`, which is Docusaurus rather
than Next and has no `clean-next-cache` target; that app has never been the one that fills the
disk. The threshold logic is pure and tested — `npm run test:disk-space`, and in CI.

### What is actually growing

Worth knowing before reaching for a config fix. The cache is a persistent SST store —
`.next/dev/cache/turbopack/v<turbopack-version>/NNNNNNNN.sst` plus a `.meta` sibling per file,
individual tables running 150–230 MB. Two things follow:

- **It is version-keyed.** A Turbopack upgrade starts a fresh `v<version>` directory and leaves
  the old tree behind; nothing reaps it. Deleting `.next` wholesale, as the prune does, is the
  only thing that collects those.
- **Growth is ordinary write volume, not a misconfiguration.** A live console server was
  measured adding ~900 MB in ten minutes of normal editing. Extrapolated across a multi-day
  session, 110 GB needs no pathology to explain — the store accumulates faster than it compacts.

Specifically, browser sourcemap generation is **not** the cause, and is worth ruling out because
it looks like a plausible lead: there is no `productionBrowserSourceMaps` or `serverSourceMaps`
setting anywhere in the repo, and Turbopack ignores that config regardless. There is no knob
here to turn down. Treat the cache as regenerable and let the prune do its job.
