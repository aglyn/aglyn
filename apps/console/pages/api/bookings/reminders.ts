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

/**
 * Booking reminder emails (AGL-160): invoke hourly from the scheduler
 * with `x-cron-secret`. Finds confirmed bookings starting 23–25 hours out
 * (collection-group query, so one call covers every host), emails each
 * visitor through the env-gated Resend path, and stamps `reminderSentAt`
 * so re-runs are idempotent. 501 without the email config, matching
 * report-usage/usage-email.
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
      .json({ error: 'Reminders are not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  const resendKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.USAGE_EMAIL_FROM
  if (!resendKey || !emailFrom) {
    return res.status(501).json({
      error: 'Reminders are not configured (RESEND_API_KEY, USAGE_EMAIL_FROM).',
    })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const windowStart = Date.now() + 23 * 60 * 60 * 1000
    const windowEnd = Date.now() + 25 * 60 * 60 * 1000
    const upcoming = await firestore
      .collectionGroup('bookings')
      .where('startsAtMs', '>=', windowStart)
      .where('startsAtMs', '<=', windowEnd)
      .limit(500)
      .get()

    let sent = 0
    let skipped = 0
    for (const doc of upcoming.docs) {
      const data = doc.data()
      if (
        data['status'] === 'canceled' ||
        data['reminderSentAt'] ||
        !data['email']
      ) {
        skipped += 1
        continue
      }
      const when = new Date(Number(data['startsAtMs'])).toLocaleString(
        'en-US',
        { dateStyle: 'full', timeStyle: 'short' },
      )
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [data['email']],
          subject: `Reminder: ${data['serviceName'] ?? 'your booking'} tomorrow`,
          text:
            `Hi ${data['name'] ?? ''},\n\nA reminder that "${
              data['serviceName'] ?? 'your booking'
            }" is scheduled for ${when}.\n\nReference: ${doc.id}`,
        }),
      }).catch(() => null)
      if (response?.ok) {
        sent += 1
        await doc.ref
          .set(
            {
              reminderSentAt:
                firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => undefined)
      }
    }
    return res.status(200).json({ scanned: upcoming.size, sent, skipped })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reminders failed' })
  }
}
