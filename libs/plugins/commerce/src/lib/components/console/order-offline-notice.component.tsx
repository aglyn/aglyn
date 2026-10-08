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

import { Alert, AlertTitle, Typography } from '@mui/material'
import type * as CommerceModel from '../../model'
import { posOfflineFlagLabels } from '../../model/commerce-pos-offline'

/**
 * A register sale rung offline (AGL-3625), said on its order: when it was
 * rung and synced, and what the sync found that the merchant should check —
 * stock that went short above all. Nothing on any other order.
 */
export function OrderOfflineNotice(props: { order: Pick<CommerceModel.HostOrder, 'offline'> }) {
  const stamp = props.order.offline
  if (!stamp) return null
  const conflicts = stamp.stockConflicts ?? []
  const flags = (stamp.flags ?? []).filter((flag) => flag !== 'stock-short')
  const checks = [
    ...conflicts.map((conflict) => `${conflict.shortUnits} of ${conflict.requested}× ${conflict.name} not in stock`),
    ...posOfflineFlagLabels(flags),
  ]
  return (
    <Alert severity={checks.length ? 'warning' : 'info'}>
      <AlertTitle>{'Rung while the register was offline'}</AlertTitle>
      <Typography variant="body2">
        {`Rung ${new Date(stamp.soldAtMs).toLocaleString()}, synced ${new Date(stamp.syncedAtMs).toLocaleString()}.`}
      </Typography>
      {checks.map((check) => (
        <Typography key={check} variant="body2">
          {check}
        </Typography>
      ))}
    </Alert>
  )
}
OrderOfflineNotice.displayName = 'OrderOfflineNotice'
