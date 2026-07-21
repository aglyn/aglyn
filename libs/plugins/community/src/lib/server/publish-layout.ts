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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { sanitizeCommunityDefinition } from '../model/community'
import { resolvePublisherProfile } from './publisher-profile'

/** The node marking where a bound screen's content grafts in. */
const LAYOUT_SLOT_COMPONENT_ID = 'layoutSlot'

/**
 * Publishes a shared layout to the marketplace (AGL-671).
 *
 * Layouts were the one design asset that could not be shared at all:
 * `publish-template` captures screens and theme only, and `layoutSlot` is
 * excluded from the community allowlist as "layout chrome". Both are
 * addressed here — the slot is permitted for this artifact type
 * specifically, since a layout without one is chrome with nowhere to put
 * the page.
 *
 * Gates mirror template publishing exactly: org permission, host role,
 * `marketplaceSelling`, an org publisher profile, and payouts configured
 * before anything can be sold.
 */
export const publishLayoutHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const layoutId = String(req.body?.layoutId ?? '')
  const displayName = String(req.body?.displayName ?? '')
  const description = String(req.body?.description ?? '')
  const category = String(req.body?.category ?? '')
  const priceUsd = Math.max(0, Math.round(Number(req.body?.priceUsd ?? 0)))
  if (!hostId || !layoutId || !displayName.trim()) {
    return res
      .status(400)
      .json({ error: 'Missing hostId, layoutId or displayName' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.publishToCommunity) {
      return res.status(403).json({
        error:
          'Your organization role does not allow publishing to the community',
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
        error: 'Publishing to the community requires a Pro plan',
      })
    }
    if (!orgForHost?.orgId) {
      return res.status(409).json({ error: 'Site has no owning organization' })
    }

    const publisher = await resolvePublisherProfile(firestore, orgForHost.orgId)
    if (!publisher) {
      return res.status(412).json({
        error:
          'Set up your organization’s publisher profile first ' +
          '(Organization → Community)',
      })
    }
    if (priceUsd > 0 && !publisher.stripeChargesEnabled) {
      return res.status(412).json({
        error:
          'Set up payouts first (Organization → Community) to sell layouts',
      })
    }

    const layoutRef = hostRef.collection('layouts').doc(layoutId)
    const layoutSnapshot = await layoutRef.get()
    if (!layoutSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown layout' })
    }
    const versionId = layoutSnapshot.get('versionId')
    if (!versionId) {
      return res.status(422).json({
        error: 'Publish this layout on your site first — there is no ' +
          'published version to share',
      })
    }
    const versionSnapshot = await layoutRef
      .collection('versions')
      .doc(String(versionId))
      .get()
    const nodes = versionSnapshot.get('nodes') as Record<string, any> | undefined
    if (!nodes || !Object.keys(nodes).length) {
      return res.status(422).json({ error: 'Layout version has no content' })
    }

    // Layout versions have no explicit rootId; the root is the node without
    // a parent, matching how the renderer walks them.
    const rootId: string =
      Object.keys(nodes).find((id) => !nodes[id]?.parentId) ??
      Object.keys(nodes)[0] ??
      ''
    const sanitized = sanitizeCommunityDefinition(
      { rootId, nodes },
      { extraComponentIds: [LAYOUT_SLOT_COMPONENT_ID] },
    )
    // `=== false` rather than `!sanitized.ok`: the compiler does not narrow
    // the union on the negated form here, and publish-template hit the same
    // thing first.
    if (sanitized.ok === false) {
      return res.status(400).json({ error: sanitized.error })
    }
    // A layout whose slot did not survive would render as chrome with the
    // page content missing — better to refuse than to publish that.
    const hasSlot = Object.values(sanitized.nodes).some(
      (node: any) => node.componentId === LAYOUT_SLOT_COMPONENT_ID,
    )
    if (!hasSlot) {
      return res.status(422).json({
        error:
          'This layout has no content slot, so pages using it would have ' +
          'nowhere to render',
      })
    }

    // One listing per source layout; re-publish bumps the version.
    const existing = await firestore
      .collection('communityListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceLayoutId', '==', layoutId)
      .limit(1)
      .get()
    const listingRef = existing.empty
      ? firestore.collection('communityListings').doc(createResourceUid())
      : existing.docs[0].ref
    const version = existing.empty
      ? 1
      : Number(existing.docs[0].get('latestVersion') ?? 0) + 1
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

    await listingRef.set(
      {
        artifactType: 'layout',
        profileId: publisher.orgId,
        sourceHostId: hostId,
        sourceLayoutId: layoutId,
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
      layout: { rootId: sanitized.rootId, nodes: sanitized.nodes },
      publishedAt: now,
    })

    return res.status(200).json({ listingId: listingRef.id, version })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Layout publish failed' })
  }
}

export default publishLayoutHandler
