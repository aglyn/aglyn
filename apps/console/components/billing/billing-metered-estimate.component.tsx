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
  // An annual subscription used to carry no metered item at all: AGL-1340
  // attached the monthly-only `aglyn_metered_usage` to monthly checkouts,
  // because Stripe forbids mixed intervals on one subscription. So this says
  // so rather than quoting an annual customer a figure their invoice will
  // never show — a console that disagrees with the invoice is the exact
  // failure this card exists to prevent.
  //
  // ⚠️ THIS SENTENCE GOES STALE THE MOMENT `STRIPE_PRICE_METERED_YEARLY` IS
  // SET IN PRODUCTION. AGL-1280 minted `aglyn_metered_usage_yearly` on the
  // same meter and checkout now picks the price matching the interval, so an
  // annual subscription WILL carry a metered item — settling on the yearly
  // renewal invoice, since the meter aggregates over the billing period.
  // This card is a client component and cannot read that server env var, so
  // the copy cannot detect the flip on its own. Whoever sets that variable
  // must update this line in the same change, or the console will tell
  // paying annual customers they are not being charged while they are.
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
              ? 'Your subscription is annual, which carries no metered item ' +
                'today — this is an estimate, not a charge.'
              : 'Billed monthly alongside your subscription.')
          : "Your plan's storage, bandwidth and form submissions are " +
            'included caps, not meters — no usage charges.'}
      </Typography>
    </Stack>
  )
}
BillingMeteredEstimateComponent.displayName = 'BillingMeteredEstimateComponent'

export default BillingMeteredEstimateComponent
