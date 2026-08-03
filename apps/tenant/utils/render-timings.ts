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
 * Render-path timings for the tenant catch-all (AGL-1152).
 *
 * After every tenant deploy the first visitor gets a 502, then an 8–12s page,
 * then ~0.3s once warm. Four candidates were proposed for that cost and none
 * had been measured: `serverPluginLoader.ensureAll` (imports the server half of
 * all seven first-party plugins), serverless cold boot itself, the sequential
 * Firestore reads, and whatever produces the 502. Attributing it by reading is
 * what went wrong twice on AGL-1151, so this measures instead.
 *
 * Two numbers separate cold boot from the render, and they are the whole point:
 *
 * - `sinceBoot` — ms from this module being evaluated to the render starting.
 *   Module evaluation happens during cold boot, so on the FIRST request of a
 *   fresh instance this is small (boot just finished) while `cold` is true. It
 *   is large on a warm instance that has been idle.
 * - `cold` — whether a render had already STARTED on this instance. Read the
 *   caveat below before trusting it.
 *
 * What the first production read settled (2026-08-03):
 *
 * - `ensureAll` was suspect #1 and is NOT the cost — 0–45 ms against a 2–5 s
 *   total, on the first render of a fresh instance.
 * - **`cold` is the wrong discriminator; `sinceBootMs` is the right one.** The
 *   flag flips when a render BEGINS, so concurrent renders on a fresh instance
 *   report `cold:false` while paying the full warm-up. Lines with
 *   `sinceBootMs` under ~100 ms run 2–5 s regardless of the flag; the same
 *   paths at `sinceBootMs` ~11 s run 1–1.6 s. Every phase is 3–6× slower in an
 *   instance's first seconds, which points at shared client/connection warm-up
 *   rather than any one phase.
 * - Two lines per request, milliseconds apart, exposed the real defect: the
 *   loader's `cache()` was keyed on the slug ARRAY, so `generateMetadata` and
 *   the page never shared an entry and every render ran twice (fixed in
 *   `load-page-data.ts`). Doubling a 5 s render is what crossed the 10 s
 *   function limit and produced the post-deploy 502.
 *
 * What the SECOND production read settled (2026-08-03, after that fix):
 *
 * - The 502 is gone. A cold render is now ~5–5.9 s end to end, under the limit.
 * - `preLoadBootMs` is ~1.8 s, not the ~7.8 s it was added to confirm. See the
 *   field's own comment — the guess it was built to test turned out wrong.
 * - The loader, not boot, is now the larger half. On a cold `/product/besigner`:
 *   `composeScreenNodes` 1577, `getRealmPluginInstalls` 628,
 *   `runSitePageEnrichers` 456, `filterEnabledPluginsByReleaseFlags` 412,
 *   `getHost` 378, `getOrgBilling` 303, `resolveSiteRedirect` 183,
 *   `getScreen` 111, `ensureAll` 17. Phases are per-phase deltas and sum to
 *   `totalMs`, so they can be read as a budget directly.
 * - Those phases stay expensive WARM: the same path at `sinceBootMs` ~343 s
 *   still reported `totalMs` 3410. So this is query fan-out, not warm-up, and
 *   it will not be fixed by anything that only targets cold starts.
 *
 * Timings go through `console.log` as one line of JSON so a Vercel runtime-log
 * query can pull them without a log drain. Overhead is a `Date.now()` per
 * phase, so this can stay on in production — the shape it measures only ever
 * appears in production, and a sampled-off instrument would miss the one cold
 * render per deploy that matters.
 */

/**
 * Module-evaluation time. Set once when the serverless instance boots, NOT per
 * request — the gap between this and the first render is the cold-boot tail.
 */
const MODULE_LOADED_AT = Date.now()

/**
 * How long the Node process had ALREADY been alive when this module evaluated.
 *
 * This is the number the first production read was missing (AGL-1152). A cold
 * request measured 11.57 s end to end while the loader reported 3.77 s, leaving
 * ~7.8 s unaccounted for — and `sinceBootMs` cannot see any of it, because it
 * starts counting at module evaluation, which happens at the END of boot.
 *
 * `process.uptime()` is measured from process start, so reading it here splits
 * that gap cleanly: time before this line is runtime + framework + module-graph
 * evaluation (a bundle problem, overlapping AGL-1151), time after it is ours.
 * Captured at module scope, never per request — it is a property of the
 * instance, and reading it later would measure the request instead.
 *
 * **Only meaningful on a serverless instance.** A lambda boots and serves its
 * first request immediately, so uptime-at-load IS the pre-render cost. On a
 * long-lived local server it also counts however long the process sat idle
 * before the first request, which is not a cost anyone pays — a local run
 * reported 7.3 s and 8.8 s for the same build purely because of when the
 * request was issued. Do not read a local value as a boot measurement.
 *
 * Local runs did settle one thing by another route: with the server already
 * warm, a page request took 3.33 s against a loader reporting 2.83 s, so module
 * loading plus the React render beyond the loader is only ~0.5 s.
 *
 * The production read (2026-08-03, two independent cold lambdas) then measured
 * this field directly and **falsified the guess it was added to test**. The
 * ~7.8 s was NOT lambda initialisation:
 *
 * ```
 * cold:true preLoadBootMs:1770 sinceBootMs:23 totalMs:4065  /product/besigner
 * cold:true preLoadBootMs:1834 sinceBootMs:39 totalMs:3188  /
 * ```
 *
 * Lambda init is ~1.8 s — a third of a ~5–5.9 s cold render, not the bulk of an
 * 11.5 s one. The 11.5 s reading predated the doubled-render fix, so most of the
 * "missing" time was the second render, not boot. What remains splits as ~1.8 s
 * of init (a module-graph cost, so AGL-1151's problem) against ~3.2–4.1 s inside
 * the loader, which is the larger half and belongs to nobody yet.
 */
const PROCESS_UPTIME_AT_LOAD_MS = Math.round(process.uptime() * 1000)

/** Flipped by the first render on this instance; every later render is warm. */
let hasRendered = false

export interface RenderTimer {
  /** Record the cumulative elapsed time at the end of a phase. */
  mark(phase: string): void
  /** Emit the single structured line. Safe to call exactly once. */
  report(fields: Record<string, unknown>): void
}

/**
 * Start a timer for one render. Per-invocation state, never module-level: the
 * loader runs concurrently for different hosts on the same instance, and a
 * shared accumulator would interleave their phases into nonsense.
 */
export const startRenderTimer = (): RenderTimer => {
  const startedAt = Date.now()
  const cold = !hasRendered
  hasRendered = true

  const phases: Record<string, number> = {}
  let last = startedAt
  let reported = false

  return {
    mark: (phase) => {
      const now = Date.now()
      // Phases are additive, so a repeated name (the loader calls getScreen on
      // several branches) accumulates rather than overwriting — otherwise the
      // total would not reconcile with `totalMs`.
      phases[phase] = (phases[phase] ?? 0) + (now - last)
      last = now
    },
    report: (fields) => {
      if (reported) return
      reported = true
      console.log(
        JSON.stringify({
          tag: 'AGL-1152:render',
          cold,
          // Boot BEFORE our code existed. On a cold instance this is the
          // pre-loader cost; on a warm one it is just how old the instance is
          // at load time, so read it together with `cold`/`sinceBootMs`.
          preLoadBootMs: PROCESS_UPTIME_AT_LOAD_MS,
          sinceBootMs: startedAt - MODULE_LOADED_AT,
          totalMs: Date.now() - startedAt,
          phases,
          ...fields,
        }),
      )
    },
  }
}
