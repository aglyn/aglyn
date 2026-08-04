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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  VERIFICATION_BLOCK_MESSAGES,
  verificationRequestBlock,
} from '../model/marketplace'
import { canActAsPublisher } from './publisher-profile'

/**
 * A publisher asking for — or taking back — the Verified badge (AGL-1217).
 *
 * Asking grants nothing. This route only ever moves the request between
 * `pending` and `withdrawn`; the checklist gate on the staff `verify` action
 * stays the single route to the badge itself. That separation is the whole
 * safety property here, because this endpoint is reachable by any publisher.
 *
 * Eligibility is decided by `verificationRequestBlock`, the same function the
 * button calls. Sharing it is the point: a client-side rule the server does
 * not enforce is decoration, and a server rule the client does not know
 * produces a button that fails with no explanation.
 */
export const verificationRequestHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const listingId = String(req.body?.listingId ?? '').trim()
  const action = String(req.body?.action ?? 'request')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  if (action !== 'request' && action !== 'withdraw') {
    return res.status(400).json({ error: 'Unknown action' })
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const listingRef = firestore.collection('marketplaceListings').doc(listingId)

    const listing = (await listingRef.get()).data()
    if (!listing) return res.status(404).json({ error: 'Unknown listing' })

    // Membership of the PUBLISHING org, resolved from the listing rather than
    // from anything the caller sent. A client-supplied orgId here would let a
    // publisher of one listing act on another.
    const publisherOrgId = String(listing.profileId ?? '')
    if (
      !publisherOrgId ||
      !(await canActAsPublisher(firestore, decoded.uid, publisherOrgId))
    ) {
      // 404, not 403: a listing the caller does not publish should not be
      // confirmed to exist by the shape of the refusal.
      return res.status(404).json({ error: 'Unknown listing' })
    }

    if (action === 'withdraw') {
      if (listing.verificationRequest?.state !== 'pending') {
        return res.status(409).json({ error: 'No request is waiting' })
      }
      await listingRef.set(
        {
          verificationRequest: {
            ...listing.verificationRequest,
            state: 'withdrawn',
            decidedAt: FieldValue.serverTimestamp(),
            // The publisher decided this one, so `decidedBy` is them. Staff
            // uids and publisher uids share the field because the question it
            // answers — who ended this request — has one answer either way.
            decidedBy: decoded.uid,
          },
        },
        { merge: true },
      )
      return res.status(200).json({ ok: true, state: 'withdrawn' })
    }

    // Re-checked in a transaction rather than trusting the read above: two
    // tabs pressing the button together would otherwise both pass the check
    // and the second would overwrite the first request's timestamp, resetting
    // its place in the queue.
    const outcome = await firestore.runTransaction(async (tx) => {
      const fresh = (await tx.get(listingRef)).data()
      if (!fresh) return { error: 'Unknown listing', status: 404 } as const
      // `viewerOrgId` is fed the listing's own `profileId` on purpose, which
      // makes the `not-publisher` branch unreachable here. That is NOT the
      // authorization check — `canActAsPublisher` above is, and it ran against
      // the caller's uid. This call is asking the remaining question: is the
      // listing in a state that can carry a request right now.
      const blocked = verificationRequestBlock({
        listing: fresh as never,
        viewerOrgId: String(fresh.profileId ?? ''),
        nowMs: Date.now(),
      })
      if (blocked) {
        return {
          error: VERIFICATION_BLOCK_MESSAGES[blocked],
          reason: blocked,
          status: 409,
        } as const
      }
      tx.set(
        listingRef,
        {
          verificationRequest: {
            state: 'pending',
            requestedAt: FieldValue.serverTimestamp(),
            requestedBy: decoded.uid,
            // Explicitly cleared, because `merge: true` deep-merges MAPS.
            // Without these a re-request after a decline would keep the old
            // `declineReason` and `decidedBy`, and the staff queue would show
            // a brand-new pending request already carrying a verdict.
            decidedAt: FieldValue.delete(),
            decidedBy: FieldValue.delete(),
            declineReason: FieldValue.delete(),
          },
        },
        { merge: true },
      )
      return { ok: true } as const
    })

    if ('error' in outcome) {
      return res
        .status(outcome.status)
        .json({ error: outcome.error, reason: outcome.reason })
    }
    return res.status(200).json({ ok: true, state: 'pending' })
  } catch (error) {
    console.error('verification-request failed', error)
    return res.status(401).json({ error: 'Unauthenticated' })
  }
}
