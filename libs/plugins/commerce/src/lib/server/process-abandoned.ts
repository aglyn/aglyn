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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'

const REMIND_AFTER_MS = 60 * 60 * 1000
const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Abandoned checkout recovery (AGL-323): scheduler-invoked (same
 * `x-cron-secret` convention as report-usage). Open checkouts with an
 * email that stalled for an hour get one recovery email with the
 * resume link; completion (AGL-296 webhook) closes the doc so reminders
 * stop. Pro-plan gated per host.
 */
export const processAbandonedHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(501).json({ error: 'Not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const resendKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.USAGE_EMAIL_FROM
  if (!resendKey || !emailFrom) {
    return res.status(501).json({ error: 'Email is not configured.' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const now = Date.now()
    // Collection-group over every host's checkouts.
    const openCheckouts = await firestore
      .collectionGroup('checkouts')
      .where('status', '==', 'open')
      .limit(200)
      .get()
    let sent = 0
    const entitledHosts = new Map<string, boolean>()
    for (const docSnapshot of openCheckouts.docs) {
      const data = docSnapshot.data() as any
      const createdAtMs = Number(data.createdAtMs ?? 0)
      if (!data.email || data.remindedAtMs) continue
      if (now - createdAtMs < REMIND_AFTER_MS) continue
      if (now - createdAtMs > GIVE_UP_AFTER_MS) {
        await docSnapshot.ref
          .set({ status: 'expired' }, { merge: true })
          .catch(() => undefined)
        continue
      }
      const hostId = docSnapshot.ref.parent.parent?.id
      if (!hostId) continue
      if (!entitledHosts.has(hostId)) {
        const org = await getOrgForHost(hostId).catch(() => null)
        entitledHosts.set(
          hostId,
          Aglyn.checkEntitlement(org?.org as any, 'abandonedCart'),
        )
      }
      if (!entitledHosts.get(hostId)) continue
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [String(data.email)],
          subject: 'You left something in your cart',
          text:
            'Your cart is still waiting — pick up where you left off:\n\n' +
            `${data.resumeUrl ?? ''}\n\n` +
            'Your items are held but not reserved, so they may sell out.',
        }),
      }).catch(() => undefined)
      await docSnapshot.ref
        .set({ remindedAtMs: now }, { merge: true })
        .catch(() => undefined)
      sent += 1
    }
    return res.status(200).json({ scanned: openCheckouts.size, sent })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Processing failed' })
  }
}
