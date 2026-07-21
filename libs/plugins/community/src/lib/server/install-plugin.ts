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
import {
  isCompatibleHostAbi,
  PLUGIN_HOST_ABI_VERSION,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { canActAsPublisher } from './publisher-profile'
import { listingArtifactType } from '../model/community'

/**
 * Installs (or upgrades) a community plugin into a host (AGL-45), pinning a
 * version per AGL-43 §3.4. Writes `hosts/{hostId}/installs/{listingId}`
 * with the exact `{version, sha256}` — upgrades are explicit (a new pin),
 * so a publisher can never swap the code a consumer runs. Access mirrors
 * component installs: free, purchased (webhook-written), or own listing.
 * The pin references the immutable artifact; the sandboxed loader fetches
 * and integrity-checks it at render time.
 *
 * Enablement sync (AGL-424): marketplace plugins ride the same
 * `org.enabledPlugins` switchboard first-party plugins use — but ONLY for
 * workspaces that have explicitly configured the field. Install appends
 * the listing id there; uninstall removes it once no pin (org or acting
 * host) remains. Workspaces that never touched the switchboard stay
 * default-open (absent field ⇒ installs load), so pre-sync installs keep
 * working.
 */

/** Keeps `org.enabledPlugins` in step with install pins (AGL-424). */
async function syncEnabledPlugins(
  firestore: FirebaseFirestore.Firestore,
  orgId: string | null,
  hostId: string,
  listingId: string,
  action: 'add' | 'remove-if-unpinned',
): Promise<void> {
  if (!orgId) return
  const orgRef = firestore.collection('orgs').doc(orgId)
  const configured = (await orgRef.get()).get('enabledPlugins')
  // Absent field = default-open workspace; nothing to sync.
  if (!Array.isArray(configured)) return
  if (action === 'add') {
    if (configured.includes(listingId)) return
    await orgRef.update({
      enabledPlugins: firebaseAdmin.firestore.FieldValue.arrayUnion(listingId),
    })
    return
  }
  const [orgPin, hostPin] = await Promise.all([
    orgRef.collection('installs').doc(listingId).get(),
    firestore
      .collection('hosts')
      .doc(hostId)
      .collection('installs')
      .doc(listingId)
      .get(),
  ])
  if (orgPin.exists || hostPin.exists) return
  await orgRef.update({
    enabledPlugins: firebaseAdmin.firestore.FieldValue.arrayRemove(listingId),
  })
}
export const installPluginHandler: PluginApiHandler = async (req, res) => {
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
    if (!['admin', 'editor'].includes(memberRole)) {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    // Uninstalls (AGL-237/424). Org pins are API-managed (rules deny
    // client writes); host uninstalls also come through here so the
    // enablement sync runs. Plugin-owned data is never deleted — only the
    // pin (and the switchboard entry when no pin remains anywhere).
    if (req.body?.action === 'uninstall') {
      const orgId = await resolveOrgIdForHost(hostId)
      if (req.body?.scope === 'org') {
        if (!orgId) {
          return res.status(409).json({ error: 'This site has no organization yet' })
        }
        await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('installs')
          .doc(listingId)
          .delete()
      } else {
        await firestore
          .collection('hosts')
          .doc(hostId)
          .collection('installs')
          .doc(listingId)
          .delete()
      }
      await syncEnabledPlugins(
        firestore,
        orgId,
        hostId,
        listingId,
        'remove-if-unpinned',
      )
      return res.status(200).json({ ok: true })
    }

    const listingRef = firestore
      .collection('communityListings')
      .doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      listingArtifactType(listing) !== 'plugin'
    ) {
      return res.status(404).json({ error: 'Unknown plugin listing' })
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

    // Enablement sync (AGL-424): the new install loads on next visit for
    // workspaces with a configured switchboard.
    await syncEnabledPlugins(
      firestore,
      await resolveOrgIdForHost(hostId),
      hostId,
      listingId,
      'add',
    )

    // ABI heads-up (AGL-429): the pin succeeds (explicit choice), but the
    // loaders will refuse an incompatible bundle — tell the installer now.
    const manifestHostAbi = Number(versionData.manifest?.hostAbi)
    const hostAbiWarning =
      Number.isInteger(manifestHostAbi) &&
      manifestHostAbi > 0 &&
      !isCompatibleHostAbi(manifestHostAbi)
        ? `Built for host ABI ${manifestHostAbi}; this platform runs ` +
          `${PLUGIN_HOST_ABI_VERSION}. The plugin will not load until the ` +
          'publisher ships a compatible version.'
        : undefined

    return res.status(200).json({
      installed: true,
      upgraded: existing.exists,
      version,
      ...(hostAbiWarning ? { hostAbiWarning } : {}),
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Install failed' })
  }
}
