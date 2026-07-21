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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { canActAsPublisher } from './publisher-profile'
import { listingArtifactType } from '../model/community'

/**
 * Installs a site template into a host (AGL-137): instantiates the
 * snapshot's screens with fresh ids, registers routing-map entries (slug
 * conflicts get numeric suffixes — existing screens are never touched),
 * and optionally applies the template theme. Access mirrors component
 * installs (free, purchased, or own listing); server-side because version
 * snapshots aren't client-readable.
 */
export const installTemplateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  const applyTheme = req.body?.applyTheme !== false
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
    if (
      !listing ||
      listing.deletedAt ||
      listingArtifactType(listing) !== 'template'
    ) {
      return res.status(404).json({ error: 'Unknown template' })
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
    const template = versionSnapshot.get('template') as any
    const screens: any[] = Array.isArray(template?.screens)
      ? template.screens
      : []
    if (!screens.length) {
      return res.status(500).json({ error: 'Template version missing' })
    }

    // Screen quota via the owning org — enforced for every org, since a
    // plan-less org resolves as `free` (not unmetered).
    const org = (await getOrgForHost(hostId))?.org
    {
      const count = (
        await hostRef.collection('screens').count().get()
      ).data().count
      const quota = checkQuota(
        org as any,
        'screensPerHost',
        count + screens.length - 1,
      )
      if (!quota.allowed) {
        return res.status(403).json({
          error:
            `This template needs ${screens.length} screens — your plan ` +
            `allows ${quota.limit}. See Billing to upgrade.`,
        })
      }
    }

    const routingMap = (hostSnapshot.get('screens') ?? {}) as Record<
      string,
      string
    >
    const usedSlugs = new Set(Object.values(routingMap))
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    const routingUpdates: Record<string, string> = {}
    let created = 0
    for (const screen of screens) {
      const screenId = createResourceUid()
      const versionId = createResourceUid()
      let slug = String(screen.slug ?? '') || 'page'
      let attempt = 2
      while (usedSlugs.has(slug)) slug = `${screen.slug || 'page'}-${attempt++}`
      usedSlugs.add(slug)

      await hostRef.collection('screens').doc(screenId).set({
        displayName: String(screen.displayName ?? 'Screen').slice(0, 80),
        ...(screen.description && { description: screen.description }),
        ...(screen.seo && { seo: screen.seo }),
        versionId,
        createdAt: now,
        updatedAt: now,
      })
      await hostRef
        .collection('screens')
        .doc(screenId)
        .collection('versions')
        .doc(versionId)
        .set({
          screenId,
          displayName: 'Installed from template',
          nodes: screen.nodes,
          createdAt: now,
          updatedAt: now,
        })
      routingUpdates[`screens.${screenId}`] = slug
      created += 1
    }
    await hostRef.update({
      ...routingUpdates,
      ...(applyTheme && template.theme ? { theme: template.theme } : {}),
      updatedAt: now,
    })

    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      screens: created,
      themeApplied: Boolean(applyTheme && template.theme),
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Template install failed' })
  }
}
