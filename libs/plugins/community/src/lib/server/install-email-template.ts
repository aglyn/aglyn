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
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  getTenantEmail,
  isTenantEmailEditable,
  TENANT_EMAIL_COLLECTION,
} from '@aglyn/shared-util-email'
import { listingArtifactType } from '../model/community'
import { canActAsPublisher } from './publisher-profile'

/**
 * Installs a marketplace email template into a site (AGL-657).
 *
 * Lands as an INACTIVE version: the design is written to
 * `hosts/{h}/emailTemplates/{key}/versions/{newId}` and the template doc's
 * `versionId` — the pointer `loadHostEmail` reads at send time — is left
 * alone. That keeps the AGL-669/671 rule intact for the one artifact type
 * where breaking it would be worst: an email template installs onto a FIXED
 * catalog key, so writing it live would silently replace the design of an
 * email the site is already sending its customers. The owner activates it in
 * the email besigner, exactly as with any other draft version.
 *
 * `subject`/`preheader` ride the version doc rather than the template doc for
 * the same reason — they are live send-time copy.
 */
export const installEmailTemplateHandler: PluginApiHandler = async (
  req,
  res,
) => {
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
      listingArtifactType(listing) !== 'emailTemplate'
    ) {
      return res.status(404).json({ error: 'Unknown email template' })
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
    const nodes = versionSnapshot.get('nodes') as Record<string, any> | undefined
    if (!nodes || !Object.keys(nodes).length) {
      return res.status(500).json({ error: 'Email template version missing' })
    }
    // The catalog key is part of the artifact: this design is FOR a specific
    // transactional email, so it can only install onto that same key.
    const templateKey = String(
      versionSnapshot.get('emailTemplateKey') ??
        listing.emailTemplateKey ??
        '',
    )
    const entry = templateKey ? getTenantEmail(templateKey) : undefined
    if (!entry || !isTenantEmailEditable(entry)) {
      return res
        .status(422)
        .json({ error: 'This listing targets an email this site cannot send' })
    }
    // The email's plugin has to be present, or the design targets an email
    // that is never sent from here — better to say so than to install a
    // version nobody can reach.
    const enabledPlugins = hostSnapshot.get('enabledPlugins')
    if (
      entry.pluginId &&
      Array.isArray(enabledPlugins) &&
      !enabledPlugins.includes(entry.pluginId)
    ) {
      return res.status(409).json({
        error: `This email is sent by the ${entry.plugin} plugin — enable it on this site first`,
      })
    }

    const templateRef = hostRef
      .collection(TENANT_EMAIL_COLLECTION)
      .doc(templateKey)
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    const versionId = createResourceUid()
    const batch = firestore.batch()
    batch.set(
      templateRef.collection('versions').doc(versionId),
      {
        rootId: versionSnapshot.get('rootId') ?? null,
        nodes,
        // Copy travels with the design but stays inert until activation.
        subject: String(versionSnapshot.get('subject') ?? ''),
        preheader: String(versionSnapshot.get('preheader') ?? ''),
        source: {
          type: 'marketplace' as const,
          listingId,
          version: listing.latestVersion ?? null,
        },
        createdAt: now,
        updatedAt: now,
      },
    )
    // Create the template doc if this site has never designed this email, but
    // WITHOUT `versionId` — an absent pointer keeps the built-in copy sending.
    //
    // `installedFrom` is a read marker, not behavior (AGL-789): the installed
    // design lives in a versions SUBcollection, which browse can only reach
    // with a collectionGroup query that would collide with every other
    // `versions` subcollection in the schema. Recording it on the flat
    // template doc keeps "is this listing installed here?" a single read.
    batch.set(
      templateRef,
      {
        updatedAt: now,
        installedFrom: {
          listingId,
          version: listing.latestVersion ?? null,
          versionId,
        },
      },
      { merge: true },
    )
    await batch.commit()

    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      templateKey,
      versionId,
      activated: false,
      version: listing.latestVersion ?? null,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Email template install failed' })
  }
}

export default installEmailTemplateHandler
