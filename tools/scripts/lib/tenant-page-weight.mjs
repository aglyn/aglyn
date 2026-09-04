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
 * The measurement and the verdict behind `check-tenant-page-weight.mjs`.
 *
 * Split from the CLI the way `jsx-barrel.mjs` is, and for the same reason: the
 * forced reds have to run against a doctored graph held in memory. This is a
 * shared checkout, and a file swapped on disk to prove a red is a file that
 * rides along in whichever agent commits next.
 *
 * ## What is measured, and why it is a proxy
 *
 * The entry is the published page's client root. From there the walk follows
 * STATIC edges only and sums the SOURCE bytes of the first-party modules it
 * reaches.
 *
 * Static-only is the load-bearing half. An `import()` is a chunk the browser
 * fetches when a branch asks for it, so it is not first-load weight, and a
 * measurement that counted it would score a deliberate lazy boundary as no
 * improvement at all.
 *
 * Source bytes are pre-minification, so the number is not "what a visitor
 * downloads" — for that, measure a cold load against a real published page. It
 * is the right proxy for a GATE: no production build, no bundler, no network,
 * deterministic, and it moves in the same direction as the wire. Third-party
 * bytes are out of scope; `createResolver` stops at `node_modules`, and the
 * package set is already pinned by the two barrel gates.
 */

import { collectBarrelGraph } from './jsx-barrel.mjs'

/**
 * The published page's client root, repo-relative.
 *
 * One entry, not a list. This file is what `apps/tenant/app/[host]/
 * [[...slug]]/page.tsx` renders the author's nodes into, so its static graph IS
 * the JavaScript a visitor to any published screen downloads before the page
 * can hydrate. Sibling client components (the admin bar, the analytics tags)
 * are either release-gated off for anonymous visitors or already lazy, and
 * folding them in would blur the one number this gate is about.
 */
export const TENANT_PAGE_ENTRY =
  'apps/tenant/app/[host]/[[...slug]]/catch-all-client.tsx'

/**
 * Headroom over the measured baseline before the gate goes red.
 *
 * The same 25% `check-plugin-budgets.mjs` uses, and for the same reason: a
 * budget pinned to the exact measurement goes red on a comment, which is how a
 * gate gets suppressed rather than read.
 */
export const HEADROOM = 1.25

/**
 * Walk the entry's static first-party graph and weigh it.
 *
 * `read`, `resolve` and `size` are injected so a test can drive a synthetic
 * graph, and so a forced red can doctor one real module in memory.
 *
 * @param {object} io
 * @param {string} io.entry absolute path to the client root
 * @param {(file: string) => string} io.read
 * @param {(specifier: string, fromFile: string) => string | null} io.resolve
 * @param {(file: string) => number} io.size bytes of a resolved module
 */
export function measurePageWeight({ entry, read, resolve, size }) {
  const graph = collectBarrelGraph({ entry, read, resolve, staticOnly: true })
  const files = []
  let bytes = 0
  for (const file of graph.modules) {
    let count
    try {
      count = size(file)
    } catch {
      // A module the resolver found but we cannot stat weighs nothing we can
      // defend a number with. It is still IN the graph — `moduleCount` counts
      // it — so a resolver that started returning phantoms shows up as a
      // module count that moved without bytes moving, rather than silently.
      continue
    }
    bytes += count
    files.push([file, count])
  }
  files.sort((a, b) => b[1] - a[1])
  return {
    bytes,
    moduleCount: graph.modules.size,
    modules: [...graph.modules],
    files,
    packages: graph.packages,
  }
}

/**
 * Modules a published page's client root must never reach STATICALLY, whatever
 * the byte total says.
 *
 * The budget is a ceiling, and a ceiling is the wrong instrument for this
 * failure. Each of these is a barrel — or, in one case, a module that a barrel
 * is the only reason to reach — and a barrel walks back in one named import at
 * a time. The bytes then arrive gradually, under the headroom, until the
 * ceiling is re-cut for an unrelated reason and the whole reach is permitted
 * again. Naming the modules pins the SHAPE of the fix rather than its size, so
 * a reviewer reads which boundary was crossed instead of a number that moved.
 *
 * `reached` is a suffix match on the repo-relative path, so it needs no root.
 */
export const FORBIDDEN_MODULES = [
  {
    path: 'libs/aglyn/src/index.ts',
    why:
      'the core barrel re-exports `lib/aglyn`, whose runtime singleton is ' +
      'constructed at import time, so nothing downstream of it can be ' +
      'dropped as unused. Import the module that DEFINES the value — ' +
      "'@aglyn/aglyn/app-utils/<file>', '@aglyn/aglyn/aglyn' for the " +
      'singleton — or hang it off `@aglyn/aglyn/server` if it is server-only.',
  },
  {
    path: 'libs/aglyn/src/lib/foundation/index.ts',
    why:
      'the foundation barrel reaches the platform, organization and billing ' +
      'type modules — 114 modules — and every value a published page takes ' +
      'from it lives in a `foundation/constants/*` file of one or two KB. ' +
      "Import `./foundation/constants/app`, `/shared` or `/components`.",
  },
  {
    path: 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
    why:
      'the plan, quota and entitlement table is the largest first-party ' +
      'module a page can reach, and the only thing a published page needs ' +
      'out of it is the platform brand. That constant lives in ' +
      '`app-utils/platform-brand`, which this module re-exports.',
  },
  {
    path: 'libs/shared/ui/jsx/src/index.ts',
    why:
      'the JSX barrel re-exports the Pages Router hooks, the inline SVG set ' +
      'and the ~12,000-module MDI catalog. Import the component by subpath: ' +
      "'@aglyn/shared-ui-jsx/components/<file>'.",
  },
]

/**
 * The forbidden modules a measurement actually reached.
 *
 * @param {{modules?: string[]}} measured
 */
export function forbiddenReached(measured) {
  const modules = measured.modules ?? []
  return FORBIDDEN_MODULES.filter(({ path }) =>
    modules.some((file) => file.endsWith(`/${path}`)),
  )
}

/** The budget a measurement should be pinned at, given the measurement. */
export function budgetFor(measured, previous) {
  const budget = {
    entry: TENANT_PAGE_ENTRY,
    baselineBytes: measured.bytes,
    budgetBytes: Math.ceil((measured.bytes * HEADROOM) / 1024) * 1024,
    baselineModules: measured.moduleCount,
  }
  /*
   * The wire calibration survives a re-baseline untouched.
   *
   * `--write` rewrites this file wholesale, and the calibration is not a
   * measurement of the source graph — it records a page weight measured
   * against a deployment, what was and was not counted, and why. None of that
   * is re-derivable from the numbers this function has. Dropping it would make
   * the pricing gate fail as UNREADABLE rather than as stale, and the obvious
   * repair for an unreadable calibration is to write a fresh one from nothing,
   * which is how the provenance gets lost for good.
   *
   * Carried only when a previous budget actually holds one, so the FIRST
   * baseline still invents nothing.
   */
  if (previous?.wireCalibration) {
    budget.wireCalibration = previous.wireCalibration
  }
  return budget
}

/**
 * Compare a measurement against the checked-in budget.
 *
 * Three ways to be red, and the last two are the deliberate ones:
 *
 *   `over` — the page got heavier than the budget allows.
 *   `entryMoved` — the budget on disk is for a different entry, so it is
 *     measuring nothing. A gate that quietly passes because its subject moved
 *     is worse than no gate; whoever moved the client root re-baselines in the
 *     same commit.
 *   `forbidden` — a named barrel is statically reachable again. Red on its own
 *     terms, under the ceiling or not: see {@link FORBIDDEN_MODULES}.
 *
 * A page getting LIGHTER is deliberately NOT red, unlike the barrel gates'
 * exact-set pins. Those pin a SET, where a missing row means an allowlist
 * nobody read. This pins a CEILING, and a ceiling that a win has to be re-cut
 * to reach is a ceiling that punishes the win.
 *
 * @param {{bytes: number, moduleCount: number}} measured
 * @param {{entry: string, budgetBytes: number}} budget
 */
export function evaluatePageWeight(measured, budget) {
  const entryMoved = budget.entry !== TENANT_PAGE_ENTRY
  const over = measured.bytes > budget.budgetBytes
  const forbidden = forbiddenReached(measured)
  return {
    ok: !entryMoved && !over && forbidden.length === 0,
    over,
    entryMoved,
    forbidden,
    overBy: over ? measured.bytes - budget.budgetBytes : 0,
  }
}

/**
 * Every reason a verdict is red, as the text the gate prints.
 *
 * It lives here rather than in the CLI so the ONE thing the CLI does with a
 * red — exit 1 — cannot be quietly separated from the reason it printed. The
 * CLI used to branch per reason and return 1 from each branch, and a mutation
 * that deleted one branch changed the exit code while every test stayed green:
 * the reason simply stopped being reported and the run passed. One `!ok`
 * decides the exit; this function decides what the reader is told.
 *
 * @param {ReturnType<typeof evaluatePageWeight>} verdict
 * @param {{bytes: number, moduleCount: number}} measured
 * @param {{entry: string, budgetBytes: number}} budget
 * @returns {string[]} one paragraph per reason, in the order they are checked
 */
export function explainVerdict(verdict, measured, budget) {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`
  const reasons = []
  if (verdict.entryMoved) {
    reasons.push(
      `the recorded budget is for ${budget.entry}, but this run measured ` +
        `${TENANT_PAGE_ENTRY}. Re-baseline with --write in the commit that ` +
        'moved the entry.',
    )
  }
  if (verdict.forbidden.length) {
    reasons.push(
      "a published page's client root reached a module it must not reach " +
        'statically.\n\n' +
        verdict.forbidden
          .map(({ path, why }) => `  ${path}\n      ${why}`)
          .join('\n\n') +
        '\n\nRun with --list to see the graph. This is red whether or not ' +
        'the page is under its byte budget: the bytes arrive gradually, and ' +
        'the boundary is the thing being kept.',
    )
  }
  if (verdict.over) {
    reasons.push(
      "a published page's first load grew past its budget.\n\n" +
        `  measured  ${kb(measured.bytes)}  (${measured.moduleCount} modules)\n` +
        `  budget    ${kb(budget.budgetBytes)}\n` +
        `  over by   ${kb(verdict.overBy)}\n\n` +
        WHY_PAGE_WEIGHT,
    )
  }
  return reasons
}

/**
 * The paragraph a failure prints, so the reader knows what it costs and what
 * usually caused it rather than only that a number moved.
 */
export const WHY_PAGE_WEIGHT =
  'This is first-party source statically reachable from the published ' +
  "page's client root, so every byte of it is downloaded by every visitor " +
  'to every customer site before the page can hydrate. Bandwidth is the ' +
  'largest component of cost of goods sold at every plan tier.\n\n' +
  'Run with --list to see what is in the graph. The two usual causes are a ' +
  'barrel import that pulls a whole library for one symbol, and a module ' +
  'namespace passed somewhere as a VALUE, which is opaque to a bundler — it ' +
  'cannot know which exports the consumer reads, so it keeps everything the ' +
  'barrel can reach.\n\n' +
  'If the growth is deliberate, re-baseline with --write in the same commit, ' +
  'so a reviewer reads the new number next to the change that bought it.'
