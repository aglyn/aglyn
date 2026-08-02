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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  isVersionApproved,
  listingArtifactType,
  newestApprovedVersion,
} from '../model/marketplace'
import { compareArtifactVersions } from '@aglyn/aglyn/server'
import { versionCollectionFor } from './version-stats'
import { canActAsPublisher } from './publisher-profile'
import { attestationsForBytes } from '@aglyn/aglyn/app-utils/publisher-attestation'

/**
 * The publisher's own view of their versions (AGL-1079).
 *
 * AGL-966 made review per-version and got the mechanics right — a new
 * version enters `pending`, the previously approved one keeps installing,
 * nothing ships past a reviewer. The publisher was told none of it: an
 * email on the outcome, and in between a listing row identical to the one
 * they had before they published.
 *
 * Separate from the buyer projection above on purpose. `reviewState`, the
 * rejection reason, the sha and what was attested are the publisher's own
 * business and nobody else's — a buyer has no need to read why a version
 * they will never be offered was sent back. So this branch demands a token
 * and org membership rather than widening what the public route returns.
 */
const publisherVersions: PluginApiHandler = async (req, res) => {
  const listingId = String(req.query?.listingId ?? '')
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const firestore = firebaseAdmin.app().firestore()
  const listingRef = firestore.collection('marketplaceListings').doc(listingId)
  const listingSnapshot = await listingRef.get()
  const listing = listingSnapshot.data()
  if (!listing || listing.deletedAt) {
    return res.status(404).json({ error: 'Unknown listing' })
  }
  // Listings are org-owned (AGL-652), so this is an org-membership question,
  // not a uid comparison — the same gate the publish and edit paths use.
  const isPublisher = await canActAsPublisher(
    firestore,
    decoded.uid,
    listing.profileId,
  )
  if (!isPublisher && decoded['staff'] !== true) {
    // 404, not 403: whether a listing exists is not a stranger's business.
    return res.status(404).json({ error: 'Unknown listing' })
  }
  const artifactType = listingArtifactType(listing)
  const snapshot = await listingRef
    .collection(versionCollectionFor(artifactType))
    .orderBy('publishedAt', 'desc')
    .limit(20)
    .get()
  const versions = snapshot.docs.map((doc) => {
    const sha256 = String(doc.get('sha256') ?? '')
    return {
      version: String(doc.get('version') ?? doc.id),
      publishedAtMs: doc.get('publishedAt')?.toMillis?.() ?? null,
      sha256,
      // Absent on every version published before AGL-966, which is what
      // `grandfathered` marks — those were never reviewed and saying
      // "pending" about them would be a lie in both directions.
      reviewState: String(doc.get('reviewState') ?? ''),
      grandfathered: Boolean(doc.get('grandfathered')),
      signed: Boolean(doc.get('signature')),
      changelog: String(doc.get('changelog') ?? ''),
      // Only reached an email before this (AGL-1079), where it got buried
      // under everything else in an inbox.
      rejectionReason: String(doc.get('reviewRejectionReason') ?? ''),
      activeInstalls: Number(doc.get('activeInstalls') ?? 0),
      // What they claimed about THESE bytes (AGL-969) — so they can see it
      // before they claim it again on the next version.
      attestation: attestationsForBytes(
        doc.get('publisherAttestation') as never,
        sha256,
      ),
    }
  })
  return res.status(200).json({
    versions,
    // The version installs actually resolve to (AGL-1016/966). Deliberately
    // NOT `latestVersion`, which names a version installs may refuse.
    latestApprovedVersion: String(listing.latestApprovedVersion ?? ''),
    latestVersion: String(listing.latestVersion ?? ''),
    reviewStatus: String(listing.reviewStatus ?? ''),
  })
}

/**
 * Public version history for a plugin listing (AGL-431). The
 * `pluginVersions` docs are server-only (they carry publish internals),
 * but their changelog/trust/compat fields are exactly what a buyer needs
 * on the detail page — so this handler exposes THAT subset and nothing
 * else (no objectPath, no signature; sha stays out simply because the
 * client has no use for it).
 */
export const listingVersionsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.query?.listingId ?? '')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  try {
    // The publisher's own view (AGL-1079) — same collection, a different
    // question, and one that needs a token.
    if (String(req.query?.scope ?? '') === 'publisher') {
      return await publisherVersions(req, res)
    }
    const listingRef = firebaseAdmin
      .app()
      .firestore()
      .collection('marketplaceListings')
      .doc(listingId)
    // Every artifact type has a version history now (AGL-1036), not just
    // plugins: the per-version install counts are worth the same to whoever
    // publishes a component as to whoever publishes a plugin. The collection
    // differs — plugins keep publish internals in `pluginVersions`, everything
    // else keeps content snapshots in `versions` — so the type decides which
    // to read, and the buyer-safe projection below stays the same either way.
    const listingSnapshot = await listingRef.get()
    const artifactType = listingArtifactType(listingSnapshot.data() ?? {})
    const isPlugin = artifactType === 'plugin'
    const snapshot = await listingRef
      .collection(versionCollectionFor(artifactType))
      .orderBy('publishedAt', 'desc')
      .limit(20)
      .get()
    // Buyers see APPROVED versions only (AGL-976).
    //
    // This handler returned every version, so the listing's Version history
    // advertised pending and rejected ones — with `Latest` on whichever was
    // newest. A version rejected for undeclared network access was shown to
    // buyers, by us, as the current release, changelog and all. Installing it
    // was already impossible (AGL-966 gates that), which made the card a
    // promise the product would not keep.
    //
    // Plugins only: `reviewState` is a plugin concept, and a copied artifact's
    // `versions` docs carry none — filtering those would empty every
    // component and template history.
    //
    // Through `isVersionApproved`, whose contract is the one that matters
    // here: ABSENT STATE IS NOT APPROVAL. That hides versions published
    // before review existed, which is the safe direction — the alternative is
    // showing unreviewed code as reviewed.
    const visibleDocs = isPlugin
      ? snapshot.docs.filter((doc) => isVersionApproved({
          reviewState: doc.get('reviewState'),
        }))
      : snapshot.docs
    const versions = visibleDocs.map((doc) => ({
      version: String(doc.get('version') ?? doc.id),
      // Per-version install counts (AGL-1036). `installCount` is every install
      // that ever landed on this version; `activeInstalls` is how many are on
      // it now — the one that answers "who is still on the old version".
      installCount: Number(doc.get('installCount') ?? 0),
      activeInstalls: Number(doc.get('activeInstalls') ?? 0),
      ...(doc.get('changelog') ? { changelog: String(doc.get('changelog')) } : {}),
      ...(doc.get('trust') ? { trust: String(doc.get('trust')) } : {}),
      ...(Number.isInteger(doc.get('manifest')?.hostAbi)
        ? { hostAbi: Number(doc.get('manifest').hostAbi) }
        : {}),
      // Declared network allowlist (AGL-879 follow-up): the plugin origin
      // builds the /load CSP `connect-src` from this, so the sandbox only
      // reaches origins the manifest declared. Already buyer-visible in
      // review ("Capabilities: network N"), so exposing the origins here
      // leaks nothing new.
      ...(Array.isArray(doc.get('manifest')?.capabilities?.network)
        ? {
            network: (doc.get('manifest').capabilities.network as unknown[])
              .map((entry) => String(entry))
              .filter((entry) => /^https:\/\/[^\s/]+$/.test(entry))
              .slice(0, 20),
          }
        : {}),
      publishedAtMs: doc.get('publishedAt')?.toMillis?.() ?? null,
    }))

    // Repair `latestApprovedVersion` when it is missing or behind (AGL-1016).
    //
    // The field is written by the approval route, so every plugin approved
    // before it existed carries none — and the console would report those as
    // "no published version to compare against" forever, which is a worse lie
    // than the one it replaced. The approved set is already in hand here and
    // `pluginVersions` is server-only, so this is the one place that can
    // repair it. Idempotent, and it only ever moves the value forward.
    // Plugins only: `reviewState` and the approved-version guarantee are a
    // plugin concept, and a copied artifact's `versions` docs carry neither.
    const newest = !isPlugin
      ? null
      : (newestApprovedVersion(
          snapshot.docs.map((doc) => ({
            version: String(doc.get('version') ?? doc.id),
            reviewState: doc.get('reviewState'),
            publishedAt: doc.get('publishedAt'),
          })) as never,
        ) as { version?: string } | null)
    if (newest?.version) {
      const stored = listingSnapshot.get('latestApprovedVersion')
      if (
        stored == null ||
        (compareArtifactVersions(String(stored), newest.version) ?? 0) < 0
      ) {
        await listingRef
          .set({ latestApprovedVersion: newest.version }, { merge: true })
          .catch(() => undefined)
      }
    }

    return res.status(200).json({ versions })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Version lookup failed' })
  }
}
