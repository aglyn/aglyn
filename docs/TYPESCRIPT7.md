# TypeScript 7 (native compiler) — toolchain layout

Migrated in AGL-460 (July 2026). TypeScript 7 is the Go-native compiler
("Corsa", GA 2026-07-08, ~10x faster). It ships **without** the JavaScript
compiler API, so tools that `require('typescript')` (typescript-eslint,
ts-jest, Next.js type-checking, Nx executors) can't use it directly until the
new API lands in TS 7.1+. The workspace therefore uses Microsoft's sanctioned
side-by-side layout:

```jsonc
// package.json (root and cloud/functions)
"devDependencies": {
  // JS-API bridge (Strada 6.x): what `require('typescript')` resolves to.
  "typescript": "npm:@typescript/typescript6@6.0.2",
  // Native Go compiler: provides the `tsc` binary (npx tsc → 7.x).
  "@typescript/native": "npm:typescript@7.0.2"
}
```

- `npx tsc` → **native 7.x** (the `@typescript/native` alias owns the `tsc`
  bin name; the bridge package's binary is `tsc6`).
- `require('typescript')` → **6.x JS API** — keeps typescript-eslint, ts-jest,
  `next build` type-checking, and `@nx/js` declaration emit working unchanged.

## Type-checking

Builds do NOT type-check (swc/rollup strip types; jest uses babel/swc/ts-jest
transforms). The whole-workspace type gate is:

```sh
npm run typecheck            # all project tsconfigs, native tsc, ~seconds
npm run typecheck libs/aglyn # filter by path prefix
```

`tools/scripts/typecheck.mjs` drives it and runs in CI (nx-ci.yml) before the
affected lint/test/build step. Skips (see the script's SKIP list):
`tsconfig.base.json` (not a program), `tools/` (no .ts inputs), and `apps/docs`
(standalone Docusaurus on its own TypeScript).

## TS 7 config rules that bit us (and their fixes)

- **`baseUrl` removed.** `paths` values must be explicitly relative to the
  declaring tsconfig (`./libs/...` in `tsconfig.base.json`; `../../../../...`
  in per-project overrides like `libs/shared/ui/theme/tsconfig.lib.json`).
- **`types` entries resolve strictly from `typeRoots`** when `typeRoots` is
  set — no more fallback to regular package resolution. Cypress (which ships
  its own types; there is no `@types/cypress`) is loaded via an explicit
  `"files": ["../../node_modules/cypress/types/index.d.ts"]` in the e2e
  tsconfigs. `typeRoots` overrides must also be relative to their own config
  (see `libs/shared/ui/jsx/tsconfig.json`).
- **`esModuleInterop: false` removed** (interop is always on).
- **`jsx: "react"` + `jsxImportSource` is now an error** — spec configs use
  `"jsx": "react-jsx"`.
- **`rootDir` must be explicit** when the config sits above the common source
  dir and `outDir` matters (`cloud/functions` sets `"rootDir": "src"`).
- **`moduleResolution: "node"` removed** — `cloud/functions` is on
  `nodenext`; workspace code was already on `bundler`.
- Scaffolded plugin tsconfigs (`tools/scripts/create-plugin.mjs`) include the
  `@nx/react` typings in `files` so `*.svg`/css-module imports resolve in
  spec programs too.

## Next.js and the removed `baseUrl`

Next 16 resolves tsconfig `paths` against the **app directory** (its TS6
compat strips `baseUrl` and only rewrites non-relative path values — see
`next/dist/lib/typescript/getTypeScriptConfiguration.js`), while TS 7 resolves
them against the config that declares them (the repo root for
`tsconfig.base.json`). With root-relative `./libs/...` values, Next's webpack
resolved aliases against `apps/<app>/libs/...` → "Module not found".

Fix: each Next app has a **generated** `apps/<app>/tsconfig.next.json`
(selected via `typescript.tsconfigPath` in `with-aglyn.nextjs.config.js`)
that re-declares the workspace `paths` rebased to the app dir
(`../../libs/...`). Regenerate after changing `paths` in tsconfig.base.json:

```sh
node tools/scripts/sync-next-tsconfigs.mjs
```

The native compiler and `npm run typecheck` skip these files by name. Delete
the mechanism once Next resolves `paths` relative to the declaring config
(vercel/next.js discussion #95633).

## App Router pages and Next's generated validators

`next build`/`next dev` generate prop validators under `.next/types` which
the app tsconfigs include. Pages typed with a bare `NextPageWithLayout`
default to `Partial<Record<string, unknown>>` props, which fails the
validator's excess-key check (`Type 'unknown' is not assignable to 'never'`).
App Router pages that take no own props must use
`NextPageWithLayout<Record<string, never>>` (all 32 pages were converted in
AGL-460; production builds never caught this because
`typescript.ignoreBuildErrors` is on for prod).

## Gotchas

- The bridge package reports `ts.version` as its internal Strada version
  (e.g. `6.0.3`) which can differ from the npm package version (`6.0.2`) —
  don't be surprised by the mismatch.
- `apps/docs` (Docusaurus) intentionally stays on its own standalone
  TypeScript devDependency.
- Editor: VS Code's bundled TS 7 language service works out of the box; if
  "Use Workspace Version" is selected it picks up the 6.x bridge instead.
