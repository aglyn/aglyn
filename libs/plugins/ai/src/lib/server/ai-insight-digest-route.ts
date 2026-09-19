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
// caller; it asks each workspace's ai-generate pause before it creates a job,
// and the jobs it creates are held by the same pause on the beat.

import { writeCronBeat } from '@aglyn/aglyn/app-utils/health-report'
import { rateLimitedRetryAtMs, sendEmail } from '@aglyn/shared-util-email'
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import { meterPlatformEmail } from '@aglyn/tenant-data-admin/server/email-metering'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { featureLockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { notifyUsers } from '@aglyn/tenant-data-admin/server/notifications'
import { listOrgMembers, memberHasPermissionOnHost } from '@aglyn/tenant-data-admin/server/organizations'
import { getServerReleaseFlagValues } from '@aglyn/tenant-data-admin/server/release-flags'
import { safeEqual } from '@aglyn/tenant-data-admin/server/safe-equal'
import {
  AI_INSIGHTS_DIGEST_CRON_ID,
  runAiInsightDigestSweep,
  type AiInsightDigestDeps,
} from '../insights/ai-insight-digest'

/**
 * The weekly insights' scheduled route (AGL-2915):
 * `POST /api/admin/ai-insights-digest`.
 *
 * Cloud Scheduler calls it at 06:00 and 14:00 UTC through
 * `consoleAiInsightsDigest` in `cloud/functions`, on the console's
 * `CRON_SECRET`: 501 while the secret is unset, 401 without it. Monday's
 * first run makes the week's digests, which the AI jobs beat then writes, and
 * every run after it delivers what is written — see `ai-insight-digest.ts`.
 * `/api/admin/` is the path because the console's edge lets the cron secret's
 * header through there. It stamps `ai-insights-digest` for
 * `/api/health/crons` on every authorized call.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'The weekly insights are not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (
    !safeEqual(request.headers.get('x-cron-secret'), secret) &&
    !safeEqual(request.headers.get('authorization'), `Bearer ${secret}`)
  ) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const firestore = firebaseAdmin.app().firestore()
  // The inventory row's id, written out: `cron-beat-wiring.spec.ts` finds a
  // job's stamp by the quoted id beside the call.
  await writeCronBeat(firestore, 'ai-insights-digest' satisfies typeof AI_INSIGHTS_DIGEST_CRON_ID)

  let cursor: string | null = null
  try {
    const body = (await request.json()) as { cursor?: unknown } | null
    const raw = body?.cursor
    cursor = typeof raw === 'string' && raw && !raw.includes('/') ? raw : null
  } catch {
    // A bodyless POST is the first call of a run.
  }

  try {
    // The platform switch holds the whole run, as it holds the jobs beat.
    if (await featureLockdownRefusal({ feature: 'ai-generate' })) {
      return Response.json({ held: true, done: true, nextCursor: null }, { status: 200 })
    }
    const flags = await getServerReleaseFlagValues()
    const deps: AiInsightDigestDeps = {
      firestore,
      now: new Date(),
      flagValue: flags['release_ai_generative'],
      listMembers: listOrgMembers,
      mayGenerate: (orgId, hostId, member) => memberHasPermissionOnHost(orgId, hostId, member, 'ai.generate'),
      paused: async (orgId) => Boolean(await featureLockdownRefusal({ feature: 'ai-generate', orgId })),
      notify: (uid, payload) => notifyUsers([uid], { type: 'content.insightsDigest', ...payload }),
      send: async (email) => {
        const recipients = await filterSuppressedEmails([email.to], firestore)
        if (!recipients.length) return { sent: false, rateLimited: false }
        const result = await sendEmail({
          to: recipients,
          subject: email.subject,
          text: email.text,
          fromName: email.fromName,
          context: 'ai-insights-digest',
          priority: 'bulk',
        })
        if (result.sent) {
          await meterPlatformEmail().catch(() => undefined)
          return { sent: true, rateLimited: false }
        }
        return { sent: false, rateLimited: rateLimitedRetryAtMs(result) !== null }
      },
      // An email link must be absolute; with no console URL configured the
      // digest says where to look without one.
      consoleOrigin: (process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim().replace(/\/+$/, ''),
    }
    const report = await runAiInsightDigestSweep(deps, { cursor })
    return Response.json(report, { status: 200 })
  } catch (error) {
    console.error('ai insights digest run failed', error)
    return Response.json({ error: 'The weekly insights run failed' }, { status: 500 })
  }
}
