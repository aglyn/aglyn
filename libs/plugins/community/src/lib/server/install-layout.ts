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

import { checkQuota, createResourceUid } from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { listingArtifactType } from '../model/community'
import { canActAsPublisher } from './publisher-profile'

/**
 * Installs a marketplace layout into a host's template library (AGL-671).
 *
 * Lands as a `kind: 'layout'` template rather than a live layout, for the
 * same reason template installs do (AGL-669): installing must never change
 * a running site. Creating the actual layout is the deliberate second step
 * in the templates library.
 *
 * Access mirrors template installs: free, purchased, or your own listing.
 */
export const installLayoutHandler: PluginApiHandler = async (req, res) => {
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
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.installPlugins) {
      return res.status(403).json({
        error:
          'Your organization role does not allow installing from the community',
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

    const listingRef = firestore.collection('communityListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      listingArtifactType(listing) !== 'layout'
    ) {
      return res.status(404).json({ error: 'Unknown layout' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    if (priceUsd > 0 && !ownsListing) {
      const purchases = await firestore
        .collection('communityPurchases')
        .where('buyerUid', '==', decoded.uid)
        .where('listingId', '==', listingId)
        .limit(1)
        .get()
      if (purchases.empty) {
        return res.status(402).json({ error: 'Purchase required', priceUsd })
      }
    }

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    const layout = versionSnapshot.get('layout') as any
    if (!layout?.nodes || !Object.keys(layout.nodes).length) {
      return res.status(500).json({ error: 'Layout version missing' })
    }

    const org = (await getOrgForHost(hostId))?.org
    const existing = await hostRef.collection('templates').get()
    const count = existing.docs.filter(
      (entry) =>
        !entry.get('deletedAt') && entry.get('source.listingId') !== listingId,
    ).length
    const quota = checkQuota(org as any, 'templatesPerHost', count)
    if (!quota.allowed) {
      return res.status(403).json({
        error:
          `Your plan allows ${quota.limit} templates — see Billing to upgrade.`,
      })
    }

    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Re-install replaces the prior copy rather than stacking (AGL-671).
    const batch = firestore.batch()
    let replaced = 0
    for (const stale of existing.docs) {
      if (stale.get('deletedAt')) continue
      if (stale.get('source.listingId') !== listingId) continue
      batch.update(stale.ref, { deletedAt: now, updatedAt: now })
      replaced += 1
    }
    const templateRef = hostRef.collection('templates').doc(createResourceUid())
    batch.set(templateRef, {
      kind: 'layout',
      displayName: String(listing.displayName ?? 'Layout').slice(0, 80),
      ...(listing.description && { description: listing.description }),
      rootId: layout.rootId,
      nodes: layout.nodes,
      source: {
        type: 'marketplace' as const,
        listingId,
        version: listing.latestVersion ?? null,
      },
      createdAt: now,
      updatedAt: now,
    })
    await batch.commit()

    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      templates: 1,
      replaced,
      version: listing.latestVersion ?? null,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Layout install failed' })
  }
}

export default installLayoutHandler
