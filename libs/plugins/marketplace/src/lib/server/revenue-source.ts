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

/**
 * Marketplace commission on the operator's revenue report (AGL-2486,
 * AGL-3080).
 *
 * Answered through the platform's revenue source contract
 * (`@aglyn/aglyn/plugin-manager/plugin-revenue-sources`). A marketplace sale's
 * gross is mostly the PUBLISHER's money; the operator keeps a commission, and
 * that commission — net of refunds, and attributed to the listing and the
 * publisher that earned it — is what this answers.
 *
 * The commission is read from the STORED `feeCents` — the figure the rate
 * resolved at checkout actually charged — rather than re-derived from today's
 * rate. The rate is priced per sale off the SELLER org's entitlements, so a
 * plan change, an entitlement override or a lapsed subscription since the
 * sale would re-price history if this recomputed it. `gross − tax − transfer`
 * is the FALLBACK for rows written before `feeCents` was stored, and the two
 * agree by construction.
 *
 * Both refund shapes are read. The full-refund path stamps `refundedCents`
 * and the partial path stamps `partialRefundedCents` and never writes the
 * former, so reading only one silently ignores a whole class of reversal.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { storefrontProcessingCostCents } from '@aglyn/aglyn/server'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  groupRevenueAttribution,
  type RevenueAttribution,
  type RevenueSource,
  type RevenueSourceAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'

/** One `marketplacePurchases/{sessionId}` row. */
export interface MarketplaceRevenueRowInput {
  id: string
  /** Tax-INCLUSIVE gross the buyer paid. Mostly the publisher's money. */
  amountCents?: unknown
  taxCents?: unknown
  /** The commission as CHARGED, at the rate resolved at checkout. */
  feeCents?: unknown
  /** The publisher's Connect transfer. Never the operator's revenue. */
  transferCents?: unknown
  /** Set by the FULL-refund path only. */
  refundedCents?: unknown
  /** Set by the PARTIAL-refund path, which never writes `refundedCents`. */
  partialRefundedCents?: unknown
  /** WHICH listing (plugin) was sold — the attribution key. */
  listingId?: unknown
  /** The publishing org that receives the transfer. */
  sellerOrgId?: unknown
  createdAt?: unknown
}

export interface MarketplaceSettled {
  transactionCount: number
  /** What buyers paid. Mostly the publisher's. NOT the operator's revenue. */
  grossCents: number
  taxCents: number
  /** Paid out to publishers. Never the operator's. */
  sellerTransferCents: number
  /** The commission as charged. */
  commissionCents: number
  /** The pro-rata commission handed back with refunds. */
  commissionRefundedCents: number
  /** Commission net of refunds. */
  commissionNetCents: number
  /**
   * Stripe's processing cost on these sales, which the operator pays out of
   * its own balance and which is recorded NOWHERE (AGL-2486).
   *
   * Marketplace checkout is a destination charge with a fixed
   * `transfer_data[amount]` and deliberately no `application_fee_amount`, so
   * that the sales tax stays with the platform that owes it (AGL-1544). The
   * consequence is that Stripe debits its fee from the operator's balance and
   * the commission above is GROSS of that cost. There is no pass-through
   * recovering it, so this is a real uncovered cost and `commissionNetCents`
   * overstates the margin by roughly this much. Reported as an explicit
   * estimate rather than folded in silently.
   */
  estimatedProcessingCostCents: number
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

/** Marketplace commission, settled. See the module note. */
export function marketplaceSettledSummary(
  rows: readonly MarketplaceRevenueRowInput[],
): MarketplaceSettled {
  const out: MarketplaceSettled = {
    transactionCount: 0,
    grossCents: 0,
    taxCents: 0,
    sellerTransferCents: 0,
    commissionCents: 0,
    commissionRefundedCents: 0,
    commissionNetCents: 0,
    estimatedProcessingCostCents: 0,
  }
  for (const row of rows ?? []) {
    const split = marketplaceCommissionCents(row)
    out.transactionCount += 1
    out.grossCents += split.gross
    out.taxCents += split.tax
    out.sellerTransferCents += split.transfer
    out.commissionCents += split.commission
    out.commissionRefundedCents += split.commissionRefunded
    out.commissionNetCents += split.commissionNet
    out.estimatedProcessingCostCents += split.processingCost
  }
  return out
}

/**
 * One marketplace sale's commission split, in ONE place.
 *
 * Shared with the per-listing and per-publisher attribution so a table cannot
 * sum to something other than the marketplace line above it. Never below
 * zero: a transfer larger than the net is a data fault, and a negative
 * commission would quietly eat a neighboring sale's take.
 *
 * Both reversal shapes are read, and the LARGER is taken rather than their
 * sum: a sale refunded partially and then fully carries both fields, and
 * adding them would reverse more than the sale ever collected.
 */
export function marketplaceCommissionCents(
  row: MarketplaceRevenueRowInput | null,
): {
  gross: number
  tax: number
  transfer: number
  commission: number
  commissionRefunded: number
  commissionNet: number
  processingCost: number
} {
  const gross = cents(row?.amountCents)
  const tax = cents(row?.taxCents)
  const transfer = cents(row?.transferCents)
  const stored = cents(row?.feeCents)
  const commission = stored > 0 ? stored : Math.max(0, gross - tax - transfer)
  const refunded = Math.min(
    gross,
    Math.max(0, cents(row?.refundedCents), cents(row?.partialRefundedCents)),
  )
  // Pro-rata by the row's own gross, so a fully refunded sale returns exactly
  // the commission it earned and a partial returns its share.
  const commissionRefunded =
    gross > 0 ? Math.round((refunded * commission) / gross) : 0
  return {
    gross,
    tax,
    transfer,
    commission,
    commissionRefunded,
    commissionNet: commission - commissionRefunded,
    // The operator's own uncovered cost on this destination charge. The same
    // helper the storefront path recovers with, so the two cannot drift apart.
    processingCost:
      gross > refunded ? storefrontProcessingCostCents(gross - refunded) : 0,
  }
}

/** Commission by LISTING — "which plugin earned us what". */
export function marketplaceListingAttribution(
  rows: readonly MarketplaceRevenueRowInput[],
  limit = 100,
): RevenueAttribution {
  return groupRevenueAttribution(
    (rows ?? []).map((row) => {
      const split = marketplaceCommissionCents(row)
      return {
        key: String(row?.listingId ?? ''),
        detail: String(row?.sellerOrgId ?? ''),
        gain: split.commissionNet,
        loss: split.commissionRefunded,
      }
    }),
    limit,
    'Listing not recorded',
  )
}

/** Commission by PUBLISHER — whose plugins earn the operator its take. */
export function marketplacePublisherAttribution(
  rows: readonly MarketplaceRevenueRowInput[],
  limit = 100,
): RevenueAttribution {
  return groupRevenueAttribution(
    (rows ?? []).map((row) => {
      const split = marketplaceCommissionCents(row)
      return {
        key: String(row?.sellerOrgId ?? ''),
        detail: '',
        gain: split.commissionNet,
        loss: split.commissionRefunded,
      }
    }),
    limit,
    'Publisher not recorded',
  )
}

/** Cents to a plain dollar string, no currency symbol, as the report prints it. */
function dollars(value: unknown): string {
  const parsed = Number(value ?? 0)
  return ((Number.isFinite(parsed) ? parsed : 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * The marketplace's answer for one period, from figures already folded and
 * named. Pure, so what the report prints can be proved from fixtures.
 */
export function marketplaceRevenueAnswer(read: {
  settled: MarketplaceSettled
  byListing: RevenueAttribution
  byPublisher: RevenueAttribution
  truncated: boolean
}): RevenueSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { settled } = read
  return {
    id: 'marketplace',
    name: 'marketplace',
    earned: {
      label: 'Marketplace commission',
      cents: Number(settled.commissionNetCents ?? 0),
      note:
        'The platform’s cut of plugin sales, at the rate resolved from the ' +
        'seller’s entitlements when each sale settled, net of refunds. The ' +
        'buyer’s gross and the publisher’s transfer are excluded — that money ' +
        `is the publisher’s, not ${brand}’s.`,
    },
    grossToNet: [
      {
        label: 'Marketplace sales (buyer gross)',
        cents: settled.grossCents,
        deduction: false,
        note: `Mostly the publisher’s. ${brand} keeps only the commission.`,
      },
      {
        label: '— less publisher payouts',
        cents: settled.sellerTransferCents,
        deduction: true,
        note: 'The publisher’s. Transferred out.',
      },
    ],
    notes:
      Number(settled.estimatedProcessingCostCents ?? 0) > 0
        ? [
            {
              label: `~$${dollars(settled.estimatedProcessingCostCents)} of card processing on marketplace sales is NOT recovered — the commission above is gross of it`,
              tone: 'warning',
            },
          ]
        : [],
    attribution: [
      {
        id: 'byListing',
        heading: 'Marketplace commission by listing',
        unit: 'Listing',
        countLabel: 'Sales',
        empty: `No marketplace sale settled in this period. ${brand}'s commission is a share of each sale, so no sales means no commission — not a failed read.`,
        chartEmpty: 'No plugin earned a commission in this period — nothing to plot yet.',
        ...read.byListing,
      },
      {
        id: 'byPublisher',
        heading: 'Marketplace commission by publisher',
        unit: 'Publisher',
        countLabel: 'Sales',
        empty: `No publisher earned ${brand} a commission in this period.`,
        ...read.byPublisher,
      },
    ],
    truncated: read.truncated,
    failure: null,
    summary: settled,
  }
}

/**
 * The marketplace's source, registered on the console's API surface: the
 * staff revenue report awaits that surface before it asks.
 */
export const marketplaceRevenueSource: RevenueSource = {
  async read(request) {
    const firestore = firebaseAdmin.app().firestore()
    // Ranged on `createdAt` — a SINGLE-FIELD inequality on a TOP-LEVEL
    // collection, served by Firestore's automatic index. Not a collection
    // group, which is exactly why this field is safe here.
    const swept = await request.sweep<FirebaseFirestore.QueryDocumentSnapshot>(
      firestore
        .collection('marketplacePurchases')
        .where('createdAt', '>=', request.start)
        .where('createdAt', '<', request.end),
      'createdAt',
    )
    const rows: MarketplaceRevenueRowInput[] = swept.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as object),
    }))
    const settled = marketplaceSettledSummary(rows)
    const byListing = marketplaceListingAttribution(rows, request.attributionLimit)
    const byPublisher = marketplacePublisherAttribution(rows, request.attributionLimit)
    // Names read AFTER the fold has capped the rows, so the lookup is bounded
    // by what is displayed. A publisher is an organization the report already
    // read, so naming one costs nothing.
    await request.nameRows(byListing.rows, {
      collection: 'marketplaceListings',
      nameField: 'displayName',
      detailField: 'pluginId',
    })
    const orgNames = await request.orgNames([
      ...byPublisher.rows.map((row) => row.key),
      ...byListing.rows.map((row) => row.detail),
    ])
    for (const row of byPublisher.rows) {
      const name = orgNames.get(row.key)
      if (name) row.name = name
    }
    for (const row of byListing.rows) {
      const publisher = orgNames.get(row.detail)
      if (publisher) row.detail = publisher
    }
    return marketplaceRevenueAnswer({
      settled,
      byListing,
      byPublisher,
      truncated: swept.truncated,
    })
  },
}
