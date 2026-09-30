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
 * One quarter of facilitated sales, as stored and as the REAL sources answer
 * for it (AGL-3080).
 *
 * `TAX_RETURN_SOURCE_DOCS` is what the plugins' collections hold;
 * `TAX_RETURN_SOURCE_SECTIONS` is what the registered sources answer for
 * those documents in 2026-Q3, filed in Texas. `tax-return-sources-are-
 * registered.spec.ts` runs the real registrars over the documents and holds
 * the answer to the sections EXACTLY, so the page spec that renders the
 * sections is rendering what production would, not a hand-written guess.
 *
 * Distinct magnitudes per bucket on purpose — $34.00 storefront tax under the
 * platform's registration, $57.00 at a merchant's own rate, $78.00 marketplace
 * net — so a figure on screen can only have come from its own bucket.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { TaxReturnSection } from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'

const Q3 = (day: number) => new Date(Date.UTC(2026, 7, day, 12))

/** Documents keyed `collection/id`, as the plugins' writers store them. */
export const TAX_RETURN_SOURCE_DOCS: Record<string, Record<string, unknown>> = {
  // Stripe Tax on the platform's account, Texas: $20.00 of the $34.00, and
  // the $3000.00 of Texas sales the by-state table alone prints.
  'storefrontTaxCollected/cs_tx': {
    hostId: 'host-1',
    orgId: 'org-1',
    taxMode: 'stripe-automatic',
    taxLiability: 'platform',
    grossCents: 302_000,
    taxCents: 2_000,
    currency: 'usd',
    customerAddress: { country: 'US', state: 'TX' },
    taxLines: [{ amountCents: 2_000, taxableAmountCents: 240_000 }],
    paidAt: Q3(3),
  },
  // …and California, the other $14.00 of it.
  'storefrontTaxCollected/cs_ca': {
    hostId: 'host-1',
    orgId: 'org-1',
    taxMode: 'stripe-automatic',
    taxLiability: 'platform',
    grossCents: 198_000,
    taxCents: 1_400,
    currency: 'usd',
    customerAddress: { country: 'US', state: 'CA' },
    taxLines: [{ amountCents: 1_400, taxableAmountCents: 160_000 }],
    paidAt: Q3(4),
  },
  // A merchant's own configured rate — never the platform's to remit.
  'storefrontTaxCollected/in_manual': {
    hostId: 'host-2',
    orgId: 'org-2',
    taxMode: 'manual',
    taxLiability: null,
    grossCents: 200_000,
    taxCents: 5_700,
    currency: 'usd',
    customerAddress: { country: 'US', state: 'OK' },
    taxLines: [],
    paidAt: Q3(5),
  },
  // A marketplace purchase attributed to Texas…
  'marketplacePurchases/cs_mkt_tx': {
    listingId: 'listing-1',
    sellerOrgId: 'seller-org',
    amountCents: 145_500,
    taxCents: 4_500,
    transferCents: 120_000,
    customerAddress: { country: 'US', state: 'TX' },
    createdAt: Q3(6),
  },
  // …and one recorded before the webhook stored a jurisdiction, refused in
  // part: $12.00 of tax handed back, $78.00 net across the two.
  'marketplacePurchases/cs_mkt_legacy': {
    listingId: 'listing-2',
    sellerOrgId: 'seller-org',
    amountCents: 150_000,
    taxCents: 4_500,
    transferCents: 120_000,
    refundedCents: 40_000,
    createdAt: Q3(7),
  },
}

/**
 * What the registered sources answer for {@link TAX_RETURN_SOURCE_DOCS}, as
 * the route serializes it, with the platform's brand as `{brand}`. Held to
 * the real answer by the registered spec.
 */
const SECTIONS_UNDER_ANY_BRAND = [
  {
    id: 'storefront',
    name: 'Storefront',
    title: 'Storefront commerce tax — merchants’ sales',
    help: 'Tax charged to shoppers on merchants’ storefronts, split by who owes it. None of it is in the filing figures above.',
    intro:
      'None of this is in the Webfile figures above, which sum {brand}’s OWN sales only. The first row is the one that needs a decision: those sessions are created on {brand}’s platform account, so Stripe computed that tax against {brand}’s registrations and it settled into {brand}’s balance.',
    truncated: false,
    undatedRows: 0,
    findings: [
      {
        id: 'storefront{brand}LiableTax',
        severity: 'blocking',
        count: 2000,
        label: 'Texas storefront tax collected under {brand}’s registration',
        detail:
          'Cents. Charged to shoppers on merchants’ storefront sales, computed by Stripe Tax against THE PLATFORM’s registrations (the session is created on the platform account), and settled into the platform’s balance. It is NOT included in Items 1–3 below. Decide with counsel how it is reported before filing — do not file as if it were zero.',
      },
      {
        id: 'storefrontUnclassified',
        severity: 'blocking',
        count: 0,
        label: 'Storefront rows with an unrecognised tax mode',
        detail:
          'Not counted in any storefront bucket, so they are in no figure at all. Classify them before filing.',
      },
      {
        id: 'storefrontMissingTaxableBase',
        severity: 'review',
        count: 0,
        label: 'Storefront rows with tax but no stated base',
        detail:
          'Tax was collected but Stripe’s taxable_amount could not be read, so the storefront taxable-sales figure understates the base. Re-read the session in Stripe with the tax breakdown expanded.',
      },
    ],
    filingLines: [
      {
        item: '—',
        label:
          'Texas storefront tax under {brand}’s registration (NOT in Items 1–3)',
        dollars: '20.00',
        note: 'Collected from shoppers on merchants’ sales and held in {brand}’s balance. Excluded from every item above. Its treatment on the return is a question for counsel — see AGL-1904.',
      },
      {
        item: '—',
        label:
          'Texas storefront tax under the MERCHANT’s own rate (not {brand}’s)',
        dollars: '0.00',
        note: 'A manual-mode store’s own configured rate. {brand}’s registrations played no part in computing it. Shown so it is visibly NOT the line above — the two must never be added together.',
      },
    ],
    tables: [
      {
        columns: [
          {
            label: 'Bucket',
          },
          {
            label: 'Sales',
            numeric: true,
          },
          {
            label: 'Gross',
            numeric: true,
            money: true,
          },
          {
            label: 'Taxable sales',
            numeric: true,
            money: true,
          },
          {
            label: 'Tax collected',
            numeric: true,
            money: true,
          },
        ],
        rows: [
          {
            key: 'aglynLiable',
            cells: [
              {
                text: 'Computed against {brand}’s registrations',
                caption:
                  'In {brand}’s balance. Stripe Tax computed it on {brand}’s platform account.',
                tag: {
                  label: '{brand} holds this',
                  tone: 'attention',
                },
              },
              {
                text: '2',
              },
              {
                text: '$5000.00',
              },
              {
                text: '$4000.00',
              },
              {
                text: '$34.00',
                strong: true,
              },
            ],
          },
          {
            key: 'merchantManual',
            cells: [
              {
                text: 'Merchant’s own configured rate',
                caption:
                  'The merchant’s. It never touched an {brand} registration and is not {brand}’s to remit.',
              },
              {
                text: '1',
              },
              {
                text: '$2000.00',
              },
              {
                text: '$0.00',
              },
              {
                text: '$57.00',
                strong: false,
              },
            ],
          },
          {
            key: 'connectedAccountLiable',
            cells: [
              {
                text: 'Stripe Tax named the connected account liable',
                caption: 'The connected account’s. Empty today.',
              },
              {
                text: '0',
              },
              {
                text: '$0.00',
              },
              {
                text: '$0.00',
              },
              {
                text: '$0.00',
                strong: false,
              },
            ],
          },
        ],
        empty: 'This period’s response carries no storefront figures.',
      },
      {
        heading: 'Facilitated sales by buyer state',
        description:
          'What {brand} facilitated into each state, whoever remits the tax — the figure an economic-nexus threshold is measured against. US-TX needs no threshold: the filer is established there, so the obligation is unconditional. A region showing sales and no tax is the one to watch.',
        columns: [
          {
            label: 'Buyer state',
          },
          {
            label: 'Sales',
            numeric: true,
          },
          {
            label: 'Total sales',
            numeric: true,
            money: true,
          },
          {
            label: 'Tax collected',
            numeric: true,
            money: true,
          },
          {
            label: 'Of which {brand} owes',
            numeric: true,
            money: true,
          },
        ],
        rows: [
          {
            key: 'US-TX',
            cells: [
              {
                text: 'US-TX',
                tag: {
                  label: 'Registered',
                  tone: 'attention',
                },
              },
              {
                text: '1',
              },
              {
                text: '$3000.00',
              },
              {
                text: '$20.00',
              },
              {
                text: '$20.00',
                strong: true,
              },
            ],
          },
          {
            key: 'US-CA',
            cells: [
              {
                text: 'US-CA',
              },
              {
                text: '1',
              },
              {
                text: '$1966.00',
              },
              {
                text: '$14.00',
              },
              {
                text: '$14.00',
                strong: true,
              },
            ],
          },
          {
            key: 'US-OK',
            cells: [
              {
                text: 'US-OK',
              },
              {
                text: '1',
              },
              {
                text: '$1943.00',
              },
              {
                text: '$57.00',
              },
              {
                text: '$0.00',
                strong: false,
              },
            ],
          },
        ],
        empty: 'No storefront sales recorded in this period.',
        footnote:
          'A LOWER BOUND. A storefront sale that collected no tax at all files no row, so it is missing here — which is exactly the population a nexus check wants. Recorded on AGL-1956.',
      },
    ],
    figures: [],
    exports: [
      {
        placement: 'jurisdictions',
        rows: [
          ['Facilitated sales by buyer state (merchants’ storefronts)'],
          [
            'Buyer state',
            'Sales',
            'Total sales (USD)',
            'Tax collected (USD)',
            'Of which {brand} owes (USD)',
          ],
          ['US-TX', '1', '3000.00', '20.00', '20.00'],
          ['US-CA', '1', '1966.00', '14.00', '14.00'],
          ['US-OK', '1', '1943.00', '57.00', '0.00'],
          [
            'LOWER BOUND — a storefront sale that collected no tax files no row, so it is absent here. US-TX needs no threshold: the filer is established there.',
          ],
        ],
      },
      {
        placement: 'sections',
        rows: [
          [
            'Storefront commerce tax by liability (AGL-1904) — NOT in the Webfile figures',
          ],
          [
            'Bucket',
            'Who owes it',
            'Transactions',
            'Gross (USD)',
            'Taxable sales (USD)',
            'Tax collected (USD)',
          ],
          [
            'Computed against {brand}’s registrations',
            'In {brand}’s balance. Stripe Tax computed it on {brand}’s platform account.',
            '2',
            '5000.00',
            '4000.00',
            '34.00',
          ],
          [
            'Merchant’s own configured rate',
            'The merchant’s. It never touched an {brand} registration and is not {brand}’s to remit.',
            '1',
            '2000.00',
            '0.00',
            '57.00',
          ],
          [
            'Stripe Tax named the connected account liable',
            'The connected account’s. Empty today.',
            '0',
            '0.00',
            '0.00',
            '0.00',
          ],
        ],
      },
    ],
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 3,
      aglynLiable: {
        transactionCount: 2,
        grossCents: 500000,
        taxableSalesCents: 400000,
        taxCollectedCents: 3400,
        byJurisdiction: {
          'US-TX': {
            transactionCount: 1,
            totalSalesCents: 300000,
            taxableSalesCents: 240000,
            taxCollectedCents: 2000,
            taxabilityReasons: {
              unstated: {
                lines: 1,
                taxableAmountCents: 240000,
                taxCollectedCents: 2000,
              },
            },
            rates: [
              {
                taxRateId: 'unknown',
                percentage: null,
                rateState: null,
                jurisdiction: null,
                lines: 1,
                taxableAmountCents: 240000,
                taxCollectedCents: 2000,
              },
            ],
          },
          'US-CA': {
            transactionCount: 1,
            totalSalesCents: 196600,
            taxableSalesCents: 160000,
            taxCollectedCents: 1400,
            taxabilityReasons: {
              unstated: {
                lines: 1,
                taxableAmountCents: 160000,
                taxCollectedCents: 1400,
              },
            },
            rates: [
              {
                taxRateId: 'unknown',
                percentage: null,
                rateState: null,
                jurisdiction: null,
                lines: 1,
                taxableAmountCents: 160000,
                taxCollectedCents: 1400,
              },
            ],
          },
        },
      },
      merchantManual: {
        transactionCount: 1,
        grossCents: 200000,
        taxableSalesCents: 0,
        taxCollectedCents: 5700,
        byJurisdiction: {
          'US-OK': {
            transactionCount: 1,
            totalSalesCents: 194300,
            taxableSalesCents: 0,
            taxCollectedCents: 5700,
            taxabilityReasons: {},
            rates: [],
          },
        },
      },
      connectedAccountLiable: {
        transactionCount: 0,
        grossCents: 0,
        taxableSalesCents: 0,
        taxCollectedCents: 0,
        byJurisdiction: {},
      },
      attention: {
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
        rowsUnclassified: 0,
      },
    },
    rows: [
      {
        id: 'cs_tx',
        hostId: 'host-1',
        orgId: 'org-1',
        paidAt: '2026-08-03T12:00:00.000Z',
        taxMode: 'stripe-automatic',
        taxLiability: 'platform',
        grossCents: 302000,
        taxCents: 2000,
        taxableSalesCents: 240000,
        state: 'TX',
        country: 'US',
      },
      {
        id: 'cs_ca',
        hostId: 'host-1',
        orgId: 'org-1',
        paidAt: '2026-08-04T12:00:00.000Z',
        taxMode: 'stripe-automatic',
        taxLiability: 'platform',
        grossCents: 198000,
        taxCents: 1400,
        taxableSalesCents: 160000,
        state: 'CA',
        country: 'US',
      },
      {
        id: 'in_manual',
        hostId: 'host-2',
        orgId: 'org-2',
        paidAt: '2026-08-05T12:00:00.000Z',
        taxMode: 'manual',
        taxLiability: null,
        grossCents: 200000,
        taxCents: 5700,
        taxableSalesCents: 0,
        state: 'OK',
        country: 'US',
      },
    ],
    outcome: 'answered',
    pluginId: 'commerce',
  },
  {
    id: 'marketplace',
    name: 'Marketplace',
    title: 'Marketplace tax — plugin and theme purchases',
    help: 'Tax on marketplace purchases. Charged on the platform’s own charge, kept platform-side, and in no filing line above.',
    intro:
      'All of this tax is {brand}’s: it is added on top of the listing price on {brand}’s own charge, and the publisher’s transfer is computed from the pre-tax price. Each purchase records the jurisdiction Stripe computed its tax for, so the total below breaks down by state. Purchases recorded before that carry no jurisdiction and are counted as such rather than placed — read those in Stripe.',
    truncated: false,
    undatedRows: 0,
    findings: [
      {
        id: 'marketplaceTaxCollected',
        severity: 'blocking',
        count: 7800,
        label: 'Marketplace tax collected under {brand}’s registration',
        detail:
          'Cents, net of refunds. Charged on marketplace purchases as an EXCLUSIVE addition to the platform’s own charge, so none of it went to the publisher and all of it is in the platform’s balance. It is NOT in Items 1–3 below. Decide with counsel how it is reported before filing — do not file as if it were zero.',
      },
      {
        id: 'marketplaceOverRefunded',
        severity: 'blocking',
        count: 0,
        label: 'Marketplace rows refunded past their own charge',
        detail:
          'A refund larger than the charge is a data fault. The refunded tax is clamped so the figure is never netted below zero — which means these rows may OVERSTATE what was given back. Read them in Stripe.',
      },
      {
        id: 'marketplaceMissingJurisdiction',
        severity: 'review',
        count: 1,
        label: 'Marketplace rows with no stated jurisdiction',
        detail:
          'Their tax cannot be placed in a state, so it is in the marketplace total and in no state’s figure. Purchases recorded before the webhook stored a jurisdiction state none permanently — the address they were taxed from is in Stripe, and copying it back would attribute a filed period after the fact. Read them there instead.',
      },
      {
        id: 'marketplaceMissingCreatedAt',
        severity: 'review',
        count: 0,
        label: 'Marketplace rows with no readable date',
        detail:
          'Period assignment fell back to the query bounds, so these purchases may belong to a neighboring period.',
      },
    ],
    filingLines: [],
    tables: [],
    figures: [
      {
        label: 'Purchases in period',
        value: '2',
        note: 'Rows swept from marketplacePurchases.',
      },
      {
        label: 'Gross paid by buyers',
        value: '$2955.00',
        note: 'Tax included, and mostly the publisher’s money — not {brand} revenue.',
      },
      {
        label: 'Taxable base',
        value: '$2865.00',
        note: 'Gross less tax.',
      },
      {
        label: 'Tax charged',
        value: '$90.00',
        note: 'Added EXCLUSIVE on the platform’s own charge; the publisher’s transfer is computed pre-tax.',
      },
      {
        label: 'Tax refunded',
        value: '$12.00',
        note: 'Pro rata against each row’s own gross. Never remitted.',
      },
      {
        label: 'Tax collected, net',
        value: '$78.00',
        note: 'The remittable figure — and it is in NO Webfile line above.',
      },
      {
        label: 'Tax collected — US-TX',
        value: '$45.00',
        note: '1 purchase(s), $1410.00 of sales excluding tax. The filing jurisdiction.',
      },
      {
        label: 'Tax collected — no stated jurisdiction',
        value: '$33.00',
        note: '1 purchase(s) that state no jurisdiction. In the total above and in no state’s figure.',
      },
    ],
    exports: [
      {
        placement: 'sections',
        rows: [
          ['Marketplace tax (AGL-2137) — NOT in the Webfile figures'],
          ['Figure', 'Amount', 'Note'],
          ['Purchases in period', '2', 'Rows swept from marketplacePurchases.'],
          [
            'Gross paid by buyers',
            '$2955.00',
            'Tax included, and mostly the publisher’s money — not {brand} revenue.',
          ],
          ['Taxable base', '$2865.00', 'Gross less tax.'],
          [
            'Tax charged',
            '$90.00',
            'Added EXCLUSIVE on the platform’s own charge; the publisher’s transfer is computed pre-tax.',
          ],
          [
            'Tax refunded',
            '$12.00',
            'Pro rata against each row’s own gross. Never remitted.',
          ],
          [
            'Tax collected, net',
            '$78.00',
            'The remittable figure — and it is in NO Webfile line above.',
          ],
          [
            'Tax collected — US-TX',
            '$45.00',
            '1 purchase(s), $1410.00 of sales excluding tax. The filing jurisdiction.',
          ],
          [
            'Tax collected — no stated jurisdiction',
            '$33.00',
            '1 purchase(s) that state no jurisdiction. In the total above and in no state’s figure.',
          ],
        ],
      },
    ],
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 2,
      grossCents: 295500,
      taxableSalesCents: 286500,
      taxCollectedCents: 7800,
      taxChargedCents: 9000,
      taxRefundedCents: 1200,
      byJurisdiction: {
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 141000,
          taxableSalesCents: 141000,
          taxCollectedCents: 4500,
          taxabilityReasons: {},
          rates: [],
        },
        unknown: {
          transactionCount: 1,
          totalSalesCents: 145500,
          taxableSalesCents: 145500,
          taxCollectedCents: 3300,
          taxabilityReasons: {},
          rates: [],
        },
      },
      attention: {
        rowsMissingJurisdiction: 1,
        rowsMissingCreatedAt: 0,
        rowsOverRefunded: 0,
      },
    },
    rows: [
      {
        id: 'cs_mkt_tx',
        sellerOrgId: 'seller-org',
        createdAt: '2026-08-06T12:00:00.000Z',
        grossCents: 145500,
        taxCents: 4500,
        refundedCents: 0,
      },
      {
        id: 'cs_mkt_legacy',
        sellerOrgId: 'seller-org',
        createdAt: '2026-08-07T12:00:00.000Z',
        grossCents: 150000,
        taxCents: 4500,
        refundedCents: 40000,
      },
    ],
    outcome: 'answered',
    pluginId: 'marketplace',
  },
]

/**
 * The sections under THIS deployment's brand: the sources word their copy
 * with `PLATFORM_BRAND_NAME`, so a fixture that spelled one brand out would
 * describe a different deployment the moment the brand was configured.
 */
export const TAX_RETURN_SOURCE_SECTIONS: TaxReturnSection[] = JSON.parse(
  JSON.stringify(SECTIONS_UNDER_ANY_BRAND).replace(/\{brand\}/g, PLATFORM_BRAND_NAME),
)
