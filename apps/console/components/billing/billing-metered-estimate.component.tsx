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

import {
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
  METERED_MARKUP,
} from '@aglyn/aglyn'
import { Stack, Typography } from '@mui/material'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { documentId } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'

export interface BillingMeteredEstimateProps {
  hosts: any[]
}

/**
 * Month-to-date metered cost estimate (AGL-41): mirrors the report-usage
 * rollup's math (shared `estimateMonthlyUsageCost`) over the same counters
 * so tenants see the number before it lands on an invoice.
 */
export function BillingMeteredEstimateComponent(
  props: BillingMeteredEstimateProps,
) {
  const { hosts } = props
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

  const estimate = estimateMonthlyUsageCost(snapshots ?? [])
  return (
    <Stack spacing={0.5}>
      <Typography variant="h5">
        {snapshots
          ? `$${(estimate.billedCents / 100).toFixed(2)}`
          : 'Calculating…'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {`Month to date (${month}): ` +
          `${estimate.storageGb.toFixed(2)} GB stored · ` +
          `${estimate.pageViews} page views · ` +
          `${estimate.formSubmissions} form submissions`}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {`Infra cost passed through at cost × ${METERED_MARKUP}. Billed ` +
          'monthly alongside your subscription once metered billing is live.'}
      </Typography>
    </Stack>
  )
}
BillingMeteredEstimateComponent.displayName = 'BillingMeteredEstimateComponent'

export default BillingMeteredEstimateComponent
