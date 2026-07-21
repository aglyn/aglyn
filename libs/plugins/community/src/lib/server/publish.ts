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
import { COMMUNITY_MAX_PRICE_USD, sanitizeCommunityDefinition } from '../model'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { resolvePublisherProfile } from './publisher-profile'

/**
 * Publishes a host reusable component to the community (AGL-44). Runs
 * server-side so the sanitization pass (component-id allowlist, key strip,
 * size cap — see `sanitizeCommunityDefinition`) cannot be bypassed: clients
 * have no write access to `communityListings` creates. Requirements: host
 * admin, a community profile, and the `marketplaceSelling` plan flag.
 * Re-publishing the same component bumps the listing's version.
 */
export const publishHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const componentId = String(req.body?.componentId ?? '')
  const displayName = String(req.body?.displayName ?? '').slice(0, 80)
  const description = String(req.body?.description ?? '').slice(0, 500)
  const category = String(req.body?.category ?? '').slice(0, 40)
  const priceUsd = Math.round(Number(req.body?.priceUsd ?? 0)) || 0
  if (
    priceUsd < 0 ||
    priceUsd > COMMUNITY_MAX_PRICE_USD ||
    !Number.isFinite(priceUsd)
  ) {
    return res
      .status(400)
      .json({ error: `Price must be 0–${COMMUNITY_MAX_PRICE_USD} USD` })
  }
  if (!hostId || !componentId || !displayName.trim()) {
    return res
      .status(400)
      .json({ error: 'Missing hostId, componentId, or displayName' })
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
    if (!membership.permissions.publishToCommunity) {
      return res.status(403).json({
        error: 'Your organization role does not allow publishing to the community',
      })
    }
    const firestore = firebaseAdmin.app().firestore()

    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    // Plan gate rides the owning org's doc (AGL-238).
    const orgForHost = await getOrgForHost(hostId)
    const org = orgForHost?.org ?? {}
    if (!checkEntitlement(org, 'marketplaceSelling')) {
      return res.status(403).json({
        error: 'Publishing to the community requires a Pro plan',
      })
    }
    if (!orgForHost?.orgId) {
      return res.status(409).json({ error: 'Site has no owning organization' })
    }

    // Publishing is ORG-ONLY (AGL-652): the publisher is the org, not
    // whoever clicked publish. `profileId` keeps its name — it is still the
    // publisher profile's doc id, which is now the org id.
    const publisher = await resolvePublisherProfile(firestore, orgForHost.orgId)
    if (!publisher) {
      return res.status(412).json({
        error:
          'Set up your organization’s publisher profile first ' +
          '(Organization → Community)',
      })
    }
    // Paid listings require completed Stripe Connect onboarding (AGL-46).
    if (priceUsd > 0 && !publisher.stripeChargesEnabled) {
      return res.status(412).json({
        error:
          'Set up payouts first (Organization → Community) to sell components',
      })
    }

    const definitionSnapshot = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('components')
      .doc(componentId)
      .get()
    const definition = definitionSnapshot.data() as any
    if (!definition || definition.deletedAt) {
      return res.status(404).json({ error: 'Unknown component' })
    }
    const sanitized = sanitizeCommunityDefinition({
      rootId: definition.rootId,
      nodes: definition.nodes ?? {},
    })
    if (sanitized.ok === false) {
      return res.status(422).json({ error: sanitized.error })
    }

    // One listing per source component: re-publish bumps latestVersion.
    const existing = await firestore
      .collection('communityListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceComponentId', '==', componentId)
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
        profileId: publisher.orgId,
        artifactType: 'component',
        sourceComponentId: componentId,
        displayName: displayName.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        latestVersion: version,
        deletedAt: null,
        ...(existing.empty && { createdAt: now }),
        updatedAt: now,
        // Version metadata for the detail page (AGL-95) — snapshots
        // themselves stay server-only, so history rides the listing doc.
        versionHistory: firebaseAdmin.firestore.FieldValue.arrayUnion({
          version,
          publishedAt: firebaseAdmin.firestore.Timestamp.now(),
        }),
      },
      { merge: true },
    )
    await listingRef.collection('versions').doc(String(version)).set({
      rootId: sanitized.rootId,
      nodes: sanitized.nodes,
      publishedAt: now,
    })

    return res
      .status(200)
      .json({ listingId: listingRef.id, version })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}
