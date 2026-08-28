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
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  asRowDate,
  marketplaceTaxSummary,
  storefrontTaxSummary,
  taxPeriodRange,
  taxReturnRowFindings,
  taxReturnSummary,
  type MarketplaceTaxReturnRowInput,
  type StorefrontTaxReturnRowInput,
  type TaxReturnRowInput,
  type TaxReturnScope,
} from '../../../../utils/server/tx-return'
import { TX_JURISDICTION } from '../../../../utils/tax-jurisdictions'
import { resolveTaxFilingSettings } from '../../../../utils/server/tax-filing-store'
import { readTaxablePurchases } from '../../../../utils/server/taxable-purchases-store'

/**
 * The sales tax return for one filing period, summed from the
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
 * The filer's registration identifiers, and the jurisdiction they belong to
 * (AGL-2021).
 *
 * Resolved from the staff console's stored configuration first and
 * server-only environment second — `utils/server/tax-filing-store.ts` reads
 * both and `utils/tax-filing-config.ts` states the precedence. Neither layer
 * is `NEXT_PUBLIC_*`, and the reason is the whole point of the issue: a filing
 * credential such as the Texas Webfile number is what the Comptroller's
 * eSystems calls a "Personal Identification Code" and uses to authenticate a
 * profile claiming access to a taxpayer account. A `NEXT_PUBLIC_*` var would
 * be inlined into a client chunk that Next serves without authentication —
 * republishing the credential this change exists to un-publish.
 *
 * This response is the ONE place the whole value is handed out, behind the
 * `staff` gate below, because it is the one place it is needed: a filer
 * transcribes it onto the return. `/api/admin/tax-filing`, which configures
 * it, never returns it at all.
 *
 * No defaults for the numbers themselves. An unconfigured deployment — every
 * self-host operator, on day one — reports absent and the surfaces say so; see
 * `TAX_REGISTRATION_UNSET`.
 */
async function taxRegistrationInForce(): Promise<{
  jurisdiction: string
  registrationId: string | null
  filingId: string | null
  firstTaxablePeriod: string | null
  webfileNumber?: string | null
  taxpayerNumber?: string | null
}> {
  const resolved = await resolveTaxFilingSettings()
  const { registrationId, filingId } = resolved
  return {
    jurisdiction: resolved.jurisdiction.code,
    registrationId,
    filingId,
    /*
     * WHEN THE OBLIGATION BEGAN — and only when an operator SAID so.
     *
     * `resolveTaxFilingSettings` always answers with a period, defaulting to
     * this software's own first taxable month when nothing is configured.
     * That default is fine for building a period menu and wrong for scoping a
     * finding: scoping a row out asserts that no tax was owed on that sale,
     * and the only party entitled to assert it is an operator who wrote their
     * own start date down. A `source` of anything but `console` reports null,
     * and null scopes nothing — every untaxed row stays flagged.
     */
    firstTaxablePeriod:
      resolved.firstTaxablePeriodSource === 'console'
        ? resolved.firstTaxablePeriod
        : null,
    // The Texas-named fields, mirrored for Texas alone. A client chunk cached
    // from before the rename reads only these, and a deployment mid-rollout
    // must not spend that window reporting a configured registration as
    // missing. Mirroring them on any other jurisdiction would put a foreign
    // identifier under a Comptroller label, which is the confusion this whole
    // change removes.
    ...(resolved.jurisdiction.code === TX_JURISDICTION
      ? { webfileNumber: filingId, taxpayerNumber: registrationId }
      : {}),
  }
}

/**
 * One row, as the working papers and the findings both need it.
 *
 * Carries `findings` — the SAME keys `taxReturnSummary` counted, from the same
 * predicate — so the screen can answer "which rows?" for every count it
 * renders. That could not be re-derived from the fields beside it and the
 * attempt would quietly lie twice: `taxableSalesCents` is a sum, so a line
 * stating a base of zero is indistinguishable here from a row stating no base
 * at all, and `automaticTax` used to project as `row.automaticTax === true`,
 * which reports a field that was never written as an explicit `false` and
 * would name rows the count never included.
 *
 * Nothing is added to the projection that the screen does not need. These rows
 * carry customer identifiers and amounts, and the page is `super`-gated staff
 * only — widening them further to serve a maybe is how a filing surface turns
 * into a data export.
 */
function projectRow(row: TaxReturnRowInput, scope: TaxReturnScope) {
  return {
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
    // Tri-state, because the field is: `true`, an explicit `false` that the
    // untaxed finding is about, and never-written — which is not the same
    // claim and must not print as one.
    automaticTax:
      row.automaticTax === true ? true : row.automaticTax === false ? false : null,
    refundedCents: Number(row.refundedCents ?? 0),
    // AGL-1582's flag, read with the revenue report's own `=== true`. An
    // absent field projects as `false` here and IS filed as a sale, which is
    // the direction that over-reports visibly rather than under-reporting a
    // liability invisibly.
    internalTraffic: row.internalTraffic === true,
    findings: taxReturnRowFindings(row, scope),
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
      registration,
      taxablePurchases,
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
        // Alongside the queries rather than before them: it is one cached
        // document read and the return cannot be built without it either way.
        taxRegistrationInForce(),
        // Item 3, if anybody has entered one for this period. `null` when
        // nobody has, which is what makes the line read `not computed`.
        readTaxablePurchases(period),
      ])
    const truncated = inPeriod.size > ROW_CAP
    const docs = inPeriod.docs.slice(0, ROW_CAP)
    const rows: TaxReturnRowInput[] = docs.map((doc) => ({
      invoiceId: doc.id,
      ...(doc.data() as Omit<TaxReturnRowInput, 'invoiceId'>),
    }))

    // One scope, built once and used by BOTH the counting and the per-row
    // projection below, so a row can never be scoped out of a count while
    // still being named as needing attention.
    const scope: TaxReturnScope = {
      obligationStart: taxPeriodRange(registration.firstTaxablePeriod ?? '')?.start ?? null,
    }
    const summary = taxReturnSummary(rows, range, scope)
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
      /**
       * AGL-2021 — operator config, not source. Null identifiers when
       * unconfigured, and the jurisdiction they belong to so the surfaces can
       * name the authority instead of assuming one.
       */
      registration,
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
      /**
       * ITEM 3 — the figure this report cannot derive, as somebody entered it.
       *
       * `null` when nobody has entered one for this period, and the surfaces
       * render null as `not computed`. A zero here would be the exact claim
       * the line refuses to make.
       */
      taxablePurchases,
      /** Rows no period query can reach — must be zero before filing. */
      undatedRows: undatedProbe.size,
      /**
       * …AND WHICH ONES.
       *
       * The count alone is a blocking finding an operator cannot begin on:
       * these rows are in no period query, including this one, so they are
       * not in `rows` either and no amount of filtering the listing would
       * produce them. Bounded by the probe's own limit, which is also what
       * bounds the count — so the list and the number are the same
       * population, never a subset presented as the whole.
       */
      undated: {
        rows: undatedProbe.docs.map((doc) => {
          const data = doc.data() as Omit<TaxReturnRowInput, 'invoiceId'>
          return projectRow({ invoiceId: doc.id, ...data }, scope)
        }),
      },
      rows: rows.map((row) => projectRow(row, scope)),
    })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/tax-return]', error)
    return Response.json({ error: 'Tax return summary failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
