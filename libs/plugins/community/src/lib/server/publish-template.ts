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

import { CANVAS_ROOT_ELEMENT_ID, checkEntitlement, createResourceUid } from '@aglyn/aglyn/server'
import { COMMUNITY_MAX_PRICE_USD, sanitizeCommunityDefinition } from '../model'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

const MAX_TEMPLATE_SCREENS = 25

/**
 * Publishes a host as a site template (AGL-137): captures every published
 * screen (nodes run through the same community sanitizer as component
 * publishing — the id allowlist and size caps apply per screen) plus the
 * theme into a `communityListings` doc with `kind: 'template'`. Same
 * gates as component publishing: host admin, community profile,
 * `marketplaceSelling` for plan-gated workspaces, Stripe onboarding for paid
 * listings. One template per source host; re-publishing bumps the version.
 */
export const publishTemplateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
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
    if (!membership.permissions.publishToCommunity) {
      return res.status(403).json({
        error: 'Your organization role does not allow publishing to the community',
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

    // Plan gate rides the owning org's doc (AGL-238).
    const org = (await getOrgForHost(hostId))?.org ?? {}
    if (!checkEntitlement(org as any, 'marketplaceSelling')) {
      return res.status(403).json({
        error: 'Publishing to the community requires a Pro plan',
      })
    }

    const profileSnapshot = await firestore
      .collection('profiles')
      .doc(decoded.uid)
      .get()
    if (!profileSnapshot.exists || !profileSnapshot.get('handle')) {
      return res.status(412).json({
        error:
          'Create your community profile first (Manage → Community profile)',
      })
    }
    if (priceUsd > 0 && !profileSnapshot.get('stripeChargesEnabled')) {
      return res.status(412).json({
        error:
          'Set up payouts first (Manage → Community profile) to sell ' +
          'templates',
      })
    }

    // Capture: every screen in the routing map (published) with its
    // published version, sanitized like any community definition.
    const routingMap = (hostSnapshot.get('screens') ?? {}) as Record<
      string,
      string
    >
    const screenIds = Object.keys(routingMap).slice(0, MAX_TEMPLATE_SCREENS)
    if (!screenIds.length) {
      return res
        .status(422)
        .json({ error: 'Publish at least one screen before templating' })
    }
    const screens: any[] = []
    for (const screenId of screenIds) {
      const screenSnapshot = await hostRef
        .collection('screens')
        .doc(screenId)
        .get()
      const screen = screenSnapshot.data() as any
      if (!screen || screen.deletedAt || !screen.versionId) continue
      const versionSnapshot = await hostRef
        .collection('screens')
        .doc(screenId)
        .collection('versions')
        .doc(String(screen.versionId))
        .get()
      const nodes = versionSnapshot.get('nodes')
      if (!nodes) continue
      const sanitized = sanitizeCommunityDefinition({
        rootId: CANVAS_ROOT_ELEMENT_ID,
        nodes,
      })
      if (sanitized.ok === false) {
        return res.status(422).json({
          error: `Screen "${screen.displayName ?? screenId}": ${sanitized.error}`,
        })
      }
      screens.push({
        displayName: screen.displayName ?? 'Screen',
        ...(screen.description && { description: screen.description }),
        ...(screen.seo && { seo: screen.seo }),
        slug: routingMap[screenId],
        nodes: sanitized.nodes,
      })
    }
    if (!screens.length) {
      return res
        .status(422)
        .json({ error: 'No publishable screens with versions found' })
    }

    // One template listing per source host; re-publish bumps the version.
    const existing = await firestore
      .collection('communityListings')
      .where('profileId', '==', decoded.uid)
      .where('sourceHostId', '==', hostId)
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
        kind: 'template',
        profileId: decoded.uid,
        sourceHostId: hostId,
        displayName: displayName.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        screenCount: screens.length,
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
      template: {
        screens,
        theme: hostSnapshot.get('theme') ?? null,
      },
      publishedAt: now,
    })

    return res.status(200).json({ listingId: listingRef.id, version })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Template publish failed' })
  }
}
