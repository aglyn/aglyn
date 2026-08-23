/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The `@aglyn/shared-ui-jsx` barrel's contents, as data a gate can compare
 * (AGL-1895).
 *
 * `libs/shared/ui/jsx/src/index.ts` is a load-bearing performance boundary.
 * The tenant runtime reaches it statically — the node renderer imports
 * ShadowDom/ErrorBoundary through it — and Turbopack cannot prove a module
 * with top-level `styled()`/`forwardRef()` calls side-effect-free. So
 * EVERY component re-exported there ships eagerly on EVERY published customer
 * page, used or not.
 *
 * AGL-1290 spent multiple sessions finding that out, pruned the barrel
 * (`b6da71e38`, `1f18b1e2a`), and wrote the rule down IN A COMMENT. A comment
 * cannot fail, so it is not a rule — it is folklore with a countdown. This
 * module is the same rule as an executable one.
 *
 * ## The two things it pins, and why one is not enough
 *
 * 1. **`specifiers`** — what the barrel names directly. Catches the exact
 *    AGL-1290 regression: someone appends `export * from
 *    './lib/components/data-table.component'` and it compiles, lints, and
 *    passes every test.
 *
 * 2. **`packages`** — every third-party package reachable transitively FROM
 *    the barrel. Catches the regression the export list cannot see: a module
 *    already on the allowlist growing a heavy import. `card-display` reaching
 *    for MUI X tomorrow costs exactly what re-exporting DataTable costs
 *    today, and pin 1 is silent about it.
 *
 * ## What it costs, measured
 *
 * esbuild bundle deltas against the barrel as it stands, minified, GZIPPED,
 * react/react-dom/next external (2026-08-19). Marginal cost of putting the
 * module back into the barrel's graph:
 *
 *   ./lib/components/data-table.component  +162,866 B gz  (pulls @mui/x-data-grid)
 *   ./lib/components/grid-list             + 20,386 B gz  (pulls react-virtuoso)
 *
 * That is ~179 KB of compressed JavaScript, on every page of every published
 * customer site, to render components those pages have never contained. The
 * numbers are bundle-delta measurements rather than a Turbopack chunk
 * attribution — the delta is the honest proxy; the absolute totals here are
 * not "what ships".
 *
 * ## Why the graph stays small enough to pin
 *
 * The walk reaches 6 libraries, and 6,606 of its ~6,794 modules are leaf
 * `@mdi` icon-data files that import nothing. The real code surface is ~188
 * modules. A tight boundary is precisely what makes an exact-set pin cheap
 * to keep honest — and if that boundary ever stops being tight, this gate
 * says so before a customer page does.
 *
 * Type-only re-exports are not pinned: TypeScript erases them, so they are
 * not runtime edges and they cost a published page nothing. That is
 * `readImports`' existing rule (AGL-1349) and it is the right one here too.
 */

import {
  createResolver,
  readImports,
} from '../../lint-rules/lib/app-router-graph.mjs'

/** The barrel this module exists to defend, repo-relative. */
export const BARREL = 'libs/shared/ui/jsx/src/index.ts'

/**
 * The OTHER barrel a published customer page imports statically (AGL-2486).
 *
 * `apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx` opens with
 * `import * as Aglyn from '@aglyn/aglyn'`, so this entry bills the same way
 * `BARREL` does — and until AGL-2486 nothing watched it. Two heavy packages
 * had walked in through it and nothing went red:
 *
 *   `firebase/auth` — `merge-node-sx`, a styling helper on the node-render
 *     path, imported one function through the `@aglyn/shared-data-enums`
 *     barrel, which re-exports a module that imports `AuthErrorCodes` from
 *     `firebase/auth` as a VALUE. Removing that edge: -48,643 B GZIPPED.
 *   `acorn` — `app-utils/server.ts` re-exported `plugin-bundle-checks`, so a
 *     JavaScript parser for inspecting untrusted marketplace bundles shipped
 *     to anonymous visitors. Moving it behind the `/server` entry:
 *     -39,035 B GZIPPED.
 *
 * Both are one-line mistakes that compile, lint, typecheck and test green.
 * That is precisely the class this detector already exists for, so it guards
 * this entry with the same two pins rather than a second mechanism.
 */
export const AGLYN_BARREL = 'libs/aglyn/src/index.ts'

/**
 * A bare specifier reduced to the package that bills for it.
 *
 * Deliberately coarser than the specifier: `@mui/material/styles` and
 * `@mui/material` are one dependency and one bundle cost, so pinning them
 * separately would go red when somebody rewrites an import without moving a
 * byte. A gate that cries wolf gets deleted, and the thing it guarded goes
 * with it.
 *
 * Returns null for a relative path or a `node:` builtin — neither is a
 * third-party dependency.
 */
export function packageOf(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) {
    return null
  }
  if (specifier.startsWith('node:')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Every module specifier the barrel names directly, deduplicated and sorted.
 *
 * @param {string} source the barrel's text
 */
export function readBarrelSpecifiers(source) {
  return [...new Set(readImports(source).map((one) => one.specifier))].sort()
}

/**
 * Walk the barrel's transitive first-party graph and collect the third-party
 * packages it reaches.
 *
 * `read` and `resolve` are injected so the self-test can drive a synthetic
 * graph. Proving this walk red must never mean editing the real barrel: this
 * is a shared checkout, and a file swapped on disk to force a red lands in
 * whichever agent commits next.
 *
 * `resolve` returns null for anything inside `node_modules` — that is
 * `createResolver`'s existing contract, and it is exactly the signal we
 * want, since an unresolvable bare specifier IS a third-party edge.
 *
 * @param {object} io
 * @param {string} io.entry absolute path to the barrel
 * @param {(file: string) => string} io.read
 * @param {(specifier: string, fromFile: string) => string | null} io.resolve
 */
export function collectBarrelGraph({ entry, read, resolve }) {
  const modules = new Set()
  /** package → the file that first pulled it in, for a blameable message. */
  const packages = new Map()
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (modules.has(file)) continue
    modules.add(file)

    let source
    try {
      source = read(file)
    } catch {
      // A module the resolver found but we cannot read is not silently
      // skipped debt — it is simply not an edge we can follow. The resolver
      // only returns paths it has already confirmed exist.
      continue
    }

    for (const { specifier } of readImports(source)) {
      const resolved = resolve(specifier, file)
      if (resolved) {
        if (!modules.has(resolved)) queue.push(resolved)
        continue
      }
      const name = packageOf(specifier)
      if (name && !packages.has(name)) packages.set(name, file)
    }
  }

  return {
    modules,
    packages: [...packages.keys()].sort(),
    firstImporter: packages,
  }
}

/**
 * Convenience wrapper over `collectBarrelGraph` for the real repo.
 *
 * `barrel` defaults to `BARREL` so every existing caller is unchanged; pass
 * `AGLYN_BARREL` for the other entry a published page imports statically.
 */
export function measureBarrel(root, read, barrel = BARREL) {
  const resolve = createResolver(root)
  const entry = `${root}/${barrel}`
  const graph = collectBarrelGraph({ entry, read, resolve })
  return {
    specifiers: readBarrelSpecifiers(read(entry)),
    packages: graph.packages,
    moduleCount: graph.modules.size,
    firstImporter: graph.firstImporter,
  }
}

/** Exact-set diff. Both directions are reportable; see `evaluateBarrel`. */
function diffSets(actual, allowed) {
  const allowedSet = new Set(allowed)
  const actualSet = new Set(actual)
  return {
    added: actual.filter((one) => !allowedSet.has(one)).sort(),
    removed: allowed.filter((one) => !actualSet.has(one)).sort(),
  }
}

/**
 * Compare a measurement against the checked-in allowlist.
 *
 * `added` is red for the reason the whole module exists. `removed` is red
 * too, and that is the deliberate part: it is `ratchet-baseline.mjs`'s
 * `stale` verdict wearing different clothes. An allowlist row nobody has read
 * is the AGL-2002 shape — the win should be banked in the same commit that
 * earned it, or the next person reads the list as permission.
 *
 * @param {{specifiers: string[], packages: string[]}} measured
 * @param {{specifiers: string[], packages: string[]}} baseline
 */
export function evaluateBarrel(measured, baseline) {
  const specifiers = diffSets(measured.specifiers, baseline.specifiers ?? [])
  const packages = diffSets(measured.packages, baseline.packages ?? [])
  return {
    specifiers,
    packages,
    clean:
      specifiers.added.length === 0 &&
      specifiers.removed.length === 0 &&
      packages.added.length === 0 &&
      packages.removed.length === 0,
  }
}

/**
 * The sentence the failure has to say, because the fix has to be obvious
 * without finding this file or reading AGL-1290.
 */
export const WHY =
  'Everything reachable from this barrel ships eagerly on EVERY published ' +
  'customer page, used or not — the tenant runtime imports it statically and ' +
  'Turbopack cannot prove a module with top-level `styled()`/`forwardRef()` ' +
  'side-effect-free (AGL-1290). A component joins the barrel ONLY if the ' +
  'tenant page graph or the besigner needs it by name; console-/www-only ' +
  'components are imported by subpath instead — ' +
  "'@aglyn/shared-ui-jsx/components/<file>', which already resolves. " +
  'Measured: re-exporting data-table.component costs +162,866 B GZIPPED and ' +
  'grid-list +20,386 B, on every page of every customer site.'

/**
 * The same sentence for `AGLYN_BARREL`, whose fix is a different one
 * (AGL-2486) — a subpath or the `/server` entry, not "drop the export".
 */
export const WHY_AGLYN =
  'Everything reachable from `libs/aglyn/src/index.ts` ships eagerly on ' +
  'EVERY published customer page: `catch-all-client.tsx` opens with ' +
  "`import * as Aglyn from '@aglyn/aglyn'`, and a module with a top-level " +
  'singleton (`lib/aglyn.ts` builds one) is not something a bundler will ' +
  'shake. A package appearing here means some module in the graph grew a ' +
  'value import of it — usually through ANOTHER barrel, which is how ' +
  '`firebase/auth` and `acorn` both got in. The fix is almost never to ' +
  'delete the code: import the file you actually want by subpath ' +
  "('@aglyn/shared-data-enums/styles'), or, if it is server-only, hang it " +
  "off '@aglyn/aglyn/server' the way `api-adapter` (node:stream), " +
  '`api-idempotency` (node:crypto) and `plugin-bundle-checks` (acorn) all ' +
  'do. Measured on a Turbopack production build: those two edges were ' +
  '-48,643 B and -39,035 B GZIPPED on the published-page route.'
