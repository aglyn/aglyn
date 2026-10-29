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
import { siteContactEmail, resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'

/** `Oct 29, 2026, 3:04 PM`. */
const sentAt = (atMs: number) =>
  new Date(atMs).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The order's (or the quote's) last invoice email, as the console says it:
 * `Invoice sent Oct 29, 2026, 3:04 PM to jordan@example.com.` Null when none
 * was sent.
 */
export function invoiceSentLine(order: Pick<CommerceModel.HostOrder, 'invoiceSends'>): string | null {
  const last = CommerceModel.lastInvoiceSend(order)
  if (!last) return null
  return `${last.paid ? 'Paid invoice' : 'Invoice'} sent ${sentAt(Number(last.atMs))} to ${last.to || 'the customer'}.`
}

export interface InvoiceSendDialogProps {
  open: boolean
  onClose: () => void
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
}

/**
 * Send invoice (AGL-4099), for an order or a quote: a short form (To,
 * Subject, Message) that emails the invoice in the site's look with the
 * invoice PDF attached. Unpaid, the email carries a Pay button to the order's
 * lasting pay link on the business's site; paid, it is the customer's record.
 * A quote's invoice lands in the quote's conversation, and an order's in its
 * own. The site's name and contact email are read once when the form opens,
 * so the dialog that offers it listens to nothing more.
 */
export function InvoiceSendDialog(props: InvoiceSendDialogProps) {
  const { open, onClose, hostId, orderId, order } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState<string | null>(null)

  /*
   * One attempt per form (AGL-1697's rule): a retried Send presents the same
   * key and is answered from the first, so the customer never gets two; a
   * changed form is a new attempt.
   */
  const attemptKey = useRef('')
  useEffect(() => {
    attemptKey.current = ''
  }, [to, subject, message])

  useEffect(() => {
    if (!open) return
    let live = true
    setTo(CommerceModel.invoiceSendPrefill(order))
    setSubject(CommerceModel.invoiceEmailDefaultSubject(order, '', orderId))
    setMessage('')
    void getDoc(doc(firestore, 'hosts', hostId))
      .then((snapshot) => {
        if (!live) return
        const host = (snapshot.data() ?? {}) as Record<string, unknown>
        const businessName = String(resolveHostToken('businessName', host as HostTokenSource) ?? '').trim()
        setSubject(CommerceModel.invoiceEmailDefaultSubject(order, businessName, orderId))
        const listed = siteContactEmail(host as never)
        setContact(listed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(listed) ? listed : null)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // Filled once per opening; edits after that are the member's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const paid = CommerceModel.invoiceIsPaid(order)
  const refused = CommerceModel.invoiceSendRefusal(order, orderId, to.trim())
  // The address is the form's to fix; every other refusal is the order's, said up front.
  const blocker = refused && refused !== 'no-address' && refused !== 'bad-address' ? refused : null
  const threaded = Boolean(CommerceModel.invoiceEmailThread(order))
  const number = CommerceModel.formatInvoiceNumber(order, orderId)

  const send = useCallback(async () => {
    setBusy(true)
    try {
      if (!attemptKey.current) {
        attemptKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const response = await authorizedFetch(user, '/api/commerce/order-invoice-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptKey.current },
        body: JSON.stringify({ hostId, orderId, to, subject, message }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'The invoice could not be sent', { variant: 'error', allowDuplicate: true })
      }
      enqueueSnackbar(`${number} sent to ${String(payload.to ?? to)}`, { variant: 'success', persist: false })
      onClose()
    } finally {
      setBusy(false)
    }
  }, [user, hostId, orderId, to, subject, message, number, enqueueSnackbar, onClose])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="invoice-send-title">
      <DialogTitle id="invoice-send-title">{`Send invoice: ${number}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {blocker ? (
            <Typography variant="body2" color="error">
              {CommerceModel.invoiceSendRefusalMessage(blocker)}
            </Typography>
          ) : null}
          <TextField
            label="To"
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
            fullWidth
            disabled={busy}
          />
          <TextField
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            fullWidth
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: CommerceModel.QUOTE_MAX_SEND_SUBJECT } }}
            helperText={
              threaded
                ? 'Keep the subject the same to keep these emails in one conversation in your customer’s inbox.'
                : undefined
            }
          />
          <TextField
            label="Message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            multiline
            minRows={4}
            fullWidth
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: CommerceModel.QUOTE_MAX_SEND_MESSAGE } }}
            helperText="Shown at the top of the email, in your words."
          />
          <Typography variant="body2" color="text.secondary">
            {(paid
              ? 'The email shows the invoice as paid, with the date it was paid, for your customer’s records. '
              : 'The email shows the invoice number, date, total and what is due, with a button to pay it by card on your site. The button keeps working until it is paid. ') +
              `The invoice is attached as a PDF. Replies go to ${contact || 'your email'}.`}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" disabled={busy || !to.trim() || Boolean(blocker)} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
InvoiceSendDialog.displayName = 'InvoiceSendDialog'

export default InvoiceSendDialog
