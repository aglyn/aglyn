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

import { checkQuota, createResourceUid } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { canActAsPublisher } from './publisher-profile'
import { requirePurchase } from './purchase-entitlement'
import { recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'
import {
  isPrivateListing,
  listingArtifactType,
} from '../model/marketplace'

/**
 * Installs a site template into a host's TEMPLATE LIBRARY (AGL-137,
 * reworked by AGL-669).
 *
 * This used to instantiate screens and write routing-map entries in the
 * same call, which made installed pages public the instant you clicked
 * install — browsing the marketplace could publish to a production site by
 * mis-click. Now it only writes to `hosts/{hostId}/templates`; creating
 * pages is a separate, deliberate step (AGL-670).
 *
 * The snapshot's screens become one page template each, sharing a
 * `source.listingId` so the library can group them and the user can pick
 * which ones to use. The theme is carried on the templates rather than
 * applied — a theme change is site-wide and instant, the same class of
 * surprise this removed.
 *
 * Access is unchanged: free, purchased, or your own listing. Still
 * server-side because version snapshots are not client-readable.
 */
export const installTemplateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  // `applyTheme` is accepted and ignored (AGL-669): installing no longer
  // touches the host doc, so there is nothing to apply. Kept in the
  // signature so existing callers don't break.
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
        error: 'Your organization role does not allow installing from the marketplace',
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

    const listingRef = firestore
      .collection('marketplaceListings')
      .doc(listingId)
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
      listingArtifactType(listing) !== 'template'
    ) {
      return res.status(404).json({ error: 'Unknown template' })
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
    const template = versionSnapshot.get('template') as any
    const screens: any[] = Array.isArray(template?.screens)
      ? template.screens
      : []
    if (!screens.length) {
      return res.status(500).json({ error: 'Template version missing' })
    }

    // Template-library quota, not screensPerHost: nothing becomes a screen
    // here. The screen cap is enforced later, when pages are actually
    // created from these (AGL-670). Enforced for every org, since a
    // plan-less org resolves as `free` (not unmetered).
    const org = (await getOrgForHost(hostId))?.org
    const templatesRef = hostRef.collection('templates')
    /**
     * The library slots this install would spend, off a set of template docs.
     *
     * Templates from THIS listing are about to be replaced, so counting them
     * would make a re-install look like it doubles the library and fail the
     * quota on an update the user is entitled to. Platform-seeded starters are
     * excluded for the same reason the resources route excludes them
     * (AGL-687): they are not the user's spend of their template allowance.
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
          !entry.get('deletedAt') &&
          entry.get('source.type') !== 'starter' &&
          entry.get('source.listingId') !== listingId,
      ).length +
      screens.length -
      1
    const overQuota = (limit: number) =>
      `This template adds ${screens.length} template${
        screens.length === 1 ? '' : 's'
      } to your library — your plan allows ${limit}. ` +
      'See Billing to upgrade.'
    {
      // The fast refusal. NOT the enforcement point — see the transaction
      // below — but it keeps the base-snapshot write and the version tally off
      // the path of an install that was never going to be allowed, and it is
      // what answers a caller who is simply over their limit.
      const quota = checkQuota(
        org as any,
        'templatesPerHost',
        slotsAfterInstall(await templatesRef.get().then((snap) => snap.docs)),
      )
      if (!quota.allowed) {
        return res.status(403).json({ error: overQuota(quota.limit) })
      }
    }

    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    // Shared across the bundle so the library can group these as one
    // install and offer them together.
    const source = {
      type: 'marketplace' as const,
      listingId,
      version: listing.latestVersion ?? null,
    }
    // Provenance + base snapshot (AGL-1015). One snapshot for the whole
    // bundle, matching how the bundle is replaced: the published screens carry
    // no stable identity, so per-template bases would key on nothing and could
    // not be paired back up on update.
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
      artifactType: 'template',
      content: { screens, ...(template.theme ? { theme: template.theme } : {}) },
    })
    /**
     * Re-installing the same listing REPLACES its previous bundle rather than
     * stacking a second copy (AGL-671) — that is what makes "Update available"
     * actionable with no separate refresh route. Matching old templates to new
     * ones individually is not possible: a published snapshot's screens carry
     * no stable identity, only a displayName and slug, so any pairing would be
     * a guess. Replacing the bundle wholesale is honest about that. Pages
     * already created from the old templates are untouched — they are ordinary
     * screens with no link back.
     *
     * THE ENFORCEMENT POINT: the count, the decision and every write in ONE
     * transaction (AGL-2371, the AGL-2231 treatment).
     *
     * The check above ran, then `recordInstallProvenance` awaited, then a
     * second query awaited, and only then did a `WriteBatch` commit. Every
     * await is a yield, so N concurrent installs each read the same pre-count,
     * each found room, and each landed — and nothing re-counts afterwards, so
     * a free plan's ten templates became two hundred by clicking install
     * twenty times. A batch is atomic but NOT conditional on a read taken
     * before it, which is the same lesson AGL-2369 paid for one route over.
     *
     * `tx.get` on the templates collection takes a pessimistic lock on every
     * document it matched, so the loser of a race retries, re-reads the higher
     * count and is refused.
     *
     * The `source.listingId` query is GONE: the superseded bundle is a subset
     * of the rows just counted, so deriving it here costs no read and — more to
     * the point — cannot disagree with the count the decision was made from.
     * That disagreement was its own latent bug: the count said one thing about
     * the library and the replacement set was fetched from a later state.
     *
     * A refusal comes back as data and is rendered outside. Building a response
     * inside a body that can run several times reads as if the transaction were
     * a place effects happen.
     *
     * The 500-write ceiling is unchanged: the `WriteBatch` this replaces
     * carried the same replacements and the same creates and had the same
     * limit, so a bundle too large to commit was already too large. That is
     * why this is not AGL-2370 — there the import chunks PAST 500 deliberately
     * and cannot be wrapped at all.
     */
    const outcome = await firestore.runTransaction<
      | { error: string }
      | { created: number; replaced: number; from: string | number | null }
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
        (entry) => entry.get('source.listingId') === listingId,
      )
      let replaced = 0
      for (const stale of superseded) {
        if (stale.get('deletedAt')) continue
        tx.update(stale.ref, { deletedAt: now, updatedAt: now })
        replaced += 1
      }
      let created = 0
      for (const screen of screens) {
        tx.set(templatesRef.doc(createResourceUid()), {
          kind: 'page',
          displayName: String(screen.displayName ?? 'Page').slice(0, 80),
          ...(screen.description && { description: screen.description }),
          ...(screen.seo && { seo: screen.seo }),
          // A suggestion only — de-conflicted against the routing map when a
          // page is actually created from this.
          ...(screen.slug && { slug: String(screen.slug) }),
          nodes: screen.nodes,
          // Carried, not applied: see the note on AglynTemplate.theme. The
          // `applyTheme` request flag is now meaningless here — nothing is
          // applied at install — so the theme always travels with the
          // template and the decision moves to whoever uses it.
          ...(template.theme ? { theme: template.theme } : {}),
          source,
          installedFrom: provenance.installedFrom,
          createdAt: now,
          updatedAt: now,
        })
        created += 1
      }
      // Per-version tally input (AGL-1036). A bundle is one install however
      // many templates it lands, so the version it left is read off the first
      // superseded doc rather than counted per template — and off the docs the
      // transaction actually replaced, not a snapshot taken beside it.
      return {
        created,
        replaced,
        from:
          superseded[0]?.get('installedFrom.version') ??
          superseded[0]?.get('source.version') ??
          null,
      }
    })
    if ('error' in outcome) {
      return res.status(403).json({ error: outcome.error })
    }
    const { created, replaced } = outcome

    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'template',
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
      templates: created,
      /** Prior templates from this listing, superseded by this install. */
      replaced,
      version: listing.latestVersion ?? null,
      baseStored: provenance.baseStored,
      // Retained so an older client doesn't render "Added undefined screens".
      screens: 0,
      // `themeApplied: false` used to ride along here and is GONE (AGL-2339).
      // It had zero references anywhere in the repo — not a client, not a
      // spec, not a type — so unlike `screens` above it was not back-compat
      // for anything. A hardcoded `false` returned as a result is worse than
      // an absent field: it reads as a measured fact, and the first caller to
      // trust it would have been told a template install never applies a
      // theme by something that never looked.
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Template install failed' })
  }
}
