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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/** Previous calendar month as YYYY-MM (the default summary target). */
function previousMonth(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

function formatUsd(costUsd: number) {
  return `$${costUsd.toFixed(2)}`
}

/**
 * Monthly usage email summary (AGL-98, item 3). Invoke from the same
 * scheduler as `report-usage` (after it, so rollups exist) with
 * `x-cron-secret`. Env-gated on the email provider: without
 * `RESEND_API_KEY` + `USAGE_EMAIL_FROM` the route answers 501 and sends
 * nothing. Per plan-gated tenant with a rollup for the month it emails the
 * account address one summary (storage, page views, form submissions,
 * metered estimate) and stamps `emailedAt` on the rollup so re-runs are
 * idempotent.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Usage email is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  if (!isEmailConfigured()) {
    return Response.json({
      error:
        'Usage email is not configured (RESEND_API_KEY, USAGE_EMAIL_FROM).',
    }, { status: 501 })
  }
  const month = /^\d{4}-\d{2}$/.test(String(body?.month ?? ''))
    ? String(body.month)
    : previousMonth()

  try {
    const firestore = firebaseAdmin.app().firestore()
    const auth = firebaseAdmin.app().auth()
    // Org usage rollups (AGL-238): orgs/{orgId}/usage/{month}, emailed to
    // the org owner's account address.
    const orgsSnapshot = await firestore.collection('orgs').limit(1000).get()

    const results: Record<string, any> = {}
    for (const orgDoc of orgsSnapshot.docs) {
      const orgId = orgDoc.id
      const rollup = await orgDoc.ref.collection('usage').doc(month).get()
      if (!rollup.exists) continue
      if (rollup.get('emailedAt')) {
        results[orgId] = { skipped: 'already emailed' }
        continue
      }
      // Dark-launch rule: only orgs with an explicit plan get billing
      // email; everyone else isn't metered in any user-visible way yet.
      const plan = orgDoc.get('plan')
      if (!plan) {
        results[orgId] = { skipped: 'no plan' }
        continue
      }
      const ownerUid = String(orgDoc.get('ownerUid') ?? '')
      const email = ownerUid
        ? await auth
            .getUser(ownerUid)
            .then((user) => user.email)
            .catch(() => undefined)
        : undefined
      if (!email) {
        results[orgId] = { skipped: 'no email' }
        continue
      }

      const storageGb = Number(rollup.get('storageGb') ?? 0)
      const pageViews = Number(rollup.get('pageViews') ?? 0)
      const formSubmissions = Number(rollup.get('formSubmissions') ?? 0)
      const costUsd = Number(rollup.get('costUsd') ?? 0)
      const dataStorageMb = Number(rollup.get('dataStorageMb') ?? 0)
      const dataOverageUsd = Number(rollup.get('dataOverageUsd') ?? 0)
      const lines = [
        `Here is your Aglyn usage summary for ${month}.`,
        '',
        `Plan: ${plan}`,
        `Storage: ${storageGb.toFixed(2)} GB`,
        `Page views: ${pageViews}`,
        `Form submissions: ${formSubmissions}`,
        `Dataset storage: ${(dataStorageMb / 1024).toFixed(2)} GB` +
          (dataOverageUsd > 0
            ? ` (overage ${formatUsd(dataOverageUsd)})`
            : ''),
        `Metered usage estimate: ${formatUsd(costUsd + dataOverageUsd)}`,
        '',
        'Full meters and plan limits: your console → Manage → Billing.',
      ]
      const result = await sendEmail({
        to: email,
        subject: `Your Aglyn usage summary for ${month}`,
        text: lines.join('\n'),
        context: `usage summary (${orgId})`,
      })
      if (!result.sent) {
        results[orgId] = { sent: false }
        continue
      }
      await rollup.ref.set(
        { emailedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      )
      results[orgId] = { sent: true }
    }
    return Response.json({ month, orgs: results }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Usage email failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
