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
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
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
import { PayLinkReadinessNotice, usePayLinkReadiness } from './pay-link-readiness-notice.component'

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
 * own.
 *
 * The form's body mounts with the dialog's opening, so everything it reads
 * (the site's name and contact email, once; the store's tax choice and its
 * payments, live) is read only while it is open, and the dialog that offers
 * it listens to nothing more. It says what the customer's Pay waits on, if
 * anything (AGL-4162), and judges the send under the store's sales tax choice
 * as the server does: a quote saved before the store chose is sent as the
 * store's choice prices it.
 */
export function InvoiceSendDialog(props: InvoiceSendDialogProps) {
  const { open, onClose } = props
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="invoice-send-title">
      <InvoiceSendForm {...props} busy={busy} setBusy={setBusy} />
    </Dialog>
  )
}

/** The open form: filled once when it mounts; edits after that are the member's. */
function InvoiceSendForm(
  props: InvoiceSendDialogProps & { busy: boolean; setBusy: (busy: boolean) => void },
) {
  const { onClose, hostId, orderId, order, busy, setBusy } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [to, setTo] = useState(() => CommerceModel.invoiceSendPrefill(order))
  const [subject, setSubject] = useState(() => CommerceModel.invoiceEmailDefaultSubject(order, '', orderId))
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
    let live = true
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
  }, [])

  const readiness = usePayLinkReadiness(hostId, order)
  const paid = CommerceModel.invoiceIsPaid(order)
  const refused = CommerceModel.invoiceSendRefusal(order, orderId, to.trim(), readiness.store)
  // The address is the form's to fix; every other refusal is the order's,
  // said up front once the store's settings are read. One the notice already
  // names, with its fix, is not said twice.
  const blocker = refused && refused !== 'no-address' && refused !== 'bad-address' ? refused : null
  const toldByNotice =
    (blocker === 'tax-undecided' && readiness.gaps?.includes('tax-undecided')) ||
    (blocker === 'tax-save' && readiness.gaps?.includes('tax-save'))
  const blockerLine = blocker && !readiness.storeLoading && !toldByNotice ? blocker : null
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
  }, [user, hostId, orderId, to, subject, message, number, enqueueSnackbar, onClose, setBusy])

  return (
    <>
      <DialogTitle id="invoice-send-title">{`Send invoice: ${number}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <PayLinkReadinessNotice readiness={readiness} noun="invoice" />
          {blockerLine ? (
            <Typography variant="body2" color="error">
              {CommerceModel.invoiceSendRefusalMessage(blockerLine)}
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
        <BlockedControl
          blocked={Boolean(blocker) && !readiness.storeLoading}
          reason={blocker ? CommerceModel.invoiceSendRefusalMessage(blocker) : ''}
        >
          <Button
            variant="contained"
            disabled={busy || !to.trim() || Boolean(blocker) || readiness.storeLoading}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </BlockedControl>
      </DialogActions>
    </>
  )
}

InvoiceSendDialog.displayName = 'InvoiceSendDialog'

export default InvoiceSendDialog
