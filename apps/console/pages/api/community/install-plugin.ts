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
  resolveOrgIdForHost, firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveOrgPermissions } from '../../../utils/server/org-permissions'

/**
 * Installs (or upgrades) a community plugin into a host (AGL-45), pinning a
 * version per AGL-43 §3.4. Writes `hosts/{hostId}/installs/{listingId}`
 * with the exact `{version, sha256}` — upgrades are explicit (a new pin),
 * so a publisher can never swap the code a consumer runs. Access mirrors
 * component installs: free, purchased (webhook-written), or own listing.
 * The pin references the immutable artifact; the sandboxed loader fetches
 * and integrity-checks it at render time.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  // Optional explicit version for upgrade/downgrade; defaults to latest.
  const requestedVersion = req.body?.version
    ? String(req.body.version)
    : undefined
  if (!listingId || !hostId) {
    return res.status(400).json({ error: 'Missing listingId or hostId' })
  }
  const authorization = req.headers.authorization ?? ''
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
    if (!['admin', 'editor'].includes(memberRole)) {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    // Org-tier uninstall (AGL-237): org pins are API-managed (rules deny
    // client writes), so removal comes through here too.
    if (req.body?.action === 'uninstall' && req.body?.scope === 'org') {
      const orgId = await resolveOrgIdForHost(hostId)
      if (!orgId) {
        return res.status(409).json({ error: 'This site has no organization yet' })
      }
      await firestore
        .collection('orgs')
        .doc(orgId)
        .collection('installs')
        .doc(listingId)
        .delete()
      return res.status(200).json({ ok: true })
    }

    const listingRef = firestore
      .collection('communityListings')
      .doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt || listing.type !== 'plugin') {
      return res.status(404).json({ error: 'Unknown plugin listing' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    if (priceUsd > 0 && listing.profileId !== decoded.uid) {
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

    const version = requestedVersion ?? String(listing.latestVersion ?? '')
    const versionSnapshot = await listingRef
      .collection('pluginVersions')
      .doc(version)
      .get()
    const versionData = versionSnapshot.data() as any
    if (!versionData?.sha256 || !versionData?.manifest) {
      return res.status(404).json({ error: 'Unknown plugin version' })
    }

    // Kill switch (AGL-43 §3.5): a revoked version can't be installed.
    const revocation = (
      await firestore.collection('revocations').doc(listingId).get()
    ).data() as any
    if (
      revocation &&
      (revocation.versions === 'all' ||
        (Array.isArray(revocation.versions) &&
          revocation.versions.includes(version)))
    ) {
      return res
        .status(409)
        .json({ error: 'This plugin version has been revoked' })
    }

    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Install tier (AGL-237): org-extending plugins install once for every
    // host in the org; host-only plugins stay pinned to the host.
    const scope = req.body?.scope === 'org' ? 'org' : 'host'
    let installRef = hostRef.collection('installs').doc(listingId)
    if (scope === 'org') {
      const orgId = await resolveOrgIdForHost(hostId)
      if (!orgId) {
        return res.status(409).json({ error: 'This site has no organization yet' })
      }
      installRef = firestore
        .collection('orgs')
        .doc(orgId)
        .collection('installs')
        .doc(listingId)
    }
    const existing = await installRef.get()
    await installRef.set(
      {
        listingId,
        profileId: listing.profileId,
        displayName: listing.displayName,
        pluginId: versionData.manifest.id,
        version,
        sha256: versionData.sha256,
        objectPath: versionData.objectPath,
        manifest: versionData.manifest,
        ...(existing.exists ? {} : { installedAt: now }),
        updatedAt: now,
      },
      { merge: true },
    )
    if (!existing.exists) {
      await listingRef
        .update({
          installCount: firebaseAdmin.firestore.FieldValue.increment(1),
        })
        .catch(() => undefined)
    }

    return res.status(200).json({
      installed: true,
      upgraded: existing.exists,
      version,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Install failed' })
  }
}
