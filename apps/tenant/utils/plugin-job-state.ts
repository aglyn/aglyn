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
 * Last-run marks for the plugin job beat, read from Firestore at most once per
 * `PLUGIN_JOB_STATE_MAX_AGE_MS` instead of once per beat (AGL-1440).
 *
 * The beat fires every minute (`cloud/functions/src/index.ts`). Every tick read
 * `platform/pluginJobs` before it could decide anything was due, so an
 * otherwise completely idle platform paid 1,440 reads a day — 43,200 a month —
 * to be told nothing had changed.
 *
 * ## Why an in-memory copy is safe
 *
 * The document exists so due-ness survives a COLD START, and that is all it is
 * for. An instance that has read it and folded in its own writes holds an exact
 * copy of the truth it is responsible for; the only way it drifts is if a
 * DIFFERENT instance ran a job in the meantime. Cloud Scheduler fires one tick
 * per minute with `retryCount: 0`, so that needs an instance swap, and a cold
 * instance starts with an empty cache and reads the document.
 *
 * ## The error can only go one way
 *
 * A stale cache holds last-run marks that are older than the truth, never
 * newer — our own writes are the truth, and another instance's writes can only
 * move a mark FORWARD. `now - last` is therefore only ever over-estimated, so
 * a cached mark can make a job run EARLY and can never make one run late or be
 * skipped. That is the direction a scheduler is allowed to be wrong in, and it
 * is bounded below.
 *
 * ## What invalidates it, and the worst stale read
 *
 * Age. After `PLUGIN_JOB_STATE_MAX_AGE_MS` the next beat re-reads the document,
 * so drift never exceeds that window: a job can run at most once, at most 30
 * minutes early. `PluginJob` already requires handlers to be idempotent and
 * bounded (`plugin-jobs.ts`), so an early re-run is inside the contract the
 * registry publishes. Concretely, for the two live jobs: `apply-publish-schedules`
 * has `intervalMinutes: 1` and is due on every beat regardless of any mark, and
 * bookings' `expire-stale-holds` (6 h) might lapse day-old holds at 5 h 30 m
 * instead of 6 h.
 *
 * NOTHING is cached about entitlements. `applyDuePublishSchedule` re-checks the
 * `scheduledPublishing` entitlement live on every application — the cache
 * decides only WHETHER TO LOOK, never what the answer is.
 */

/**
 * How long an in-memory copy may stand in for the document.
 *
 * The bound is what turns "another instance ran something" from a correctness
 * problem into a scheduling one: it caps how early a job can fire.
 */
export const PLUGIN_JOB_STATE_MAX_AGE_MS = 30 * 60_000

/** Job key → epoch ms of its last run. */
export type PluginJobLastRuns = Record<string, number>

let cached: PluginJobLastRuns | null = null
let cachedAt = 0

export interface ReadPluginJobLastRunsOptions {
  now: number
  /** Reads `platform/pluginJobs`. Called only when the cache is cold or aged. */
  read: () => Promise<PluginJobLastRuns>
}

/**
 * The last-run marks, from memory when they are fresh enough.
 *
 * A read that throws leaves the cache untouched and rethrows: the caller's beat
 * fails and the next one retries, which is what happened before this cache
 * existed. Swallowing it would hand back an empty map and run every job.
 */
export async function readPluginJobLastRuns(
  options: ReadPluginJobLastRunsOptions,
): Promise<PluginJobLastRuns> {
  const { now, read } = options
  if (cached && now - cachedAt < PLUGIN_JOB_STATE_MAX_AGE_MS) return cached
  const marks = await read()
  cached = marks
  cachedAt = now
  return marks
}

/**
 * Fold this instance's own writes into the cache.
 *
 * Called with the same keys and timestamp handed to Firestore, so the cache
 * stays exactly as correct as the document for anything this instance did. It
 * deliberately does NOT refresh `cachedAt` — the age bound measures distance
 * from the last time we saw ANOTHER instance's work, and running a job here
 * tells us nothing about that.
 */
export function recordPluginJobRuns(
  keys: readonly string[],
  now: number,
): void {
  if (!cached) return
  for (const key of keys) cached[key] = now
}

/** Test seam — the cache is module scope by design. */
export function resetPluginJobState(): void {
  cached = null
  cachedAt = 0
}
