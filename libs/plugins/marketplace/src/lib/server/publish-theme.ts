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

import { checkEntitlement, createResourceUid } from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import {
  themeArtifactContent,
  validateThemeForPublish,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { resolvePublisherProfile } from './publisher-profile'

/**
 * Publishes a site's theme to the marketplace (AGL-1020).
 *
 * A theme is the one artifact that is pure data — no nodes, no code, no
 * bundle — so it needs no sanitizer allowlist the way a component tree does.
 * What it needs instead is validation of the two things that make an installed
 * theme unusable, and both are refused here rather than caught in review:
 * a missing colour scheme, and text nobody can read. See
 * `validateThemeForPublish` for why those two and not others.
 *
 * The theme is stored as a field on the host document, not as its own
 * collection, so unlike every other publish route there is no artifact id to
 * pick — the site IS the selection. That also makes the listing key
 * `sourceThemeHostId`, so re-publishing the same site's theme bumps its version
 * rather than opening a second listing.
 *
 * Gates mirror `publish-layout` exactly: org permission, host role,
 * `marketplaceSelling`, a publisher profile, and payouts before anything sells.
 */
export const publishThemeHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const displayName = String(req.body?.displayName ?? '')
  const description = String(req.body?.description ?? '')
  const category = String(req.body?.category ?? '')
  const priceUsd = Math.max(0, Math.round(Number(req.body?.priceUsd ?? 0)))
  if (!hostId || !displayName.trim()) {
    return res.status(400).json({ error: 'Missing hostId or displayName' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.publishToMarketplace) {
      return res.status(403).json({
        error:
          'Your organization role does not allow publishing to the marketplace',
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

    const orgForHost = await getOrgForHost(hostId)
    const org = orgForHost?.org ?? {}
    if (!checkEntitlement(org as any, 'marketplaceSelling')) {
      return res.status(403).json({
        error: 'Publishing to the marketplace requires a Pro plan',
      })
    }
    if (!orgForHost?.orgId) {
      return res.status(409).json({ error: 'Site has no owning organization' })
    }

    const publisher = await resolvePublisherProfile(firestore, orgForHost.orgId)
    if (!publisher) {
      return res.status(412).json({
        error: 'Set up your publisher profile first — Marketplace → Profile.',
      })
    }
    if (priceUsd > 0 && !publisher.stripeChargesEnabled) {
      return res.status(412).json({
        error:
          'Set up payouts first — Marketplace → Payouts — to sell themes',
      })
    }

    // The SITE'S OWN theme, before any resolution against a marketplace base or
    // the site's overrides. Publishing the resolved view would bake this site's
    // private customisations into an artifact other people install.
    const theme = themeArtifactContent((hostSnapshot.get('theme') ?? {}) as any)
    const validation = validateThemeForPublish(theme)
    if (!validation.ok) {
      return res.status(422).json({
        error: validation.errors[0]?.message ?? 'This theme is not publishable',
        // The whole list, so the dialog can show every problem at once rather
        // than making the publisher fix them one refusal at a time.
        errors: validation.errors,
        warnings: validation.warnings,
      })
    }

    // One listing per source site's theme; re-publish bumps the version.
    const existing = await firestore
      .collection('marketplaceListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceThemeHostId', '==', hostId)
      .limit(1)
      .get()
    const listingRef = existing.empty
      ? firestore.collection('marketplaceListings').doc(createResourceUid())
      : existing.docs[0].ref
    const version = existing.empty
      ? 1
      : Number(existing.docs[0].get('latestVersion') ?? 0) + 1
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

    await listingRef.set(
      {
        artifactType: 'theme',
        profileId: publisher.orgId,
        sourceHostId: hostId,
        sourceThemeHostId: hostId,
        displayName: displayName.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        latestVersion: version,
        deletedAt: null,
        ...(existing.empty && { createdAt: now }),
        updatedAt: now,
        versionHistory: firebaseAdmin.firestore.FieldValue.arrayUnion({
          version,
          publishedAt: firebaseAdmin.firestore.Timestamp.now(),
        }),
      },
      { merge: true },
    )
    await listingRef.collection('versions').doc(String(version)).set({
      theme,
      publishedAt: now,
    })

    return res.status(200).json({
      listingId: listingRef.id,
      version,
      // Warnings do not block, but publishing past one silently would make the
      // pre-flight pointless — the dialog reports what shipped anyway.
      warnings: validation.warnings,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Theme publish failed' })
  }
}

export default publishThemeHandler
