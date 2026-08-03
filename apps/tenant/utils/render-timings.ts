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
 * - `cold` — whether this instance has served a render before. The first render
 *   pays every one-shot cost (plugin module evaluation, Firestore client
 *   construction, connection setup); later ones pay none of it. Comparing a
 *   cold line against a warm line on the same instance apportions the cost
 *   without needing a second deploy.
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
          sinceBootMs: startedAt - MODULE_LOADED_AT,
          totalMs: Date.now() - startedAt,
          phases,
          ...fields,
        }),
      )
    },
  }
}
