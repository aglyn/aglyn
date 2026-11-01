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

import { merchantAccountIsReady } from '@aglyn/tenant-data-admin/server/payment-provider'
import {
  checkEntitlement,
  isListingWideRevocation,
  resolveMarketplaceFeePct,
  type PluginRevocation,
} from '@aglyn/aglyn/server'
import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { SITE_STARTER_ARTIFACT_TYPE } from '@aglyn/aglyn/app-utils/site-starter'
import { isListingBrowsable, isPrivateListing, listingArtifactType } from '../model/marketplace'
import { canActAsPublisher, resolvePublisherProfile } from './publisher-profile'
import { hasLivePurchase } from './purchase-entitlement'
import { isOrgMember } from './sale-risk'

/**
 * THE TAX CLASSIFICATION OF A MARKETPLACE SALE (AGL-1553).
 *
 * "Software as a service (SaaS) — business use". Sent explicitly on the line
 * item below, because this session builds its product ad hoc from
 * `price_data` and an ad-hoc product with no `tax_code` is classified by the
 * ACCOUNT-LEVEL preset instead — a value set by hand in the Stripe Dashboard
 * for Aglyn's own subscription products (AGL-1537/1877), which happens to be
 * this same string.
 *
 * So this is not a change of tax position, and deliberately not: it is the
 * position Aglyn already collects on, already verified, and already states in
 * a signed filing. The pending Texas private letter ruling request proposes at
 * Part 6.1 that plugin charges are DATA PROCESSING SERVICES under Tax Code
 * § 151.0035, of which § 151.351 exempts 20%, so tax is due on 80% of the
 * charge; Part 4.5 ¶ 4 represents to the Comptroller that "the payment
 * processor's tax classification applied to these charges is the
 * software-as-a-service category" and that the 80% measure was confirmed by
 * computation. AGL-1817 ran that computation against the live account: $6.60
 * of tax on a $100.00 charge at an 8.25% Texas address — 8.25% x $80.
 *
 * What was actually broken is that none of that was expressed HERE. The
 * classification of every marketplace sale hung on a Dashboard field owned by
 * a different product line. Re-preset the account for storefront goods or
 * bookings and these sales silently re-classify, moving the Texas base off the
 * 80% the filing describes — with no diff to review, no failing test, and no
 * symptom short of reconciling a return. Naming it here is what makes the
 * filed representation survive a Dashboard edit.
 *
 * NOT merged with `PLATFORM_TAX_CODE` in `tools/scripts/lib/stripe-tax-code.mjs`,
 * which stamps Aglyn's OWN products with the same string today. They answer
 * different questions — Aglyn's first-party subscription vs. a third party's
 * sale through Aglyn's marketplace — and the ruling request itself flags at
 * Part 8 ¶ 8 that the Comptroller could characterize the two differently. One
 * shared constant would make a divergence the filing anticipates impossible to
 * express without touching the other business.
 *
 * DO NOT change this value to a downloadable-software code (`txcd_10202003`,
 * `txcd_10203001`) on the reasoning that a plugin is "downloaded". That is the
 * OPPOSING characterization — tangible personal property under Rule 3.308,
 * taxable in full — which Part 6.1 argues against and which the filing already
 * states against itself, in full, at Part 8 ¶¶ 1-2. Adopting
 * it here would raise the tax charged to every buyer by a quarter of the base
 * and make Part 4.5 ¶ 4 false. It is the Comptroller's call, and if the ruling
 * goes that way the change is a one-line edit at this constant plus a
 * prospective conformance — which is exactly what naming it here buys.
 */
export const MARKETPLACE_TAX_CODE = 'txcd_10103001'

/** Who is buying: the person, the workspace the licence is for, and what they may do in it. */
export interface SaleBuyer {
  uid: string
  orgId: string
  permissions: { createHosts?: boolean; installPlugins?: boolean }
}

/** One sale, decided: everything the payment doors need and nothing they chose. */
export interface MarketplaceSale {
  listing: Record<string, any>
  /** A site starter is bought to create a site with, everything else to install. */
  siteStarter: boolean
  sellerOrgId: string
  feePercent: number
  amountCents: number
  feeCents: number
  /** What the seller receives: 0 when the platform's own org is the seller. */
  transferCents: number
  /** The seller's Connect account; absent when {@link platformSale}. */
  accountId: string | undefined
  /** The platform's own org is selling, so no transfer is made at all. */
  platformSale: boolean
}

/** The answer a door sends instead of taking money: the status and body, decided together. */
export interface SaleRefusal {
  status: number
  body: Record<string, unknown>
}

export type SaleResolution = { sale: MarketplaceSale } | { refusal: SaleRefusal }

const refuse = (status: number, body: Record<string, unknown>): SaleResolution => ({
  refusal: { status, body },
})

/**
 * EVERYTHING A MARKETPLACE SALE DECIDES BEFORE STRIPE (AGL-4049).
 *
 * One value, for both doors that take money for a listing: the hosted
 * checkout (`checkout.ts`) and the in-app payment (`pay.ts`). A second copy of
 * these gates is how a door comes to sell something the other refuses, and
 * every refusal below has already cost a real sale or a real refund to learn.
 *
 * The caller has settled WHO is buying, through the person's own membership;
 * this settles whether that workspace may buy this listing, from this seller,
 * today, and at what split.
 *
 * Deliberately before the door's idempotency claim, so none of these burns the
 * key: each is a state somebody fixes before pressing the same button again.
 */
export async function resolveSale(input: {
  firestore: FirebaseFirestore.Firestore
  listingId: string
  buyer: SaleBuyer
}): Promise<SaleResolution> {
  const { firestore, listingId, buyer } = input
  const listingSnapshot = await firestore
    .collection('marketplaceListings')
    .doc(listingId)
    .get()
  const listing = listingSnapshot.data() as any
  if (!listing || listing.deletedAt) {
    return refuse(404, { error: 'Unknown listing' })
  }
  // A site starter is bought to create a site with (AGL-4049), so buying
  // one takes the permission that creates sites, as picking one in Create
  // site does; everything else is bought to install, as before. Asked of
  // the listing, never of the request, and before anything else about the
  // sale is read.
  const siteStarter = listingArtifactType(listing) === SITE_STARTER_ARTIFACT_TYPE
  if (siteStarter ? !buyer.permissions.createHosts : !buyer.permissions.installPlugins) {
    return refuse(403, {
      error: siteStarter
        ? permissionRefusalText('hosts.create')
        : 'Your organization role does not allow installing from the marketplace',
    })
  }
  // Review gating holds on the PAID path too (AGL-1543): browse hides
  // rejected/submitted/in_review listings, so a direct checkout call must
  // not be a side door that takes money for one. Absent = legacy = listed
  // (AGL-432), and the same 404 as an unknown listing — purchasability is
  // not a probe for review state.
  const reviewStatus = listing.reviewStatus as string | undefined
  if (reviewStatus && reviewStatus !== 'listed' && reviewStatus !== 'verified') {
    return refuse(404, { error: 'Unknown listing' })
  }
  // A TAKEN-DOWN or PRIVATE listing is not on sale (AGL-2288).
  //
  // The check above is a hand-rolled subset of `isListingBrowsable`, and
  // the two lines it dropped are the two that matter here: `hiddenAt` and
  // `isPrivateListing`. A staff takedown does NOT set a blocking
  // `reviewStatus` — `plugin-reviews` demotes a verified listing to
  // `VERIFIED_STRIPPED_STATUS`, which is literally `'listed'` — so after a
  // takedown this route read `reviewStatus: 'listed'` and sold the listing
  // in full, while `install-plugin` refused the very same listing at
  // `hiddenAt` with a 404. The buyer was charged for something the platform
  // had already decided nobody may install, and the only way out was a
  // refund — which is Aglyn's Stripe fee, Aglyn's support time, and (until
  // the partial-refund fix) a real hole in the split.
  //
  // Both tests are kept rather than replaced by the shared predicate: for a
  // NON-plugin artifact `isListingBrowsable` returns true whatever the
  // review status says, because pre-publication review is plugin-only. This
  // route has always been stricter than that, and a sale is the wrong place
  // to loosen a gate.
  //
  // No owner exemption, unlike the install routes: `canActAsPublisher`
  // below already refuses a publisher buying their own listing, so the
  // buyer here is never the owner.
  if (!isListingBrowsable(listing) || isPrivateListing(listing)) {
    return refuse(404, { error: 'Unknown listing' })
  }
  const priceUsd = Number(listing.priceUsd ?? 0)
  if (!(priceUsd > 0)) {
    return refuse(400, { error: 'Listing is free' })
  }
  // Publishing is org-owned (AGL-652): `profileId` IS the publisher org id.
  const sellerOrgId = String(listing.profileId ?? '')
  // ANY member of the publishing workspace, and any purchase FOR it
  // (AGL-3365). `canActAsPublisher` asks only for an owner or admin, so an
  // editor of the publisher — or an owner buying "for" the publisher's own
  // workspace through a role that can install — passed it, and a publisher
  // could pay itself: the stolen-card cash-out the payout exists to make
  // worth doing. A workspace one step removed is the sale screen's to flag.
  if (
    buyer.orgId === sellerOrgId ||
    (await canActAsPublisher(firestore, buyer.uid, sellerOrgId)) ||
    (await isOrgMember(firestore, sellerOrgId, buyer.uid))
  ) {
    return refuse(400, { error: 'Your organization published this listing' })
  }
  // You cannot buy the same component twice (AGL-1697).
  //
  // This route validated review status, self-purchase and the seller's
  // entitlements, and then never asked the one question the buyer cares
  // about: do they already own it. A marketplace listing is a buy-once good —
  // a second purchase buys nothing, since `requirePurchase` is satisfied by
  // the first — so a buyer who clicked Buy again from a stale tab, or came
  // back through a bookmarked checkout, was simply charged twice for it.
  //
  // Deliberately the SAME predicate the seven install routes gate on
  // (AGL-1546/1699) rather than a second query beside it: "has this buyer
  // paid for this listing" must have one answer, or the marketplace can take
  // money for something it will not install, or refuse to sell something it
  // will not install either. That predicate reads a fully REFUNDED purchase
  // as absent, which is exactly right here too — a refunded buyer must be
  // able to buy again, and a refunded row sitting beside a live one does not
  // veto it.
  //
  // 409 rather than 400: nothing about the request is malformed, the buyer
  // is just asking for a state that already holds.
  //
  // KEYED ON THE ORGANIZATION SINCE AGL-2331, and that is what turns this
  // guard from a blocked sale back into a real one. A licence belongs to a
  // workspace, so an agency developer who bought a component for one client
  // must be able to buy it again for the next — the person-keyed version of
  // this check answered `409 already_purchased` to exactly the second sale
  // we want. It still refuses the case it was written for: the same
  // workspace buying the same listing twice.
  //
  // A pre-AGL-2331 purchase still refuses, through the legacy grant inside
  // the shared predicate: that buyer can already install this listing
  // anywhere, so selling them a second copy would take money for nothing.
  if (
    await hasLivePurchase({
      firestore,
      buyerUid: buyer.uid,
      buyerOrgId: buyer.orgId,
      listingId,
    })
  ) {
    return refuse(409, {
      error:
        'This organization already owns this listing — install it from ' +
        'your library.',
      code: 'already_purchased',
    })
  }
  // The kill switch, on the SELL side too (AGL-2288).
  //
  // `revocations/{listingId}` with `versions: 'all'` is the listing-wide
  // kill: `install-plugin` 409s on it through this same predicate, and the
  // tenant runtime renders the disabled placeholder for anything already
  // pinned. Selling into that state takes money for an artifact the
  // platform has switched off.
  //
  // Only `'all'` is consulted, deliberately. A per-version revocation
  // (AGL-1085) stops one build while other approved versions stay
  // installable, and refusing the sale for it would turn a targeted control
  // into a de-listing. Whether the newest approved version happens to be
  // the revoked one is a question `install-plugin` answers with live data;
  // duplicating that resolution here would be a second copy of it.
  //
  // One extra read on a path that already makes several Firestore and
  // Stripe round trips, and it is the cheap half of the takedown check
  // above: a hand-written revocation doc — which the rules permit any staff
  // client to write — is caught here even when `hiddenAt` was never set.
  const revocation = (
    await firestore.collection('revocations').doc(listingId).get()
  ).data() as PluginRevocation | undefined
  if (isListingWideRevocation(revocation)) {
    return refuse(404, { error: 'Unknown listing' })
  }
  const publisher = await resolvePublisherProfile(firestore, sellerOrgId)
  const accountId = publisher?.stripeAccountId
  if (
    !merchantAccountIsReady(
      {
        accountId,
        chargesEnabled: publisher?.stripeChargesEnabled,
        accountLivemode: publisher?.stripeAccountLivemode,
      },
      { subject: `marketplace publisher org ${sellerOrgId}` },
    )
  ) {
    return refuse(409, { error: 'The publisher has not enabled payouts yet' })
  }

  // The platform's cut comes from ENTITLEMENTS (AGL-1543), never the raw
  // `plan` field: `resolveMarketplaceFeePct` prices a dead subscription
  // as free-plan (30%) while the stale field still says pro, and honors
  // a negotiated per-org `marketplaceFeePct` override. Same read gates
  // SALE time on `marketplaceSelling` — publish already refuses without
  // it, and a publisher who downgrades must stop selling, not merely
  // stop publishing. Resolved per request; entitlements are never cached.
  const sellerOrgDoc = await firestore.collection('orgs').doc(sellerOrgId).get()
  const sellerOrg = (sellerOrgDoc.data() ?? {}) as any
  // A LOCKED publisher sells nothing (AGL-3365). Any lock, not only a
  // security one: a sale to a workspace staff have stopped is money moving
  // to it, and the lockdown's payout pause cannot reach a share that is
  // never charged. The same answer as a taken-down listing — a lock is not
  // a buyer's business.
  if (sellerOrg.suspendedAt != null) {
    return refuse(404, { error: 'Unknown listing' })
  }
  if (!checkEntitlement(sellerOrg, 'marketplaceSelling')) {
    return refuse(409, {
      error:
        "The publisher's current plan does not include marketplace selling",
    })
  }
  const feePercent = resolveMarketplaceFeePct(sellerOrg)
  const amountCents = Math.round(priceUsd * 100)
  const feeCents = Math.round((amountCents * feePercent) / 100)
  return {
    sale: {
      listing,
      siteStarter,
      sellerOrgId,
      feePercent,
      amountCents,
      feeCents,
      transferCents: amountCents - feeCents,
      accountId,
      platformSale: false,
    },
  }
}
