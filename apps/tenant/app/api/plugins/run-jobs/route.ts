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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { timingSafeEqual } from 'crypto'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'

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
  const lastRuns = ((await stateRef.get()).data() ?? {}) as Record<
    string,
    number
  >
  const now = Date.now()

  const results = await runPluginJobs((job) => {
    const last = Number(lastRuns[pluginJobKey(job)] ?? 0)
    return now - last >= job.intervalMinutes * 60_000
  })

  if (results.length) {
    await stateRef.set(
      Object.fromEntries(results.map((result) => [result.key, now])),
      { merge: true },
    )
  }

  return Response.json(
    {
      registered: listPluginJobs().map(pluginJobKey),
      ran: results,
    },
    { status: 200 },
  )
}

export const dynamic = 'force-dynamic'
