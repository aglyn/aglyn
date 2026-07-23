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
import {
  isEmailConfigured,
  loadHostEmail,
  renderLoadedHostEmail,
  sendEmail,
  type LoadedHostEmail,
} from '@aglyn/shared-util-email'
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
  if (!isEmailConfigured()) {
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
    // Resolve each host's designed template once per run (AGL-770).
    const templateCache = new Map<string, LoadedHostEmail | null>()
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
      let loaded = templateCache.get(hostId)
      if (loaded === undefined) {
        loaded = await loadHostEmail(firestore, hostId, 'abandoned-cart')
        templateCache.set(hostId, loaded)
      }
      const designed = loaded
        ? renderLoadedHostEmail(loaded, {
            'cart.url': String(data.resumeUrl ?? ''),
          })
        : null
      await sendEmail({
        to: String(data.email),
        subject: designed?.subject ?? 'You left something in your cart',
        text:
          designed?.text ||
          'Your cart is still waiting — pick up where you left off:\n\n' +
            `${data.resumeUrl ?? ''}\n\n` +
            'Your items are held but not reserved, so they may sell out.',
        ...(designed?.html ? { html: designed.html } : {}),
        context: 'abandoned cart',
      })
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
