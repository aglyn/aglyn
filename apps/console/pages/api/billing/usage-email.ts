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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res
      .status(501)
      .json({ error: 'Usage email is not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  const resendKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.USAGE_EMAIL_FROM
  if (!resendKey || !emailFrom) {
    return res.status(501).json({
      error:
        'Usage email is not configured (RESEND_API_KEY, USAGE_EMAIL_FROM).',
    })
  }
  const month = /^\d{4}-\d{2}$/.test(String(req.body?.month ?? ''))
    ? String(req.body.month)
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
      const lines = [
        `Here is your Aglyn usage summary for ${month}.`,
        '',
        `Plan: ${plan}`,
        `Storage: ${storageGb.toFixed(2)} GB`,
        `Page views: ${pageViews}`,
        `Form submissions: ${formSubmissions}`,
        `Metered usage estimate: ${formatUsd(costUsd)}`,
        '',
        'Full meters and plan limits: your console → Manage → Billing.',
      ]
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
          subject: `Your Aglyn usage summary for ${month}`,
          text: lines.join('\n'),
        }),
      })
      if (!response.ok) {
        console.error('usage email failed', orgId, await response.text())
        results[orgId] = { sent: false }
        continue
      }
      await rollup.ref.set(
        { emailedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      )
      results[orgId] = { sent: true }
    }
    return res.status(200).json({ month, orgs: results })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Usage email failed' })
  }
}
