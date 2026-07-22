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
 * Installs a site template into a host's TEMPLATE LIBRARY (AGL-137,
 * reworked by AGL-669).
 *
 * This used to instantiate screens and write routing-map entries in the
 * same call, which made installed pages public the instant you clicked
 * install — browsing the marketplace could publish to a production site by
 * mis-click. Now it only writes to `hosts/{hostId}/templates`; creating
 * pages is a separate, deliberate step (AGL-670).
 *
 * The snapshot's screens become one page template each, sharing a
 * `source.listingId` so the library can group them and the user can pick
 * which ones to use. The theme is carried on the templates rather than
 * applied — a theme change is site-wide and instant, the same class of
 * surprise this removed.
 *
 * Access is unchanged: free, purchased, or your own listing. Still
 * server-side because version snapshots are not client-readable.
 */
export const installTemplateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  // `applyTheme` is accepted and ignored (AGL-669): installing no longer
  // touches the host doc, so there is nothing to apply. Kept in the
  // signature so existing callers don't break.
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

    // Template-library quota, not screensPerHost: nothing becomes a screen
    // here. The screen cap is enforced later, when pages are actually
    // created from these (AGL-670). Enforced for every org, since a
    // plan-less org resolves as `free` (not unmetered).
    const org = (await getOrgForHost(hostId))?.org
    {
      const existing = await hostRef.collection('templates').get()
      // Templates from THIS listing are about to be replaced, so counting
      // them would make a re-install look like it doubles the library and
      // fail the quota on an update the user is entitled to.
      // Platform-seeded starters are excluded for the same reason the
      // resources route excludes them (AGL-687): they are not the user's
      // spend of their template allowance.
      const count = existing.docs.filter(
        (entry) =>
          !entry.get('deletedAt') &&
          entry.get('source.type') !== 'starter' &&
          entry.get('source.listingId') !== listingId,
      ).length
      const quota = checkQuota(
        org as any,
        'templatesPerHost',
        count + screens.length - 1,
      )
      if (!quota.allowed) {
        return res.status(403).json({
          error:
            `This template adds ${screens.length} template${
              screens.length === 1 ? '' : 's'
            } to your library — your plan allows ${quota.limit}. ` +
            'See Billing to upgrade.',
        })
      }
    }

    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Shared across the bundle so the library can group these as one
    // install and offer them together.
    const source = {
      type: 'marketplace' as const,
      listingId,
      version: listing.latestVersion ?? null,
    }
    // Re-installing the same listing REPLACES its previous bundle rather
    // than stacking a second copy (AGL-671) — that is what makes "Update
    // available" actionable with no separate refresh route.
    //
    // Matching old templates to new ones individually is not possible: a
    // published snapshot's screens carry no stable identity, only a
    // displayName and slug, so any pairing would be a guess. Replacing the
    // bundle wholesale is honest about that. Pages already created from the
    // old templates are untouched — they are ordinary screens with no link
    // back.
    const superseded = await hostRef
      .collection('templates')
      .where('source.listingId', '==', listingId)
      .get()
    const batch = firestore.batch()
    let replaced = 0
    for (const stale of superseded.docs) {
      if (stale.get('deletedAt')) continue
      batch.update(stale.ref, { deletedAt: now, updatedAt: now })
      replaced += 1
    }
    let created = 0
    for (const screen of screens) {
      const templateRef = hostRef.collection('templates').doc(createResourceUid())
      batch.set(templateRef, {
        kind: 'page',
        displayName: String(screen.displayName ?? 'Page').slice(0, 80),
        ...(screen.description && { description: screen.description }),
        ...(screen.seo && { seo: screen.seo }),
        // A suggestion only — de-conflicted against the routing map when a
        // page is actually created from this.
        ...(screen.slug && { slug: String(screen.slug) }),
        nodes: screen.nodes,
        // Carried, not applied: see the note on AglynTemplate.theme. The
        // `applyTheme` request flag is now meaningless here — nothing is
        // applied at install — so the theme always travels with the
        // template and the decision moves to whoever uses it.
        ...(template.theme ? { theme: template.theme } : {}),
        source,
        createdAt: now,
        updatedAt: now,
      })
      created += 1
    }
    await batch.commit()

    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      templates: created,
      /** Prior templates from this listing, superseded by this install. */
      replaced,
      version: listing.latestVersion ?? null,
      // Retained so an older client doesn't render "Added undefined screens".
      screens: 0,
      themeApplied: false,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Template install failed' })
  }
}
