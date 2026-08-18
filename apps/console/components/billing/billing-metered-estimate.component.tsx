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
'use client'

import { resolveOrgEntitlements, type AglynOrgBilling } from '@aglyn/aglyn'
import {
  billsOrgLibraryStorage,
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
  METERED_MARKUP,
} from '../../utils/usage-metering'
import { Stack, Typography } from '@mui/material'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { documentId } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'

export interface BillingMeteredEstimateProps {
  hosts: any[]
  /**
   * The org, for its included bands. Without it the estimate resolves as
   * free and shows $0 — deliberately, so a loading org can never flash a
   * charge (`feedback_loading_default_answers_a_question`).
   */
  org?: Partial<AglynOrgBilling> | null
}

/**
 * What `/api/billing/usage-config` answered: the raw
 * `BILL_ORG_LIBRARY_STORAGE_FROM` value, or `'unknown'` when the route could
 * not be reached — in which case the card fails HIGH (includes the library),
 * because understating the invoice is the one direction it must never be
 * wrong in.
 */
type UsageConfig = { orgLibraryBilledFrom: string | null } | 'unknown'

/**
 * Month-to-date metered cost estimate (AGL-41): mirrors the report-usage
 * rollup's math (shared `estimateMonthlyUsageCost`) over the same counters
 * so workspaces see the number before it lands on an invoice.
 *
 * Shares the included-band subtraction with the rollup (AGL-1280) rather
 * than reproducing it — the whole point of this card is that it agrees with
 * the invoice, and it could only do that by accident while it priced from
 * unit zero and the published terms promised overage-only.
 *
 * Since AGL-1473's console half it also reads `orgs/{id}/counters/media` —
 * the ORG LIBRARY's stored bytes, which belong to no site and were invisible
 * to a host-only sum. Exactly the rollup's shape: the library is one more
 * `HostUsageSnapshot`, and TWO estimates come out. The truth (with the
 * library) drives every usage figure; what an INVOICE may see excludes the
 * library until `BILL_ORG_LIBRARY_STORAGE_FROM` names a month at or before
 * this one, decided by the same `billsOrgLibraryStorage` the rollup calls
 * over the same raw value (served by `/api/billing/usage-config`).
 */
export function BillingMeteredEstimateComponent(
  props: BillingMeteredEstimateProps,
) {
  const { hosts, org } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const [snapshots, setSnapshots] = useState<HostUsageSnapshot[] | null>(null)
  /**
   * The org library's `counters/media.bytes`. `null` until it is KNOWN —
   * a denied read stays null and holds the loading state, because a card
   * that renders a host-only figure after a failed org read has quietly
   * reintroduced the understatement (the billing-usage posture: better
   * "Calculating…" than a number that is low).
   */
  const [orgLibraryBytes, setOrgLibraryBytes] = useState<number | null>(null)
  const [config, setConfig] = useState<UsageConfig | null>(null)
  const month = new Date().toISOString().slice(0, 7)
  const orgId = (org as any)?.$id as string | undefined

  useEffect(() => {
    let active = true
    void Promise.all(
      (hosts ?? []).map(async (host: any): Promise<HostUsageSnapshot> => {
        const [media, forms, analytics] = await Promise.all([
          getDoc(
            doc(firestore, 'hosts', host.$id, 'counters', 'media'),
          ).catch(() => null),
          getDoc(
            doc(firestore, 'hosts', host.$id, 'counters', 'formSubmissions'),
          ).catch(() => null),
          getDocs(
            query(
              collection(firestore, 'hosts', host.$id, 'analytics'),
              where(documentId(), '>=', `${month}-01`),
              where(documentId(), '<=', `${month}-31`),
            ),
          ).catch(() => null),
        ])
        return {
          storageBytes: Number(media?.get('bytes') ?? 0),
          formSubmissions: Number(forms?.get(month) ?? 0),
          pageViews: (analytics?.docs ?? []).reduce(
            (sum, day) => sum + Number(day.get('total') ?? 0),
            0,
          ),
        }
      }),
    ).then((usage) => {
      if (active) setSnapshots(usage)
    })
    return () => {
      active = false
    }
  }, [hosts, firestore, month])

  // The ORG LIBRARY's bytes (AGL-1473). A missing counter is a true zero —
  // the org has never uploaded to its library — but a FAILED read is not,
  // so only the resolved path ever sets a number. An org without an id
  // resolves free and meters nothing, so its library is zero by definition.
  useEffect(() => {
    if (!orgId) {
      setOrgLibraryBytes(0)
      return
    }
    let active = true
    void getDoc(doc(firestore, 'orgs', orgId, 'counters', 'media'))
      .then((counter) => {
        if (active) setOrgLibraryBytes(Number(counter.get('bytes') ?? 0))
      })
      .catch(() => {
        // Held at null: the card keeps "Calculating…" rather than publishing
        // a host-only sum as if it were the org's storage.
      })
    return () => {
      active = false
    }
  }, [firestore, orgId])

  // Whether THIS month's invoice includes the library — a server env var
  // (`BILL_ORG_LIBRARY_STORAGE_FROM`) this client component cannot read, so
  // it is fetched once and evaluated through the same
  // `billsOrgLibraryStorage` the rollup uses. Unreachable ⇒ 'unknown' ⇒ the
  // estimate INCLUDES the library: at worst it overstates, never under.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          '/api/billing/usage-config',
          idToken
            ? { headers: { Authorization: `Bearer ${idToken}` } }
            : undefined,
        )
        if (!response.ok) throw new Error(`usage-config ${response.status}`)
        const payload = await response.json()
        if (active) {
          setConfig({
            orgLibraryBilledFrom:
              typeof payload?.orgLibraryBilledFrom === 'string'
                ? payload.orgLibraryBilledFrom
                : null,
          })
        }
      } catch {
        if (active) setConfig('unknown')
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  const ready = snapshots !== null && orgLibraryBytes !== null && config !== null
  const orgLibrary: HostUsageSnapshot = {
    storageBytes: orgLibraryBytes ?? 0,
    pageViews: 0,
    formSubmissions: 0,
  }
  // TWO estimates, the rollup's exact split (AGL-1473): `estimate` is the
  // TRUTH — every byte the org stores — and drives the usage lines.
  // `billedEstimate` is what the INVOICE will see, and it excludes the org
  // library until the switch covers this month.
  const estimate = estimateMonthlyUsageCost(
    [...(snapshots ?? []), orgLibrary],
    org,
  )
  const libraryBilled =
    config === 'unknown'
      ? true
      : config
        ? billsOrgLibraryStorage(month, config.orgLibraryBilledFrom)
        : true
  const billedEstimate = libraryBilled
    ? estimate
    : estimateMonthlyUsageCost(snapshots ?? [], org)
  const { included } = estimate
  const orgLibraryGb = (orgLibraryBytes ?? 0) / (1024 * 1024 * 1024)
  /**
   * The org library's OWN allowance (AGL-1886), which is not the org-wide
   * band beside it.
   *
   * Uploads are enforced PER SCOPE against `storagePerHostMb` — the upload
   * route reads the very counter it increments — so the org library fills up
   * and starts refusing at this number, while the "Storage" row above
   * compares an org-wide total to `hostLimit × storagePerHostMb`. On any plan
   * with more than one site those are different numbers, and the one that
   * stops an upload is this one. Showing only the other is how a customer
   * ends up refused at 33% of the band the card told them about.
   */
  const orgLibraryAllowanceGb =
    resolveOrgEntitlements(org as never).storagePerHostMb / 1024
  // `UNLIMITED` is Infinity, and a band derived from it stays Infinity —
  // `Number.isFinite` catches both that and a NaN from bad override data.
  const band = (value: number, digits = 0) =>
    Number.isFinite(value) ? value.toFixed(digits) : '∞'
  // An annual subscription used to carry no metered item at all, and this
  // caption said so: AGL-1340 attached the monthly-only `aglyn_metered_usage`
  // to monthly checkouts, because Stripe forbids mixed intervals on one
  // subscription. AGL-1280 minted `aglyn_metered_usage_yearly` on the same
  // meter, so both intervals now carry one and the caption states CADENCE
  // instead of absence.
  //
  // Cadence, not "billed monthly", because the meter aggregates over the
  // SUBSCRIPTION PERIOD: an annual subscription's overage accrues across the
  // year and settles once, on the renewal invoice. Telling an annual customer
  // their usage is "billed monthly" would be a different wrong answer from
  // the one this replaces.
  //
  // Deliberately keyed off the subscription's own interval rather than off
  // `STRIPE_PRICE_METERED{,_YEARLY}`: this is a client component and cannot
  // read a server env var. The two must therefore be set together — see
  // docs/STRIPE_GO_LIVE.md §5 step 6, which says set both or neither. Setting
  // only the monthly one puts this caption back in the position of promising
  // annual customers a settlement that never arrives.
  const annual = (org as any)?.subscription?.interval === 'year'

  /**
   * One metered dimension: used of included, with any billable excess as its
   * own warning-coloured span (sibling inline spans — two-tone text) so the
   * included portion and the part that costs money read apart at a glance.
   * The excess comes off `billedEstimate`, so what is called "billable" is
   * exactly what the dollars above price.
   */
  const usageRow = (
    label: string,
    used: string,
    includedBand: string,
    billable: number,
    billableText: string,
  ) => (
    <Typography variant="body2" color="text.secondary">
      {`${label}: ${used} of ${includedBand}`}
      {included.metered && billable > 0 ? (
        <Typography
          component="span"
          variant="body2"
          sx={{ color: 'warning.main' }}
        >
          {` · ${billableText} billable`}
        </Typography>
      ) : null}
    </Typography>
  )

  return (
    <Stack spacing={0.5}>
      <Typography variant="h5">
        {ready
          ? `$${(billedEstimate.billedCents / 100).toFixed(2)}`
          : 'Calculating…'}
      </Typography>
      {ready && included.metered && billedEstimate.billedCents === 0 ? (
        // Reassurance is the feature: most orgs live inside their bands, and
        // "no surprise bill" is the whole reason this card exists.
        <Typography variant="body2" sx={{ color: 'success.main' }}>
          {"You're within your plan's included usage — no metered charges " +
            'this period.'}
        </Typography>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        {`Month to date (${month})`}
      </Typography>
      {/* No usage rows until the counters and the billing switch are known —
          a row of zeros during loading is a wrong answer wearing a default
          (`feedback_loading_default_answers_a_question`). */}
      {ready ? (
        <>
          {usageRow(
            'Storage',
            estimate.storageGb.toFixed(2),
            `${band(included.storageGb, 2)} GB`,
            billedEstimate.billableStorageGb,
            `${billedEstimate.billableStorageGb.toFixed(2)} GB`,
          )}
          {orgLibraryGb > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {`Includes ${orgLibraryGb.toFixed(2)} of ` +
                `${band(orgLibraryAllowanceGb, 2)} GB in your organization ` +
                'library, which has its own allowance — new uploads there ' +
                'stop at it. ' +
                (libraryBilled
                  ? ''
                  : 'Organization-library storage is measured but not yet billed.')}
            </Typography>
          ) : null}
          {usageRow(
            'Page views',
            estimate.pageViews.toLocaleString(),
            band(included.pageViews),
            billedEstimate.billablePageViews,
            Math.ceil(billedEstimate.billablePageViews).toLocaleString(),
          )}
          {usageRow(
            'Form submissions',
            estimate.formSubmissions.toLocaleString(),
            band(included.formSubmissions),
            billedEstimate.billableFormSubmissions,
            Math.ceil(billedEstimate.billableFormSubmissions).toLocaleString(),
          )}
        </>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        {included.metered
          ? `Only usage beyond your plan's included storage, bandwidth and ` +
            `form submissions is metered, at our cost × ${METERED_MARKUP}. ` +
            (annual
              ? 'Your subscription is annual, so usage accrues across the ' +
                'year and settles on your renewal invoice.'
              : 'Metered charges settle on the same invoice as your ' +
                'monthly subscription.')
          : "Your plan's storage, bandwidth and form submissions are " +
            'included caps, not meters — no usage charges.'}
      </Typography>
    </Stack>
  )
}
BillingMeteredEstimateComponent.displayName = 'BillingMeteredEstimateComponent'

export default BillingMeteredEstimateComponent
