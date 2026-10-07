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

import { doc } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { buildPosReceipt, type PosReceiptOrder } from '../../../model/commerce-pos-ops'
import { usePosReceiptStore } from './pos-receipt-actions.component'
import { printPosReceipt } from './pos-receipt'

export interface PosSaleReceipt {
  /** The stored sale, once read; the receipt prints from it, never from the basket. */
  order: (PosReceiptOrder & { registerId?: string }) | null
  /** Prints the 80 mm receipt (or the gift receipt); false while the sale is unread. */
  print: (gift?: boolean) => boolean
}

/**
 * The thermal receipt of one completed sale, for the tablet register's
 * receipt step (AGL-3607): the same receipt, store header and gift option the
 * operations strip prints (AGL-3609), read back from the stored order.
 */
export function usePosSaleReceipt(input: {
  hostId: string
  orderId: string
  registerName?: string
  cashierName?: string
}): PosSaleReceipt {
  const { hostId, orderId, registerName, cashierName } = input
  const firestore = useFirestore()
  const store = usePosReceiptStore(hostId)
  const { data } = useFirestoreDoc<PosReceiptOrder & { registerId?: string }>(
    () => doc(firestore, 'hosts', hostId, 'orders', orderId),
    [firestore, hostId, orderId],
  )
  const order = data ?? null
  const print = useCallback(
    (gift = false) => {
      if (!order) return false
      printPosReceipt(
        buildPosReceipt({
          orderId,
          order,
          store,
          gift,
          ...(cashierName ? { cashierName } : {}),
          ...(registerName ? { registerName } : {}),
        }),
      )
      return true
    },
    [order, orderId, store, cashierName, registerName],
  )
  return { order, print }
}
