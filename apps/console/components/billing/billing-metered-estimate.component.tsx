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

import { type AglynOrgBilling } from '@aglyn/aglyn'
import {
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
  METERED_MARKUP,
} from '../../utils/usage-metering'
import { Stack, Typography } from '@mui/material'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { documentId } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'

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
 * Month-to-date metered cost estimate (AGL-41): mirrors the report-usage
 * rollup's math (shared `estimateMonthlyUsageCost`) over the same counters
 * so workspaces see the number before it lands on an invoice.
 *
 * Shares the included-band subtraction with the rollup (AGL-1280) rather
 * than reproducing it — the whole point of this card is that it agrees with
 * the invoice, and it could only do that by accident while it priced from
 * unit zero and the published terms promised overage-only.
 */
export function BillingMeteredEstimateComponent(
  props: BillingMeteredEstimateProps,
) {
  const { hosts, org } = props
  const firestore = useFirestore()
  const [snapshots, setSnapshots] = useState<HostUsageSnapshot[] | null>(null)
  const month = new Date().toISOString().slice(0, 7)

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

  const estimate = estimateMonthlyUsageCost(snapshots ?? [], org)
  const { included } = estimate
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
  return (
    <Stack spacing={0.5}>
      <Typography variant="h5">
        {snapshots
          ? `$${(estimate.billedCents / 100).toFixed(2)}`
          : 'Calculating…'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {`Month to date (${month}): ` +
          `${estimate.storageGb.toFixed(2)} of ` +
          `${band(included.storageGb, 2)} GB stored · ` +
          `${estimate.pageViews} of ${band(included.pageViews)} page views · ` +
          `${estimate.formSubmissions} of ` +
          `${band(included.formSubmissions)} form submissions`}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {included.metered
          ? `Only usage beyond your plan's included storage, bandwidth and ` +
            `form submissions is metered, at our cost × ${METERED_MARKUP}. ` +
            (annual
              ? 'Your subscription is annual, so usage accrues across the ' +
                'year and settles on your renewal invoice.'
              : 'Billed monthly alongside your subscription.')
          : "Your plan's storage, bandwidth and form submissions are " +
            'included caps, not meters — no usage charges.'}
      </Typography>
    </Stack>
  )
}
BillingMeteredEstimateComponent.displayName = 'BillingMeteredEstimateComponent'

export default BillingMeteredEstimateComponent
