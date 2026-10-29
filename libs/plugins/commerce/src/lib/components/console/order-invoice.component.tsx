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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Button, ListItemText, Menu, MenuItem } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import type * as CommerceModel from '../../model'
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import { buildOrderInvoiceHtml, invoiceStoreFrom } from '../../utils/order-invoice'
import { downloadCommercePdf } from './commerce-pdf-download'
import { InvoiceSendDialog } from './invoice-send.component'

export interface OrderInvoiceButtonProps {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
  /**
   * Holds "Send quotes and invoices to customers" (`commerce.quotes.send`),
   * which Send invoice asks (AGL-4099). Absent reads as held: the route decides.
   */
  canSend?: boolean
}

/**
 * "Invoice" (AGL-3611), beside "Packing slip" in the order dialog: a menu of
 * "Print invoice", the order as a printable bill, and "Download PDF"
 * (AGL-4095), the branded invoice the server makes in the site's colors with
 * its logo (`commerce/order-print?kind=invoice-pdf`, "Manage orders"). The
 * store's name, currency and footer are read when one is clicked, not while
 * the dialog is open, so the dialog listens to nothing more.
 *
 * "Send invoice" (AGL-4099) emails it to the customer with the PDF attached:
 * an unpaid order's with a Pay button to its lasting pay link, a paid one's
 * as the record (`invoice-send.component.tsx`).
 */
export function OrderInvoiceButton(props: OrderInvoiceButtonProps) {
  const { hostId, orderId, order, canSend = true } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [sending, setSending] = useState(false)

  const handleDownload = useCallback(async () => {
    setAnchor(null)
    setBusy(true)
    try {
      const query = new URLSearchParams({ hostId, orderId, kind: 'invoice-pdf' })
      const refused = await downloadCommercePdf(
        user,
        `/api/commerce/order-print?${query.toString()}`,
        { method: 'GET' },
        `invoice-${order.number ?? orderId.slice(-6)}.pdf`,
      )
      if (refused) enqueueSnackbar(refused, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(false)
    }
  }, [user, hostId, orderId, order.number, enqueueSnackbar])

  const handleInvoice = useCallback(async () => {
    setAnchor(null)
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
      const html = buildOrderInvoiceHtml({
        order,
        orderId,
        store: invoiceStoreFrom(
          host?.data() as Record<string, unknown> | undefined,
          store?.data() as Record<string, unknown> | undefined,
        ),
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
    <>
      <Button
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {'Invoice'}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => void handleInvoice()}>{'Print invoice'}</MenuItem>
        <MenuItem onClick={() => void handleDownload()}>{'Download PDF'}</MenuItem>
        <MenuItem
          disabled={!canSend}
          onClick={() => {
            setAnchor(null)
            setSending(true)
          }}
        >
          <ListItemText
            primary="Send invoice"
            secondary={canSend ? undefined : commerceSitePermissionRefusal('commerce.quotes.send')}
          />
        </MenuItem>
      </Menu>
      <InvoiceSendDialog
        open={sending}
        onClose={() => setSending(false)}
        hostId={hostId}
        orderId={orderId}
        order={order}
      />
    </>
  )
}
OrderInvoiceButton.displayName = 'OrderInvoiceButton'

export default OrderInvoiceButton
