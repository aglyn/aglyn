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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { createHash } from 'crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

const MAX_REASON_LENGTH = 1000

/**
 * Report a listing or a review for staff attention (AGL-658).
 *
 * Pre-publication review is plugin-only and stays that way — plugins
 * execute code, so they earn the wait, while a component or template is
 * inert until someone installs it. But "inert" is not "harmless": a
 * template carries a whole screen tree into someone else's org. So
 * everything is reportable after the fact, which is the posture the
 * catalogue can actually sustain as it grows.
 *
 * One report per reporter per target: the doc id is derived, so reporting
 * twice updates rather than letting one account inflate a queue.
 */
export const reportHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const reviewUid = String(req.body?.reviewUid ?? '')
  const reason = String(req.body?.reason ?? '')
    .trim()
    .slice(0, MAX_REASON_LENGTH)
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  if (!reason) return res.status(400).json({ error: 'Add a reason' })

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const listingSnapshot = await firestore
      .collection('marketplaceListings')
      .doc(listingId)
      .get()
    if (!listingSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown listing' })
    }

    const targetType = reviewUid ? 'review' : 'listing'
    // Deterministic id, so a second report from the same account on the
    // same target UPDATES rather than stacking — one person must not be
    // able to make something look widely reported. Hashed because the
    // parts can contain characters Firestore rejects in a doc id.
    const reportId = createHash('sha256')
      .update(`${decoded.uid}:${listingId}:${reviewUid || 'listing'}`)
      .digest('hex')
      .slice(0, 40)
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    await firestore
      .collection('marketplaceReports')
      .doc(reportId)
      .set(
        {
          targetType,
          listingId,
          ...(reviewUid ? { reviewUid } : {}),
          // The verified token, never a client-supplied uid.
          reporterUid: decoded.uid,
          reason,
          status: 'open',
          listingName: listingSnapshot.get('displayName') ?? '',
          publisherOrgId: listingSnapshot.get('profileId') ?? null,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      )

    return res.status(200).json({ ok: true, targetType })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Report failed' })
  }
}

export default reportHandler
