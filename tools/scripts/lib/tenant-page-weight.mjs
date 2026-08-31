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
    files,
    packages: graph.packages,
  }
}

/**
 * The budget a measurement should be pinned at, given the measurement.
 *
 * `wireCalibration` is carried through from the existing file VERBATIM, and
 * deliberately not re-derived. It records what a real cold load of a published
 * page weighed over the wire and which graph it was measured against, and
 * `check-page-view-rate.mjs` prices `perPageView` off it. Re-stamping it here
 * would let a `--write` silently re-certify a measurement nobody took — the
 * whole point is that re-baselining a grown page leaves the calibration
 * pinned to the old graph, so the pricing gate goes red and the rate gets
 * looked at in the same diff.
 *
 * Dropping it would be worse still: the field would vanish from the file and
 * the pricing gate would fail as unreadable rather than as stale.
 */
export function budgetFor(measured, existing = {}) {
  const budget = {
    entry: TENANT_PAGE_ENTRY,
    baselineBytes: measured.bytes,
    budgetBytes: Math.ceil((measured.bytes * HEADROOM) / 1024) * 1024,
    baselineModules: measured.moduleCount,
  }
  if (existing.wireCalibration) {
    budget.wireCalibration = existing.wireCalibration
  }
  return budget
}

/**
 * Compare a measurement against the checked-in budget.
 *
 * Two ways to be red, and the second is the deliberate one:
 *
 *   `over` — the page got heavier than the budget allows.
 *   `entryMoved` — the budget on disk is for a different entry, so it is
 *     measuring nothing. A gate that quietly passes because its subject moved
 *     is worse than no gate; whoever moved the client root re-baselines in the
 *     same commit.
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
  return {
    ok: !entryMoved && !over,
    over,
    entryMoved,
    overBy: over ? measured.bytes - budget.budgetBytes : 0,
  }
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
