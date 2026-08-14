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

import { createResourceUid } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { canActAsPublisher } from './publisher-profile'
import { hasDivergedFromBase, recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'

/**
 * Installs (or updates) a marketplace listing into a host (AGL-44/46).
 * Server-side because version snapshots are not client-readable — paid
 * content would otherwise be free to anyone who read the subcollection.
 * Access: the listing is free, the caller bought it (webhook-written
 * purchase record), or the caller published it. Installing copies the
 * latest version into `hosts/{hostId}/components` with `marketplace` source
 * metadata; re-installing updates the same component doc in place.
 */
export const installHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  if (!listingId || !hostId) {
    return res.status(400).json({ error: 'Missing listingId or hostId' })
  }
  const authorization = String(req.headers.authorization ?? '')
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
        error: 'Your organization role does not allow installing from the marketplace',
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
      .collection('marketplaceListings')
      .doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    // The publisher installs their own listing for free. Org-owned now
    // (AGL-652), so this is a role check — comparing a uid to an org id
    // would never match and would charge publishers for their own work.
    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    if (priceUsd > 0 && !ownsListing) {
      // A FULLY refunded purchase no longer entitles (AGL-1546) — the
      // webhook stamps `refundedAt` on `charge.refunded`. Fetch a few and
      // require one live record rather than filtering in the query: a
      // "refundedAt == null" predicate cannot match docs missing the
      // field, and every pre-AGL-1546 purchase is missing it. A re-buy
      // after a refund writes a fresh session-keyed doc, so a legitimate
      // second purchase still installs.
      const purchases = await firestore
        .collection('marketplacePurchases')
        .where('buyerUid', '==', decoded.uid)
        .where('listingId', '==', listingId)
        .limit(10)
        .get()
      const hasLivePurchase = purchases.docs.some(
        (purchase) => !purchase.get('refundedAt'),
      )
      if (!hasLivePurchase) {
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
      .where('marketplace.listingId', '==', listingId)
      .limit(1)
      .get()
    const componentRef = existing.empty
      ? componentsRef.doc(createResourceUid())
      : existing.docs[0].ref
    // Re-installing over a copy the workspace has EDITED is the silent
    // destructive overwrite AGL-1018 exists to stop. The install still happens
    // when it is asked for explicitly (`mode: 'replace'`, which the update
    // dialog sends after showing what goes), but it is never the default.
    if (!existing.empty) {
      const diverged = await hasDivergedFromBase({
        firestore,
        sha256: existing.docs[0].get('installedFrom.sha256'),
        current: {
          rootId: existing.docs[0].get('rootId'),
          nodes: existing.docs[0].get('nodes'),
        },
      })
      if (diverged && req.body?.mode !== 'replace') {
        return res.status(409).json({
          error:
            'Your copy of this component has been edited since it was ' +
            'installed. Review the update to see what would change.',
          diverged: true,
        })
      }
    }
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Provenance + base snapshot (AGL-1015). The snapshot holds only the
    // vendored tree — the display name and description come from the listing
    // and the user may rename their copy, so including them would make every
    // rename read as a diverged component.
    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version: listing.latestVersion,
      artifactType: 'component',
      content: { rootId: version.rootId, nodes: version.nodes },
    })
    await componentRef.set(
      {
        displayName: listing.displayName,
        ...(listing.description && { description: listing.description }),
        rootId: version.rootId,
        nodes: version.nodes,
        deletedAt: null,
        marketplace: {
          listingId,
          profileId: listing.profileId,
          version: listing.latestVersion,
        },
        installedFrom: provenance.installedFrom,
        ...(existing.empty && { createdAt: now }),
        updatedAt: now,
      },
      { merge: true },
    )
    // Per-version tally (AGL-1036): a re-install moves this copy off whatever
    // version it was on and onto the latest.
    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'component',
      from: existing.empty
        ? null
        : (existing.docs[0].get('installedFrom.version') ??
          existing.docs[0].get('marketplace.version')),
      to: listing.latestVersion,
    })
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
      baseStored: provenance.baseStored,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Install failed' })
  }
}
