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

// lockdown-423: exempt — server-internal cron (x-cron-secret) with no user
// caller and no org of its own; it asks the ai-generate switch, which
// composes the platform lock, before it claims a step.

import { writeCronBeat } from '@aglyn/aglyn/server'
import { firebaseAdmin, safeEqual } from '@aglyn/tenant-data-admin'
import { AI_JOBS_BEAT_CRON_ID, runAiJobsBeat } from '../jobs/ai-jobs-beat'

/**
 * THE AI JOBS BEAT (AGL-3026): `POST /api/admin/ai-jobs-beat`.
 *
 * Cloud Scheduler calls it every minute through `consoleAiJobsBeat` in
 * `cloud/functions`, carrying the console's `CRON_SECRET` as
 * `x-cron-secret`: the same secret, headers and refusals as the console's
 * other scheduled sweeps, so rotating the secret is still one act. It answers
 * 405 to anything but a POST, 501 while the secret is unset, so an
 * unconfigured deployment cannot be made to spend, and 401 for anything but
 * the secret.
 *
 * The console app serves it from a route of its own at the same path, which
 * gives a sweep the function time the slowest step needs; the plugin
 * dispatcher's ceiling is a door's. See `AI_JOB_SWEEP_BUDGET_MS`.
 *
 * It answers 200 with what the beat did, a beat the switch held included:
 * a lock is an operator's decision rather than a fault, and the caller logs
 * every refusal it gets.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json(
      { error: 'The AI jobs beat is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  // Either spelling the console's scheduled routes accept (`cron-auth.ts`):
  // the header an external scheduler sends, or a bearer.
  if (
    !safeEqual(request.headers.get('x-cron-secret'), secret) &&
    !safeEqual(request.headers.get('authorization'), `Bearer ${secret}`)
  ) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // The mark `/api/health/crons` reads to notice this job going away
  // (AGL-1955). Stamped on the invocation rather than on the work, and before
  // the switch: a beat the switch holds is still a beat that fired, and an
  // idle queue looks exactly like a dead schedule otherwise.
  await writeCronBeat(firebaseAdmin.app().firestore(), AI_JOBS_BEAT_CRON_ID)
  try {
    return Response.json(await runAiJobsBeat(), { status: 200 })
  } catch (error) {
    // A step's own failure is isolated inside the sweep; this is the queue
    // read or the switch itself failing, and the next beat asks again.
    console.error('ai jobs beat failed', error)
    return Response.json({ error: 'The AI jobs beat failed' }, { status: 500 })
  }
}
