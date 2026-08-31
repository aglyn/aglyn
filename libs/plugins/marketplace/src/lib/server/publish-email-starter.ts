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

import {
  CANVAS_ROOT_ELEMENT_ID,
  checkEntitlement,
  createResourceUid,
} from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  emailStarterRefusal,
  inspectEmailStarter,
  MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST,
  marketplacePriceRefusal,
  sanitizeMarketplaceDefinition,
} from '../model'
import { resolvePublisherProfile } from './publisher-profile'
import { publishPreconditionRefusal } from './publish-preconditions'

/**
 * Publishes a site's campaign email design as a marketplace starter.
 *
 * The source is a `kind: 'email'` SCREEN — the document `createEmailScreen`
 * writes and the screen besigner edits — not an entry in the transactional
 * catalog. That is the whole difference from `publish-email-template`, and it
 * is why the two exist separately: a transactional design is a design FOR a
 * fixed key and installs onto that same key; a starter belongs to no key and
 * installs as a new email of the buyer's own.
 *
 * ## Two things this reads that the transactional publisher does not
 *
 * **The nodes are compressed.** A screen version is written through
 * `screenVersionConverter`, so `nodes` comes back from the Admin SDK as a
 * msgpack `Buffer`. `publish-email-template.ts` reads its `nodes` raw and says
 * why — its besigner saves with a bare `setDoc` and no converter — and copying
 * that line here would publish a Buffer: truthy, non-empty by `Object.keys`
 * (those are byte indices), and scanning as a design with no blocks in it.
 *
 * **The tree is inspected, not just sanitized.** `sanitizeMarketplaceDefinition`
 * DROPS an unsafe URL and publishes what is left, which is right for a page.
 * Here the URL rules are the product: a remote image in an email is a read
 * receipt for whoever hosts it, and quietly removing one teaches the publisher
 * nothing. So `inspectEmailStarter` runs first and REFUSES.
 */
export const publishEmailStarterHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const screenId = String(req.body?.screenId ?? '')
  const displayName = String(req.body?.displayName ?? '').slice(0, 80)
  const description = String(req.body?.description ?? '').slice(0, 500)
  const category = String(req.body?.category ?? '').slice(0, 40)
  const priceUsd = Math.round(Number(req.body?.priceUsd ?? 0)) || 0
  const priceRefusal = marketplacePriceRefusal(priceUsd)
  if (priceRefusal) return res.status(400).json({ error: priceRefusal })
  if (!hostId || !screenId || !displayName.trim()) {
    return res
      .status(400)
      .json({ error: 'Missing hostId, screenId, or displayName' })
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
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    const orgForHost = await getOrgForHost(hostId)
    if (!checkEntitlement(orgForHost?.org ?? {}, 'marketplaceSelling')) {
      return res
        .status(403)
        .json({ error: 'Publishing to the marketplace requires a Pro plan' })
    }
    if (!orgForHost?.orgId) {
      return res.status(409).json({ error: 'Site has no owning organization' })
    }
    const publisher = await resolvePublisherProfile(firestore, orgForHost.orgId)
    const refusal = publishPreconditionRefusal(publisher, {
      priceUsd,
      sells: 'templates',
    })
    if (refusal) return res.status(refusal.status).json(refusal.body)

    const screenRef = hostRef.collection('screens').doc(screenId)
    const screenSnapshot = await screenRef.get()
    const screen = screenSnapshot.data() as Record<string, unknown> | undefined
    if (!screen || screen['deletedAt']) {
      return res.status(404).json({ error: 'Unknown email' })
    }
    if (screen['kind'] !== 'email') {
      return res
        .status(422)
        .json({ error: 'That screen is a page, not an email' })
    }
    const activeVersionId = screen['versionId']
    if (!activeVersionId) {
      return res
        .status(404)
        .json({ error: 'This email has no saved design yet — design and save it first' })
    }
    const versionSnapshot = await screenRef
      .collection('versions')
      .doc(String(activeVersionId))
      .get()

    // The inspection decodes, so it is also the guard against publishing a
    // node map nothing could read — it refuses rather than reporting a
    // compressed payload as a clean design.
    const inspection = inspectEmailStarter(versionSnapshot.get('nodes'))
    const violation = emailStarterRefusal(inspection)
    if (violation) {
      return res.status(422).json({
        error: violation,
        violations: inspection.violations,
      })
    }
    if (!inspection.nodes || !Object.keys(inspection.nodes).length) {
      return res.status(404).json({ error: 'This email design is empty' })
    }
    // Runs after the inspection and over the same decoded map. It enforces the
    // component-id allowlist and trims node keys; the URL rules it also carries
    // can no longer fire, because a design that would have tripped them was
    // refused above rather than silently trimmed.
    const sanitized = sanitizeMarketplaceDefinition(
      { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: inspection.nodes },
      { componentIds: MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST },
    )
    if (sanitized.ok === false) {
      return res.status(422).json({ error: sanitized.error })
    }

    // One listing per (publisher org, source screen). Re-publishing the same
    // email bumps its version rather than minting a second listing, which is
    // what makes "update available" mean anything to everyone who installed it.
    const existing = await firestore
      .collection('marketplaceListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceHostId', '==', hostId)
      .where('sourceScreenId', '==', screenId)
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
        profileId: publisher.orgId,
        artifactType: 'emailStarter',
        sourceHostId: hostId,
        sourceScreenId: screenId,
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
    await listingRef
      .collection('versions')
      .doc(String(version))
      .set({
        rootId: sanitized.rootId,
        nodes: sanitized.nodes,
        // Copy is part of the design and travels with it.
        subject: String(screen['emailSubject'] ?? ''),
        preheader: String(screen['emailPreheader'] ?? ''),
        // The hosts this design would send a recipient to, recorded at publish
        // so the listing page can show them BEFORE somebody installs. A tenant
        // about to mail their own customers under their own name is entitled to
        // see the domains a stranger's template points them at, and no
        // allowlist can make that judgment for them.
        linkHosts: inspection.linkHosts,
        // Absent `reviewState` is the un-reviewed default, and it is written
        // NOWHERE here on purpose: a publisher who could stamp their own
        // version approved would make the field decorative. Staff write it.
        publishedAt: now,
      })

    return res
      .status(200)
      .json({ listingId: listingRef.id, version, linkHosts: inspection.linkHosts })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Email starter publish failed' })
  }
}

export default publishEmailStarterHandler
