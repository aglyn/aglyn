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

import { createResourceUid } from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveOrgPermissions } from '../../../utils/server/org-permissions'

/**
 * Installs (or updates) a community listing into a host (AGL-44/46).
 * Server-side because version snapshots are not client-readable — paid
 * content would otherwise be free to anyone who read the subcollection.
 * Access: the listing is free, the caller bought it (webhook-written
 * purchase record), or the caller published it. Installing copies the
 * latest version into `hosts/{hostId}/components` with `community` source
 * metadata; re-installing updates the same component doc in place.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  if (!listingId || !hostId) {
    return res.status(400).json({ error: 'Missing listingId or hostId' })
  }
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    // Org-role permission gate (AGL-238).
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.installPlugins) {
      return res.status(403).json({
        error: 'Your organization role does not allow installing from the community',
      })
    }
    const firestore = firebaseAdmin.app().firestore()

    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    const listingRef = firestore
      .collection('communityListings')
      .doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    if (priceUsd > 0 && listing.profileId !== decoded.uid) {
      const purchases = await firestore
        .collection('communityPurchases')
        .where('buyerUid', '==', decoded.uid)
        .where('listingId', '==', listingId)
        .limit(1)
        .get()
      if (purchases.empty) {
        return res
          .status(402)
          .json({ error: 'Purchase required', priceUsd })
      }
    }

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    const version = versionSnapshot.data() as any
    if (!version?.nodes || !version?.rootId) {
      return res.status(500).json({ error: 'Listing version missing' })
    }

    const componentsRef = hostRef.collection('components')
    const existing = await componentsRef
      .where('community.listingId', '==', listingId)
      .limit(1)
      .get()
    const componentRef = existing.empty
      ? componentsRef.doc(createResourceUid())
      : existing.docs[0].ref
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    await componentRef.set(
      {
        displayName: listing.displayName,
        ...(listing.description && { description: listing.description }),
        rootId: version.rootId,
        nodes: version.nodes,
        deletedAt: null,
        community: {
          listingId,
          profileId: listing.profileId,
          version: listing.latestVersion,
        },
        ...(existing.empty && { createdAt: now }),
        updatedAt: now,
      },
      { merge: true },
    )
    // First installs count toward the browse "Most installed" sort
    // (AGL-95); updates don't inflate it.
    if (existing.empty) {
      await listingRef
        .update({
          installCount: firebaseAdmin.firestore.FieldValue.increment(1),
        })
        .catch(() => undefined)
    }
    return res.status(200).json({
      installed: true,
      updated: !existing.empty,
      version: listing.latestVersion,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Install failed' })
  }
}
