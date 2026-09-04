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
  checkQuota,
  createResourceUid,
  decodeStoredNodes,
  encodeStoredNodes,
} from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  isPrivateListing,
  listingArtifactType,
} from '../model/marketplace'
import { canActAsPublisher } from './publisher-profile'
import { requirePurchase } from './purchase-entitlement'
import { hasDivergedFromBase, recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'

/**
 * Installs a marketplace layout into a host's template library (AGL-671).
 *
 * Lands as a `kind: 'layout'` template rather than a live layout, for the
 * same reason template installs do (AGL-669): installing must never change
 * a running site. Creating the actual layout is the deliberate second step
 * in the templates library.
 *
 * Access mirrors template installs: free, purchased, or your own listing.
 */
export const installLayoutHandler: PluginApiHandler = async (req, res) => {
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
          'Your organization role does not allow installing from the marketplace',
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

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      // Staff takedown blocks new installs on EVERY artifact type
      // (AGL-2290). AGL-948 extended takedown past plugins in the browse
      // predicate and in `resolveMarketplacePluginVersion`, but the gate that
      // decides whether content is HANDED OVER was only ever added to
      // `install-plugin.ts`. So a component, theme, template, layout, email
      // template or dataset schema that staff had taken down stayed
      // installable by anyone holding its listing id — which makes takedown a
      // suggestion for six of the seven artifact types.
      //
      // No owner exemption, matching `install-plugin.ts`: a takedown is a
      // moderation decision about the artifact, not about who is asking.
      listing.hiddenAt ||
      listingArtifactType(listing) !== 'layout'
    ) {
      return res.status(404).json({ error: 'Unknown layout' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    // Private listings install ONLY for the owning org (AGL-2290).
    //
    // `install-plugin.ts` has carried this since AGL-968; the other six never
    // did, so a private component, theme, template, layout, email template or
    // dataset schema was installable by anyone who knew its listing id. Browse
    // hides them and the detail page 404s, but neither is a control — the
    // route is.
    if (isPrivateListing(listing) && !ownsListing) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    // A FULLY refunded purchase stops entitling (AGL-1546), and until
    // AGL-1699 only the component route knew that: this one asked whether a
    // purchase doc EXISTED, so buy/install/refund kept the artifact. The
    // predicate lives in one place now so the next route cannot miss it.
    const unpaid = await requirePurchase({
      firestore,
      buyerUid: decoded.uid,
      // THE ORG THE LICENCE HAS TO COVER (AGL-2331). `membership.orgId` is
      // resolved server-side from the caller's own membership by the
      // permission gate above — never a request-body field — so this is the
      // workspace the install actually lands in, and the only one a purchase
      // can entitle here.
      buyerOrgId: membership.orgId ?? '',
      listingId,
      priceUsd,
      ownsListing,
    })
    if (unpaid) return res.status(402).json(unpaid)

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    const layout = versionSnapshot.get('layout') as any
    if (!layout?.nodes || !Object.keys(layout.nodes).length) {
      return res.status(500).json({ error: 'Layout version missing' })
    }

    const org = (await getOrgForHost(hostId))?.org
    const templatesRef = hostRef.collection('templates')
    /**
     * The library slots this install would spend, off a set of template docs.
     *
     * The copy this listing already installed is about to be replaced, so
     * counting it would fail the quota on an update the user is entitled to.
     *
     * A function rather than an inlined filter because the count is now taken
     * TWICE — once here as a fast refusal, once inside the transaction as the
     * authority — and two copies of a counting rule is how the rule drifts.
     */
    const slotsAfterInstall = (
      docs: Array<FirebaseFirestore.QueryDocumentSnapshot>,
    ) =>
      docs.filter(
        (entry) =>
          !entry.get('deletedAt') && entry.get('source.listingId') !== listingId,
      ).length
    const overQuota = (limit: number) =>
      `Your plan allows ${limit} templates — see Billing to upgrade.`
    const existing = await templatesRef.get()
    {
      // The fast refusal. NOT the enforcement point — see the transaction
      // below — but it keeps the base-snapshot write and the version tally off
      // the path of an install that was never going to be allowed, and it is
      // what answers a caller who is simply over their limit.
      const quota = checkQuota(
        org as any,
        'templatesPerHost',
        slotsAfterInstall(existing.docs),
      )
      if (!quota.allowed) {
        return res.status(403).json({ error: overQuota(quota.limit) })
      }
    }

    // Replacing a layout the workspace has edited destroys those edits — the
    // old doc is soft-deleted, so the change is invisible until someone goes
    // looking for it. Refuse unless the caller has been shown what goes and
    // asked for a replacement anyway (AGL-1018).
    const installedLayout = existing.docs.find(
      (entry) =>
        !entry.get('deletedAt') && entry.get('source.listingId') === listingId,
    )
    if (installedLayout) {
      const diverged = await hasDivergedFromBase({
        firestore,
        sha256: installedLayout.get('installedFrom.sha256'),
        current: {
          rootId: installedLayout.get('rootId'),
          // DECODED, because the comparison is by value: the base snapshot
          // recorded at install is a node map, and `hasDivergedFromBase`
          // hashes a stable stringification of both sides. A stored `Bytes`
          // never matches a map, so an untouched copy would read as edited
          // and every re-install would be refused as a divergence
          // (AGL-1151).
          nodes: decodeStoredNodes(installedLayout.get('nodes')),
        },
      })
      if (diverged && req.body?.mode !== 'replace') {
        return res.status(409).json({
          error:
            'Your copy of this layout has been edited since it was installed. ' +
            'Review the update to see what would change.',
          diverged: true,
        })
      }
    }
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Provenance + base snapshot (AGL-1015) — the layout tree as published,
    // without the display name the user is free to change.
    //
    // Stays OUTSIDE the transaction below: it does its own read and write, and
    // repeating those on every retry attempt is exactly what a transaction
    // body must not do. That is safe because the base collection is
    // content-addressed and shared — a race that ends in a refusal leaves at
    // most a snapshot of a published version, keyed by its own hash, which the
    // next successful install of that version reuses.
    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version: listing.latestVersion,
      artifactType: 'layout',
      content: { rootId: layout.rootId, nodes: layout.nodes },
    })
    /**
     * Re-install replaces the prior copy rather than stacking (AGL-671).
     *
     * THE ENFORCEMENT POINT: the count, the decision and every write in ONE
     * transaction (AGL-2371, the AGL-2231 treatment).
     *
     * The check above ran, then `hasDivergedFromBase` awaited, then
     * `recordInstallProvenance` awaited, and only then did a `WriteBatch`
     * commit. Every await is a yield, so N concurrent installs each read the
     * same pre-count, each found room, and each landed — and nothing re-counts
     * afterwards, so the extra templates were permanent. A batch is atomic but
     * NOT conditional on a read taken before it, which is the same lesson
     * AGL-2369 paid for one route over.
     *
     * `tx.get` on the templates collection takes a pessimistic lock on every
     * document it matched, so the loser of a race retries, re-reads the higher
     * count and is refused.
     *
     * The DIVERGENCE gate above deliberately stays outside. It is not a count:
     * it asks whether this workspace edited its own copy, which no concurrent
     * install of a different listing can change, and it reads a base snapshot
     * through a helper that does its own `get`.
     *
     * A refusal comes back as data and is rendered outside. Building a response
     * inside a body that can run several times reads as if the transaction were
     * a place effects happen.
     */
    const outcome = await firestore.runTransaction<
      { error: string } | { replaced: number; from: string | number | null }
    >(async (tx) => {
      const live = await tx.get(templatesRef)
      const quota = checkQuota(
        org as any,
        'templatesPerHost',
        slotsAfterInstall(live.docs),
      )
      if (!quota.allowed) return { error: overQuota(quota.limit) }

      // ALL READS BEFORE THE WRITES, which Firestore requires.
      const superseded = live.docs.filter(
        (entry) =>
          !entry.get('deletedAt') && entry.get('source.listingId') === listingId,
      )
      for (const stale of superseded) {
        tx.update(stale.ref, { deletedAt: now, updatedAt: now })
      }
      tx.set(templatesRef.doc(createResourceUid()), {
        kind: 'layout',
        displayName: String(listing.displayName ?? 'Layout').slice(0, 80),
        ...(listing.description && { description: listing.description }),
        rootId: layout.rootId,
        // Compressed at rest, matching the template converter (AGL-1151).
        // The provenance base recorded above keeps the decoded map: it is
        // compared by value, never opened as a document.
        nodes: Buffer.from(encodeStoredNodes(layout.nodes ?? {})!),
        source: {
          type: 'marketplace' as const,
          listingId,
          version: listing.latestVersion ?? null,
        },
        installedFrom: provenance.installedFrom,
        createdAt: now,
        updatedAt: now,
      })
      // Per-version tally input (AGL-1036): the replaced copy leaves its
      // version — read off the doc the transaction actually replaced, not off
      // the snapshot taken before it opened.
      return {
        replaced: superseded.length,
        from:
          superseded[0]?.get('installedFrom.version') ??
          superseded[0]?.get('source.version') ??
          null,
      }
    })
    if ('error' in outcome) {
      return res.status(403).json({ error: outcome.error })
    }
    const { replaced } = outcome

    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'layout',
      from: outcome.from,
      to: listing.latestVersion,
    })
    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      templates: 1,
      replaced,
      version: listing.latestVersion ?? null,
      baseStored: provenance.baseStored,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Layout install failed' })
  }
}

export default installLayoutHandler
