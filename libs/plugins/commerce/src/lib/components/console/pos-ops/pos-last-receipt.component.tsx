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

import { Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import type { PosReceiptOrder } from '../../../model/commerce-pos-ops'
import { PosReceiptActions } from './pos-receipt-actions.component'

export interface PosLastReceiptProps {
  hostId: string
  orderId: string
  registerName?: string
  /** The cashier's name as the receipt prints it. */
  cashierName?: string
}

/**
 * The register's last sale (AGL-3609): its receipt and gift receipt for the
 * browser's print dialog, read from the stored order — so the printout
 * carries the tenders, tip and change the server recorded, not the basket the
 * register remembers — and the register's cloud printer when it has one.
 */
export function PosLastReceipt(props: PosLastReceiptProps) {
  const firestore = useFirestore()
  const { data: order } = useFirestoreDoc<PosReceiptOrder & { registerId?: string; number?: number }>(
    () => doc(firestore, 'hosts', props.hostId, 'orders', props.orderId),
    [firestore, props.hostId, props.orderId],
  )
  if (!order) return null
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {order.number ? `Last sale #${order.number}` : 'Last sale'}
      </Typography>
      <PosReceiptActions
        hostId={props.hostId}
        orderId={props.orderId}
        order={{ ...order, ...(props.cashierName ? { cashierName: props.cashierName } : {}) }}
        {...(props.registerName ? { registerName: props.registerName } : {})}
        cloudPrint="sale"
      />
    </Stack>
  )
}

PosLastReceipt.displayName = 'PosLastReceipt'

export default PosLastReceipt
