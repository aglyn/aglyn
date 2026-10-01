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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import type { MarketplaceStaffOverview as Overview } from '../model/staff-overview'
import StaffReversalRecoveryCard from './staff-reversal-recovery-card.component'

const formatDate = (millis: number | null): string =>
  millis ? new Date(millis).toLocaleDateString() : '—'

/**
 * The marketplace on the staff overview — the `staffOverview` zone (AGL-3080).
 *
 * Two cards from ONE read of `/api/marketplace/admin/overview`: recent paid
 * purchases with the platform fee taken from each, and the refund-reversal
 * recovery queue (AGL-2309) — money owed to Aglyn. One read because the
 * queue's total and its rows are the same money, and two fetches are how a
 * total and its rows start disagreeing.
 *
 * The overview is the shell's page; the purchases are this plugin's own
 * collection, so the shell hands over nothing and this widget reads them.
 */
export function StaffMarketplaceOverview() {
  const { data: user } = useUser()
  const [data, setData] = useState<Overview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    void authorizedFetch(user, '/api/marketplace/admin/overview')
      .then(async (response) => {
        if (!response.ok) throw new Error(`overview answered ${response.status}`)
        return (await response.json()) as Overview
      })
      .then((body) => {
        if (active) setData(body)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [user])

  return (
    <Stack spacing={3}>
      <CardDisplay
        header={'Marketplace purchases'}
        help={pluginDocsHelp('publisherHandbook', {
          anchor: '#getting-paid',
          excerpt:
            'Recent paid plugin purchases with the platform fee taken from each sale.',
        })}
        contentGutterX
        contentGutterY
      >
        {failed ? (
          // A read that failed is not an empty queue: say so, or a refused
          // reversal would read as "nothing owed".
          <Alert severity="error">{'The marketplace overview could not be read.'}</Alert>
        ) : (data?.purchases ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {data ? 'No purchases yet.' : 'Loading…'}
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {(data?.purchases ?? []).map((purchase) => (
              <Stack key={purchase.$id} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>
                  {purchase.listingId ?? purchase.$id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {`$${(purchase.amountCents / 100).toFixed(2)}` +
                    ` (fee $${(purchase.feeCents / 100).toFixed(2)}) · ${formatDate(purchase.createdAt)}`}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </CardDisplay>
      {/* Only once read: before then "nothing outstanding" would be a claim
          about money nobody has looked at yet. */}
      {data ? (
        <StaffReversalRecoveryCard rows={data.reversalRecovery} owedCents={data.reversalOwedCents} />
      ) : null}
    </Stack>
  )
}

export default StaffMarketplaceOverview
