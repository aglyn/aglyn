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

import { useFirestore } from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import type * as CommerceModel from '../../model'
import { buildOrderInvoiceHtml } from '../../utils/order-invoice'

export interface OrderInvoiceButtonProps {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
}

/**
 * "Invoice" (AGL-3611), beside "Packing slip" in the order dialog: the order
 * as a printable bill, which the print dialog also saves as a PDF. The store's
 * name, currency and footer are read when it is clicked, not while the dialog
 * is open, so the dialog listens to nothing more.
 */
export function OrderInvoiceButton(props: OrderInvoiceButtonProps) {
  const { hostId, orderId, order } = props
  const firestore = useFirestore()
  const [busy, setBusy] = useState(false)

  const handleInvoice = useCallback(async () => {
    // Opened before the reads, inside the click, so a popup blocker sees the
    // user's gesture.
    const win = window.open('', '_blank', 'width=720,height=900')
    if (!win) return
    setBusy(true)
    try {
      const [host, store] = await Promise.all([
        getDoc(doc(firestore, 'hosts', hostId)).catch(() => null),
        getDoc(doc(firestore, 'hosts', hostId, 'settings', 'store')).catch(() => null),
      ])
      const hostData = (host?.data() ?? {}) as Record<string, unknown>
      const storeData = (store?.data() ?? {}) as Record<string, unknown>
      const html = buildOrderInvoiceHtml({
        order,
        orderId,
        store: {
          name: String(hostData['businessName'] ?? hostData['displayName'] ?? hostData['name'] ?? ''),
          currency: String(storeData['currency'] ?? 'USD'),
          footer: (storeData['receiptFooter'] as string | undefined) ?? null,
          termsUrl: (storeData['termsUrl'] as string | undefined) ?? null,
        },
      })
      // Every value in `html` is escaped by the builder (AGL-2283).
      win.document.write(html)
      win.document.close()
      // Print from the opener, not an injected script: the popup inherits
      // the console's CSP (AGL-523).
      win.focus()
      win.print()
    } finally {
      setBusy(false)
    }
  }, [firestore, hostId, orderId, order])

  return (
    <Button disabled={busy} onClick={handleInvoice}>
      {'Invoice'}
    </Button>
  )
}
OrderInvoiceButton.displayName = 'OrderInvoiceButton'

export default OrderInvoiceButton
