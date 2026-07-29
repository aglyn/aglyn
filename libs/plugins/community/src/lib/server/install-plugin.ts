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
  isFirstPartyPlugin,
  isPluginRevoked,
  PLUGIN_HOST_ABI_VERSION,
  type PluginApiHandler,
  type PluginRevocation,
} from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { canActAsPublisher } from './publisher-profile'
import { pinnedProvenance } from './provenance'
import { recordVersionMove } from './version-stats'
import {
  isListingBrowsable,
  isPrivateListing,
  isVersionApproved,
  listingArtifactType,
  newestApprovedVersion,
} from '../model/community'

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
  // `enabledPlugins` is a flat mix of first-party bundle ids and marketplace
  // listing ids (AGL-777). A listing id is a Firestore doc id, so it can't
  // normally collide with a bundle name — but guard anyway: an install sync
  // must NEVER arrayUnion/arrayRemove a bundle id, which would silently
  // enable or disable a platform plugin as a side effect of a purchase.
  if (isFirstPartyPlugin(listingId)) return
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
      if (req.body?.scope === 'org' && !orgId) {
        return res.status(409).json({ error: 'This site has no organization yet' })
      }
      const pinRef =
        req.body?.scope === 'org'
          ? orgId
            ? firestore.collection('orgs').doc(orgId).collection('installs').doc(listingId)
            : null
          : firestore.collection('hosts').doc(hostId).collection('installs').doc(listingId)
      // Active-install accounting (AGL-880): decrement only when a pin actually
      // existed, so a repeat/no-op uninstall never over-counts. `installCount`
      // is a cumulative all-time total and is deliberately left untouched.
      const pinSnapshot = pinRef ? await pinRef.get() : null
      const pinExisted = pinSnapshot?.exists ?? false
      // Read before the delete: the version being left is what the per-version
      // tally has to decrement, and it is gone the moment the pin is.
      const pinnedVersion = pinExisted ? pinSnapshot?.get('version') : null
      if (pinRef) await pinRef.delete()
      if (pinExisted) {
        const listingRef = firestore
          .collection('communityListings')
          .doc(listingId)
        await recordVersionMove({
          firestore,
          listingRef,
          artifactType: 'plugin',
          from: pinnedVersion,
          to: null,
        })
        await firestore
          .runTransaction(async (tx) => {
            const snapshot = await tx.get(listingRef)
            const current = Number(snapshot.get('activeInstalls') ?? 0)
            tx.update(listingRef, { activeInstalls: Math.max(0, current - 1) })
          })
          .catch(() => undefined)
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
      // Staff takedown blocks new installs too (AGL-948) — the revocation
      // check below stops a hidden listing anyway, but only while the
      // revocation stands, and a takedown is not conditional on it.
      listing.hiddenAt ||
      listingArtifactType(listing) !== 'plugin'
    ) {
      return res.status(404).json({ error: 'Unknown plugin listing' })
    }

    // The publisher installs their own listing for free, and may install
    // an unapproved version of it to test. Org-owned now (AGL-652), so this
    // is a role check — comparing a uid to an org id would never match.
    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )

    // Private plugins are installable ONLY by the owning org (AGL-968).
    // This is what makes private mean private; the UI merely hides them.
    if (isPrivateListing(listing) && !ownsListing) {
      return res.status(404).json({ error: 'Unknown plugin listing' })
    }

    // Installs enforce the same review state the marketplace browses by
    // (AGL-965). `isListingBrowsable` used to be applied ONLY by the browse
    // UI, so a listing that was never reviewed, was rejected, or has since
    // been de-listed could still be installed by anyone who knew its id and
    // posted here directly — which also made "delist" a suggestion rather
    // than a control. The publisher keeps installing their own listing to
    // test it before review.
    if (!isListingBrowsable(listing) && !isPrivateListing(listing) && !ownsListing) {
      return res
        .status(409)
        .json({ error: 'This plugin is not available for install' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
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

    // Installs resolve the newest APPROVED version, never `latestVersion`
    // (AGL-966). Before this, publishing v1.0.1 to a verified listing put
    // unreviewed code in front of every workspace immediately: the listing
    // kept its status, the queue never surfaced the update, and this line
    // pinned whatever had just been uploaded. A pending version is now
    // simply not offered, and the previously approved one keeps installing.
    //
    // The publisher may still install their own unapproved version — that
    // is how you test a plugin before submitting it, and it reaches only
    // their own sites.
    let version = requestedVersion ?? ''
    let versionData: any
    if (version) {
      versionData = (
        await listingRef.collection('pluginVersions').doc(version).get()
      ).data()
      if (!isVersionApproved(versionData) && !ownsListing) {
        return res.status(409).json({
          error: 'That version has not passed review yet',
          reviewState: versionData?.reviewState ?? 'unknown',
        })
      }
    } else {
      const approvedSnapshot = await listingRef
        .collection('pluginVersions')
        .orderBy('publishedAt', 'desc')
        .limit(25)
        .get()
      const candidates = approvedSnapshot.docs.map((doc) => ({
        version: String(doc.get('version') ?? doc.id),
        reviewState: doc.get('reviewState'),
        publishedAt: doc.get('publishedAt'),
        data: doc.data(),
      }))
      const newest = newestApprovedVersion(candidates as never) as
        | { version: string; data: any }
        | null
      // The publisher testing their own listing falls back to latest.
      const fallback = ownsListing
        ? candidates.find(
            (entry) => entry.version === String(listing.latestVersion ?? ''),
          )
        : undefined
      const chosen = newest ?? fallback
      if (!chosen) {
        return res.status(409).json({
          error: 'This plugin has no reviewed version available to install',
        })
      }
      version = chosen.version
      versionData = (chosen as { data?: unknown }).data
    }
    if (!versionData?.sha256 || !versionData?.manifest) {
      return res.status(404).json({ error: 'Unknown plugin version' })
    }

    // Kill switch (AGL-43 §3.5): a revoked version can't be installed.
    // Shares the predicate with the loaders (AGL-1085) so "installable" and
    // "runnable" cannot drift apart.
    const revocation = (
      await firestore.collection('revocations').doc(listingId).get()
    ).data() as PluginRevocation | undefined
    if (isPluginRevoked(revocation, version)) {
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
        // The same provenance stamp every other artifact type now carries
        // (AGL-1015), so one reader answers "where did this come from" for
        // pinned and copied artifacts alike. The flat pin fields stay: they
        // are what the loader reads.
        installedFrom: pinnedProvenance({
          listingId,
          listing,
          version,
          sha256: versionData.sha256,
          artifactType: 'plugin',
        }),
        ...(existing.exists ? {} : { installedAt: now }),
        updatedAt: now,
      },
      { merge: true },
    )
    if (!existing.exists) {
      await listingRef
        .update({
          // installCount is the cumulative all-time total; activeInstalls
          // mirrors live pins and is decremented on uninstall (AGL-880).
          installCount: firebaseAdmin.firestore.FieldValue.increment(1),
          activeInstalls: firebaseAdmin.firestore.FieldValue.increment(1),
        })
        .catch(() => undefined)
    }
    // Per-version tally (AGL-1036). This runs on EVERY pin write, not just the
    // first: a re-pin is the common case and the one the listing-level counters
    // above are blind to — the pin already exists, so nothing there moves while
    // the install changes version underneath.
    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'plugin',
      from: existing.exists ? existing.get('version') : null,
      to: version,
    })

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
