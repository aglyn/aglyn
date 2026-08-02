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
import {
  EMAIL_NODE_ROOT_ID,
  getTenantEmail,
  isTenantEmailEditable,
  TENANT_EMAIL_COLLECTION,
} from '@aglyn/shared-util-email'
import {
  MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST,
  MARKETPLACE_MAX_PRICE_USD,
  sanitizeMarketplaceDefinition,
} from '../model'
import { resolvePublisherProfile } from './publisher-profile'

/**
 * Publishes a site's designed transactional email to the marketplace
 * (AGL-657).
 *
 * An email design is a node tree like any other artifact, but it does NOT live
 * in the host's screen routing map — which is exactly why `publish-template`
 * could never capture one (it only sees `hostSnapshot.get('screens')`). The
 * tree lives at `hosts/{h}/emailTemplates/{key}/versions/{versionId}`, so this
 * reads it directly.
 *
 * `templateKey` is a fixed catalog key ('booking-confirmed', …), not a free
 * id: a published email means "a design FOR this transactional email", so the
 * key travels with the listing and the installer lands on the same key.
 */
export const publishEmailTemplateHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const templateKey = String(req.body?.templateKey ?? '')
  const displayName = String(req.body?.displayName ?? '').slice(0, 80)
  const description = String(req.body?.description ?? '').slice(0, 500)
  const category = String(req.body?.category ?? '').slice(0, 40)
  const priceUsd = Math.round(Number(req.body?.priceUsd ?? 0)) || 0
  if (
    priceUsd < 0 ||
    priceUsd > MARKETPLACE_MAX_PRICE_USD ||
    !Number.isFinite(priceUsd)
  ) {
    return res
      .status(400)
      .json({ error: `Price must be 0–${MARKETPLACE_MAX_PRICE_USD} USD` })
  }
  if (!hostId || !templateKey || !displayName.trim()) {
    return res
      .status(400)
      .json({ error: 'Missing hostId, templateKey, or displayName' })
  }
  const entry = getTenantEmail(templateKey)
  if (!entry || !isTenantEmailEditable(entry)) {
    return res.status(400).json({ error: 'Not a designable email template' })
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
    if (!checkEntitlement(orgForHost?.org ?? {}, 'marketplaceSelling')) {
      return res
        .status(403)
        .json({ error: 'Publishing to the marketplace requires a Pro plan' })
    }
    if (!orgForHost?.orgId) {
      return res.status(409).json({ error: 'Site has no owning organization' })
    }

    const publisher = await resolvePublisherProfile(firestore, orgForHost.orgId)
    if (!publisher) {
      return res.status(412).json({
        error:
          'Set up your publisher profile first — Marketplace → Profile.',
      })
    }
    if (priceUsd > 0 && !publisher.stripeChargesEnabled) {
      return res.status(412).json({
        error:
          'Set up payouts first — Marketplace → Payouts — to sell templates',
      })
    }

    const templateRef = hostRef
      .collection(TENANT_EMAIL_COLLECTION)
      .doc(templateKey)
    const templateSnapshot = await templateRef.get()
    const activeVersionId = templateSnapshot.get('versionId')
    if (!templateSnapshot.exists || !activeVersionId) {
      return res.status(404).json({
        error: 'This email has no published design yet — design and save it first',
      })
    }
    const versionSnapshot = await templateRef
      .collection('versions')
      .doc(String(activeVersionId))
      .get()
    const nodes = versionSnapshot.get('nodes') as Record<string, any> | undefined
    if (!nodes || !Object.keys(nodes).length) {
      return res.status(404).json({ error: 'This email design is empty' })
    }
    // Emails are built from `plugins-email` blocks only, so the page allowlist
    // is REPLACED rather than extended — see MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST
    // for why `emailHtml` is not on the list.
    const rootId = versionSnapshot.get('rootId') ?? EMAIL_NODE_ROOT_ID
    const sanitized = sanitizeMarketplaceDefinition(
      { rootId, nodes },
      { componentIds: MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST },
    )
    if (sanitized.ok === false) {
      return res.status(422).json({ error: sanitized.error })
    }

    // One listing per (source site, template key).
    const existing = await firestore
      .collection('marketplaceListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceHostId', '==', hostId)
      .where('emailTemplateKey', '==', templateKey)
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
        artifactType: 'emailTemplate',
        sourceHostId: hostId,
        emailTemplateKey: templateKey,
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
        emailTemplateKey: templateKey,
        // The copy fields are part of the design, not the tree.
        subject: String(templateSnapshot.get('subject') ?? ''),
        preheader: String(templateSnapshot.get('preheader') ?? ''),
        publishedAt: now,
      })

    return res.status(200).json({ listingId: listingRef.id, version })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Publish failed' })
  }
}

export default publishEmailTemplateHandler
