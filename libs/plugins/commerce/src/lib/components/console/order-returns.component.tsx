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

import * as CommerceModel from '../../model'
import { Button, Chip, Divider, Link, Stack, Typography } from '@mui/material'
import { collection, query, where } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import ReturnDetailDialog from './return-detail-dialog.component'
import StartReturnDialog from './start-return-dialog.component'

export interface OrderReturnsProps {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
}

/** Order statuses a return may be started against — the route's own list. */
const STARTABLE_STATUSES = ['paid', 'partially_fulfilled', 'fulfilled', 'delivered']

/**
 * The order dialog's returns (AGL-3611): the returns on this order, each
 * opening its return dialog, and "Start return" while the order can take one.
 * Kept out of `order-detail-dialog` on purpose: the dialog is shared by
 * several lanes, and this is one line there.
 *
 * `orderId ==` alone, on the automatic single-field index. An order holds a
 * handful of returns at most, so the read is the whole answer.
 */
export function OrderReturns(props: OrderReturnsProps) {
  const { hostId, orderId, order } = props
  const firestore = useFirestore()
  const { data: returnDocs } = useFirestoreCollection<CommerceModel.HostReturn & { $id: string }>(
    () => query(collection(firestore, 'hosts', hostId, 'returns'), where('orderId', '==', orderId)),
    [firestore, hostId, orderId],
    { idField: '$id' },
  )
  const returns = useMemo(
    () => [...(returnDocs ?? [])].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)),
    [returnDocs],
  )
  const [starting, setStarting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const startable = STARTABLE_STATUSES.includes(order.status)

  if (!startable && returns.length === 0) return null
  return (
    <>
      <Divider />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {'Returns'}
        </Typography>
        {startable ? (
          <Button size="small" onClick={() => setStarting(true)}>
            {'Start return'}
          </Button>
        ) : null}
      </Stack>
      {returns.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          {'No returns on this order.'}
        </Typography>
      ) : (
        returns.map((entry) => (
          <Stack key={entry.$id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Link
              component="button"
              variant="body2"
              onClick={() => setOpenId(entry.$id)}
              sx={{ flex: 1, textAlign: 'left' }}
            >
              {CommerceModel.describeReturnLines(order, entry.lines ?? [])}
            </Link>
            <Typography variant="caption" color="text.secondary">
              {new Date(entry.createdAtMs).toLocaleDateString()}
            </Typography>
            <Chip
              label={CommerceModel.RETURN_STATUS_LABELS[entry.status] ?? entry.status}
              size="small"
              color={CommerceModel.RETURN_STATUS_COLOR[entry.status] ?? 'default'}
              variant="outlined"
            />
          </Stack>
        ))
      )}
      {starting ? (
        <StartReturnDialog
          hostId={hostId}
          orderId={orderId}
          order={order}
          existing={returns}
          open
          onClose={() => setStarting(false)}
          onCreated={setOpenId}
        />
      ) : null}
      {openId ? (
        <ReturnDetailDialog hostId={hostId} returnId={openId} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  )
}
OrderReturns.displayName = 'OrderReturns'

export default OrderReturns
