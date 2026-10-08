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

import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import type { ReactElement } from 'react'
import { posOfflineFlagLabels } from '../../../model/commerce-pos-offline'
import { usd } from '../pos/pos-api'
import type { PosOfflineState } from './use-pos-offline'

/*==========================================
 * WHAT THE REGISTER SAYS ABOUT ITS CONNECTION (AGL-3625).
 *
 *  - offline: what still sells (cash), what does not (cards, gift cards,
 *    room charges), and how many sales are waiting on this device;
 *  - back online: the sync, then what the server flagged — stock that went
 *    short, a changed price, a closed shift — by order number;
 *  - a sale the server would not take, kept on the device with its reason.
 *
 * Nothing when the register is online with nothing waiting and nothing to say.
 *=========================================*/

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function PosOfflineBanner(props: { offline: PosOfflineState }) {
  const { offline } = props
  const { confirm } = useConfirmationContext()
  const waiting = offline.queue.filter((entry) => entry.state === 'queued')
  const refused = offline.queue.filter((entry) => entry.state === 'refused')
  const waitingCents = waiting.reduce((sum, entry) => sum + entry.sale.totals.totalCents, 0)
  const alerts: ReactElement[] = []

  if (offline.offline) {
    alerts.push(
      <Alert key="offline" severity="warning" role="status">
        <AlertTitle>{'Offline'}</AlertTitle>
        {offline.ready
          ? 'Cash sales keep ringing and are saved on this register until the connection returns. ' +
            'Card readers, typed cards, the QR link, gift cards, store credit and room charges are off.'
          : `Sales are paused: ${offline.unavailableReason ?? 'this register cannot sell offline.'}`}
        {waiting.length ? (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {`${plural(waiting.length, 'sale', 'sales')} (${usd(waitingCents)}) waiting to sync.`}
          </Typography>
        ) : null}
      </Alert>,
    )
  } else if (waiting.length) {
    alerts.push(
      <Alert
        key="sync"
        severity="info"
        role="status"
        action={
          offline.syncing ? null : (
            <Button color="inherit" size="small" onClick={() => void offline.syncNow()}>
              {'Sync now'}
            </Button>
          )
        }
      >
        {offline.syncing
          ? `Syncing ${plural(waiting.length, 'offline sale', 'offline sales')}…`
          : `${plural(waiting.length, 'offline sale', 'offline sales')} (${usd(waitingCents)}) waiting to sync.`}
      </Alert>,
    )
  }

  if (offline.syncError) {
    alerts.push(
      <Alert key="error" severity="error">
        {`Offline sales could not sync: ${offline.syncError} They stay on this register.`}
      </Alert>,
    )
  }

  for (const entry of refused) {
    alerts.push(
      <Alert
        key={`refused-${entry.saleKey}`}
        severity="error"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={async () => {
              const confirmed = await confirm({
                title: 'Remove this sale from the register?',
                description:
                  `The ${usd(entry.sale.totals.totalCents)} cash sale will not be recorded anywhere. ` +
                  'Record it by hand first if the cash was taken.',
                confirmationText: 'Remove',
                confirmationButtonProps: { color: 'error' },
              })
                .then(() => true)
                .catch(() => false)
              if (confirmed) await offline.discard(entry.saleKey)
            }}
          >
            {'Remove'}
          </Button>
        }
      >
        {`A ${usd(entry.sale.totals.totalCents)} offline sale from ${new Date(entry.sale.soldAtMs).toLocaleString()} ` +
          `did not sync: ${entry.error ?? 'refused'}`}
      </Alert>,
    )
  }

  if (offline.notices.length) {
    alerts.push(
      <Alert
        key="notices"
        severity="warning"
        action={
          <Button color="inherit" size="small" onClick={offline.dismissNotices}>
            {'Dismiss'}
          </Button>
        }
      >
        <AlertTitle>{'Synced, with something to check'}</AlertTitle>
        <Stack spacing={0.5}>
          {offline.notices.map((notice) => (
            <Typography key={notice.saleKey} variant="body2">
              {`Order ${notice.number ? `#${notice.number}` : notice.orderId}: ` +
                [
                  ...notice.stockConflicts.map(
                    (conflict) => `${conflict.shortUnits} of ${conflict.requested}× ${conflict.name} not in stock`,
                  ),
                  ...posOfflineFlagLabels(notice.flags.filter((flag) => flag !== 'stock-short')),
                ].join('; ')}
            </Typography>
          ))}
        </Stack>
      </Alert>,
    )
  }

  if (!alerts.length) return null
  return <Stack spacing={1}>{alerts}</Stack>
}
PosOfflineBanner.displayName = 'PosOfflineBanner'
