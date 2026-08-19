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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  asRowDate,
  marketplaceTaxSummary,
  storefrontTaxSummary,
  taxPeriodRange,
  taxReturnSummary,
  type MarketplaceTaxReturnRowInput,
  type StorefrontTaxReturnRowInput,
  type TaxReturnRowInput,
} from '../../../../utils/server/tx-return'

/**
 * The Texas sales tax return for one filing period, summed from the
 * `platformRevenue` rows the billing webhook records (AGL-1811).
 *
 * `GET ?period=2026-Q4` (a calendar quarter — the expected filing frequency
 * under the registration's under-$8k declaration) or `?period=2026-09` (a
 * month, if the Comptroller assigns monthly filing instead). Read-only and
 * staff-gated exactly like `/api/admin/overview` — the `staff` custom claim,
 * the same trust anchor as the Firestore rules (which deny this collection
 * to every client, so this route is the only reader).
 *
 * Two queries, and the second is the honesty check: the period query ranges
 * on `paidAt`, and a Firestore range query CANNOT match a document whose
 * field is null — so a row whose invoice carried no readable timestamp would
 * be invisible to the sweep, and an invisible transaction is an understated
 * return. The equality probe counts those rows so the response can say
 * "N rows are outside every period" instead of silently filing without them.
 *
 * The per-row listing is the working papers: enough to audit any figure back
 * to an invoice id in the Stripe dashboard, and nothing a return does not
 * need. Bounded because a route must be; `truncated: true` means the SUMMARY
 * is a lower bound and must not be filed from — raise the cap or narrow the
 * period instead.
 */
const ROW_CAP = 2000

/**
 * The filer's Texas registration identifiers (AGL-2021).
 *
 * SERVER-ONLY env, on purpose, and the reason is the whole point of the issue:
 * the Webfile number is what the Comptroller's eSystems calls a "Personal
 * Identification Code" and uses to authenticate a profile claiming access to a
 * taxpayer account. A `NEXT_PUBLIC_*` var would be inlined into a client chunk
 * that Next serves without authentication — republishing the credential this
 * change exists to un-publish. Read here instead, behind the `staff` gate
 * below, so the only way to see it is to be allowed to see it.
 *
 * No defaults. An unconfigured deployment — every self-host operator, on day
 * one — reports absent and the surfaces say so; see `TX_REGISTRATION_UNSET`.
 */
function taxRegistrationFromEnv(): {
  webfileNumber: string | null
  taxpayerNumber: string | null
} {
  const read = (name: string): string | null => {
    const value = process.env[name]
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length ? text : null
  }
  return {
    webfileNumber: read('TX_WEBFILE_NUMBER'),
    taxpayerNumber: read('TX_TAXPAYER_NUMBER'),
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const period = new URL(request.url).searchParams.get('period') ?? ''
    const range = taxPeriodRange(period)
    if (!range) {
      return Response.json(
        { error: 'period must be YYYY-Q[1-4] or YYYY-MM' },
        { status: 400 },
      )
    }

    const firestore = firebaseAdmin.app().firestore()
    const revenue = firestore.collection('platformRevenue')
    // Storefront commerce tax (AGL-1904): a SEPARATE collection, queried and
    // reported separately, because a storefront row's money is mostly the
    // merchant's while a `platformRevenue` row's is Aglyn's. Summing the two
    // would put other companies' receipts into this return's total sales —
    // which is why they never meet in one query.
    const storefront = firestore.collection('storefrontTaxCollected')
    // Marketplace sales tax (AGL-2137): a THIRD source, and it was missing
    // entirely. Marketplace checkout enables `automatic_tax` on the PLATFORM's
    // own charge with the tax added `exclusive` on top and kept platform-side
    // — the publisher's transfer is a fixed amount computed from the PRE-tax
    // price — so under the marketplace-provider registration that tax is
    // Aglyn's to remit, in full. Nothing read `marketplacePurchases.taxCents`:
    // every dollar of it was collected and then absent from the return.
    //
    // Ranged on `createdAt`, which is a SINGLE-FIELD inequality and therefore
    // served by Firestore's automatic index — deliberately, so this cannot be
    // the query that 500s the staff page in production over a composite index
    // nobody deployed.
    const marketplace = firestore.collection('marketplacePurchases')
    const [
      inPeriod,
      undatedProbe,
      storefrontInPeriod,
      storefrontUndated,
      marketplaceInPeriod,
    ] = await Promise.all([
        revenue
          .where('paidAt', '>=', range.start)
          .where('paidAt', '<', range.end)
          .limit(ROW_CAP + 1)
          .get(),
        // Rows a range query can never see — see the doc block.
        revenue.where('paidAt', '==', null).limit(50).get(),
        storefront
          .where('paidAt', '>=', range.start)
          .where('paidAt', '<', range.end)
          .limit(ROW_CAP + 1)
          .get(),
        storefront.where('paidAt', '==', null).limit(50).get(),
        marketplace
          .where('createdAt', '>=', range.start)
          .where('createdAt', '<', range.end)
          .limit(ROW_CAP + 1)
          .get(),
      ])
    const truncated = inPeriod.size > ROW_CAP
    const docs = inPeriod.docs.slice(0, ROW_CAP)
    const rows: TaxReturnRowInput[] = docs.map((doc) => ({
      invoiceId: doc.id,
      ...(doc.data() as Omit<TaxReturnRowInput, 'invoiceId'>),
    }))

    const summary = taxReturnSummary(rows, range)
    const storefrontDocs = storefrontInPeriod.docs.slice(0, ROW_CAP)
    const storefrontRows: StorefrontTaxReturnRowInput[] = storefrontDocs.map(
      (doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<StorefrontTaxReturnRowInput, 'id'>),
      }),
    )
    const marketplaceRows: MarketplaceTaxReturnRowInput[] =
      marketplaceInPeriod.docs.slice(0, ROW_CAP).map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<MarketplaceTaxReturnRowInput, 'id'>),
      }))
    return Response.json({
      period,
      summary,
      truncated,
      /**
       * Marketplace sales tax (AGL-2137) — ADDITIVE and separate, for the
       * same reason `storefront` below is: a marketplace row's gross is mostly
       * the PUBLISHER's money, so summing it into `summary` would put someone
       * else's receipts into this return's sales figure. Unlike either
       * sibling it has ONE liability arm — the platform's — and its tax is
       * reported NET of refunds, with the charged and refunded halves stated
       * separately so a reader is never handed a single number that could be
       * either.
       */
      marketplace: {
        summary: marketplaceTaxSummary(marketplaceRows, range),
        truncated: marketplaceInPeriod.size > ROW_CAP,
        rows: marketplaceRows.map((row) => ({
          id: row.id,
          sellerOrgId:
            typeof row.sellerOrgId === 'string' ? row.sellerOrgId : null,
          createdAt: asRowDate(row.createdAt)?.toISOString() ?? null,
          grossCents: Number(row.amountCents ?? 0),
          taxCents: Number(row.taxCents ?? 0),
          refundedCents: Number(row.refundedCents ?? 0),
        })),
      },
      /** AGL-2021 — operator config, not source. Null when unconfigured. */
      registration: taxRegistrationFromEnv(),
      /**
       * Storefront commerce tax (AGL-1904) — ADDITIVE and separate. Three
       * buckets with no grand total, on purpose: `aglynLiable` is tax Stripe
       * computed against Aglyn's own registrations and is money Aglyn holds;
       * `merchantManual` is a merchant's own configured rate and is not
       * Aglyn's to remit. A reader that adds them has made the mistake this
       * shape exists to prevent.
       */
      storefront: {
        summary: storefrontTaxSummary(storefrontRows, range),
        truncated: storefrontInPeriod.size > ROW_CAP,
        undatedRows: storefrontUndated.size,
        rows: storefrontRows.map((row) => ({
          id: row.id,
          hostId: typeof row.hostId === 'string' ? row.hostId : null,
          orgId: row.orgId ?? null,
          paidAt: asRowDate(row.paidAt)?.toISOString() ?? null,
          taxMode: typeof row.taxMode === 'string' ? row.taxMode : null,
          taxLiability:
            typeof row.taxLiability === 'string' ? row.taxLiability : null,
          grossCents: Number(row.grossCents ?? 0),
          taxCents: Number(row.taxCents ?? 0),
          taxableSalesCents: (Array.isArray(row.taxLines) ? row.taxLines : [])
            .map((line) => Number(line?.taxableAmountCents ?? 0))
            .reduce((sum, base) => sum + (Number.isFinite(base) ? base : 0), 0),
          state:
            typeof row.customerAddress?.state === 'string'
              ? row.customerAddress.state
              : null,
          country:
            typeof row.customerAddress?.country === 'string'
              ? row.customerAddress.country
              : null,
        })),
      },
      /** Rows no period query can reach — must be zero before filing. */
      undatedRows: undatedProbe.size,
      rows: rows.map((row) => ({
        invoiceId: row.invoiceId,
        orgId: row.orgId ?? null,
        paidAt: asRowDate(row.paidAt)?.toISOString() ?? null,
        grossCents: Number(row.grossCents ?? 0),
        taxCents: Number(row.taxCents ?? 0),
        taxableSalesCents: (Array.isArray(row.taxLines) ? row.taxLines : [])
          .map((line) => Number(line?.taxableAmountCents ?? 0))
          .reduce((sum, base) => sum + (Number.isFinite(base) ? base : 0), 0),
        state:
          typeof row.customerAddress?.state === 'string'
            ? row.customerAddress.state
            : null,
        country:
          typeof row.customerAddress?.country === 'string'
            ? row.customerAddress.country
            : null,
        automaticTax: row.automaticTax === true,
        refundedCents: Number(row.refundedCents ?? 0),
      })),
    })
  } catch (error) {
    console.error('[admin/tax-return]', error)
    return Response.json({ error: 'Tax return summary failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
