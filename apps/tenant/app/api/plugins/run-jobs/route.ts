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

import {
  listPluginJobs,
  pluginJobKey,
  runPluginJobs,
} from '@aglyn/aglyn/server'
import {
  filterEnabledPluginsByReleaseFlags,
  firebaseAdmin,
} from '@aglyn/tenant-data-admin'
import { timingSafeEqual } from 'crypto'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'
// Imported for its registration side effect (AGL-1159). Core jobs have no
// plugin manifest to load them, so the runner route is where they enter the
// registry — `ensureAll` below only reaches plugin `/server` entries.
import '../../../../utils/publish-schedule-job'
import {
  readPluginJobLastRuns,
  recordPluginJobRuns,
} from '../../../../utils/plugin-job-state'

// Constant-time secret check (AGL-512) so auth doesn't leak via timing.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(new Uint8Array(ab), new Uint8Array(bb))
}

/**
 * Plugin job runner (AGL-435): the deployment's scheduler (cloud cron,
 * uptime pinger, GitHub Action — anything that can POST on a beat) hits
 * this with the shared secret; due jobs run in-process with the same
 * registries the API dispatcher uses. Last-run marks live in ONE platform
 * doc, so due-ness survives cold starts; a job is due when
 * `now - lastRun >= intervalMinutes`. 501 without the secret configured —
 * scheduled jobs are opt-in per deployment.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.PLUGIN_JOBS_SECRET
  if (!secret) {
    return Response.json(
      { error: 'Plugin jobs are not configured (PLUGIN_JOBS_SECRET)' },
      { status: 501 },
    )
  }
  if (!safeEqual(request.headers.get('x-plugin-jobs-secret') ?? '', secret)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  await serverPluginLoader.ensureAll(['tenantApi'])
  const stateRef = firebaseAdmin
    .app()
    .firestore()
    .collection('platform')
    .doc('pluginJobs')
  const now = Date.now()
  // The beat fires every minute, and this read used to happen before anything
  // could be found due — 43,200 reads a month to be told nothing had changed
  // (AGL-1440). `readPluginJobLastRuns` serves a warm instance from memory and
  // re-reads on a bounded age; see that module for why a stale copy can only
  // make a job run early, never late.
  const lastRuns = await readPluginJobLastRuns({
    now,
    read: async () =>
      ((await stateRef.get()).data() ?? {}) as Record<string, number>,
  })

  // Release gate for BACKGROUND work (AGL-1689). Both API dispatchers subtract
  // a flagged-off plugin's routes; this runner subtracted nothing, so
  // `release_bookings` off still let `expire-stale-holds` rewrite booking
  // documents on its six-hour beat. A job is the one surface with no user to
  // notice it is still running, so it should be the FIRST thing a kill switch
  // stops, not the last — and the hole widens with every job added rather than
  // staying the size it was found at.
  //
  // Subject-less by nature: the beat has no request, no org and no host —
  // `expire-stale-holds` is a collection-group query across every site. So
  // `orgId: null`, which under AGL-1656 means the fully-enabled flags gate and
  // a partially-rolled-out plugin does not run its jobs at all. Deliberate: a
  // platform-wide sweep cannot be run for half the orgs, and declining is the
  // recoverable direction — a skipped beat is tidy-up deferred, where a run
  // during a partial rollout is a mutation applied to workspaces the rollout
  // has not reached.
  //
  // Unknown plugin ids pass through `filterPluginsByReleaseFlags` untouched, so
  // the `core` namespace that `publish-schedule-job` registers under — and any
  // marketplace plugin's job — is unaffected by this gate.
  const releasedJobPlugins = new Set(
    await filterEnabledPluginsByReleaseFlags(
      Array.from(new Set(listPluginJobs().map((job) => job.pluginId))),
      { orgId: null },
    ),
  )
  const heldByReleaseFlag = listPluginJobs()
    .filter((job) => !releasedJobPlugins.has(job.pluginId))
    .map(pluginJobKey)

  const results = await runPluginJobs((job) => {
    if (!releasedJobPlugins.has(job.pluginId)) return false
    const last = Number(lastRuns[pluginJobKey(job)] ?? 0)
    return now - last >= job.intervalMinutes * 60_000
  })

  if (results.length) {
    const keys = results.map((result) => result.key)
    // Firestore stays the source of truth across cold starts; the in-memory
    // copy is folded forward in the same breath so the next beat does not have
    // to go and read back what this one just wrote.
    await stateRef.set(
      Object.fromEntries(keys.map((key) => [key, now])),
      { merge: true },
    )
    recordPluginJobRuns(keys, now)
  }

  return Response.json(
    {
      registered: listPluginJobs().map(pluginJobKey),
      ran: results,
      // Withheld work, named (AGL-1689). Without this a flag-held job is
      // indistinguishable from one that simply was not due, which is the
      // failure mode that hides a kill switch left on: nothing runs, nothing
      // errors, and the beat keeps answering 200. Same instinct as
      // `contactsOverageWithheldUsd` on the usage rollup — say what did not
      // happen, not just what did.
      //
      // A held job records no last-run mark, so it becomes due the moment the
      // flag returns rather than waiting out an interval it spent refused.
      heldByReleaseFlag,
    },
    { status: 200 },
  )
}

export const dynamic = 'force-dynamic'
