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
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import { siteContactEmail, resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
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
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { InvoiceSendDialog, invoiceSentLine } from './invoice-send.component'

const SEND_REFUSAL = commerceSitePermissionRefusal('commerce.quotes.send')

export interface QuoteSendSectionProps {
  hostId: string
  quoteId: string
  quote: CommerceModel.HostOrder
  /** Holds "Send quotes and invoices to customers" (`commerce.quotes.send`). */
  canSend: boolean
  /** The editor holds changes not saved yet, which the email would not show. */
  edited: boolean
}

/** `Oct 29, 2026, 3:04 PM`. */
const sentAt = (atMs: number) =>
  new Date(atMs).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Emailing the quote to the customer (AGL-4097): when it was last sent and to
 * whom, and Send quote, Send again or Send revision N, which opens a short
 * form (To, Subject, Message). The server writes the email in the site's
 * look with the proof, the PDF and the pay button, in the customer's
 * conversation with the business.
 *
 * Send invoice (AGL-4099) sits beside it: for an unpaid quote, an invoice for
 * a customer who needs one to pay (with the same pay link); for a paid one,
 * the invoice as their record. Both reply into the quote's conversation.
 */
export function QuoteSendSection(props: QuoteSendSectionProps) {
  const { hostId, quoteId, quote, canSend, edited } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: host } = useFirestoreDoc<Record<string, unknown>>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
  )
  const businessName = String(resolveHostToken('businessName', (host ?? {}) as HostTokenSource) ?? '').trim()
  const section = quote.quote
  const unpaid = CommerceModel.isUnpaidQuote(quote)
  const last = CommerceModel.lastQuoteSend(section)
  const revision = Number(section?.revision ?? 1)
  const label = CommerceModel.quoteSendLabel(section)
  const replacesLink = CommerceModel.quoteSendReplacesLink(section)
  const approvalFirst = CommerceModel.quotePaymentBlockedByApproval(section)
  const proofCount = CommerceModel.currentQuoteProofs(section).length
  const listed = siteContactEmail(host as never)
  const contact = listed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(listed) ? listed : null

  const [open, setOpen] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const invoiceLine = invoiceSentLine(quote)
  const closed = quote.status === 'cancelled' || quote.status === 'refunded'
  const [busy, setBusy] = useState(false)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  /*
   * One attempt per form (AGL-1697's rule): a retried Send presents the same
   * key and is answered from the first, so the customer never gets two; a
   * changed form is a new attempt.
   */
  const attemptKey = useRef('')
  useEffect(() => {
    attemptKey.current = ''
  }, [to, subject, message])

  const openForm = useCallback(() => {
    setTo(String(section?.customer?.email ?? ''))
    setSubject(CommerceModel.quoteEmailDefaultSubject(quote, businessName, quoteId))
    setMessage('')
    setOpen(true)
  }, [section, quote, businessName, quoteId])

  const send = useCallback(async () => {
    setBusy(true)
    try {
      if (!attemptKey.current) {
        attemptKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const response = await authorizedFetch(user, '/api/commerce/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptKey.current },
        body: JSON.stringify({ action: 'send', hostId, quoteId, to, subject, message }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'The quote could not be sent', { variant: 'error', allowDuplicate: true })
      }
      enqueueSnackbar(
        `${CommerceModel.formatQuoteNumber(quote, quoteId)} sent to ${String(payload.to ?? to)}` +
          (payload.linkReplaced ? '. The link in your earlier email no longer opens the quote.' : ''),
        { variant: 'success', persist: false },
      )
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }, [user, hostId, quoteId, to, subject, message, quote, enqueueSnackbar])

  const status = last
    ? `Sent ${sentAt(Number(last.atMs))} to ${last.to || 'the customer'}` +
      (Number(last.revision) < revision ? ` (revision ${last.revision})` : '') +
      '.'
    : 'Not sent yet. Email it with your message, the proof and the PDF, or copy the pay link below and send it yourself.'

  return (
    <Stack spacing={1.5}>
      <Stack spacing={0.5}>
        <Typography variant="subtitle2">{'Email to customer'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {unpaid ? status : last ? status : 'This quote was paid without being emailed.'}
        </Typography>
        {unpaid && replacesLink ? (
          <Typography variant="body2" color="text.secondary">
            {`Sending revision ${revision} gives your customer a new pay link. The link in your earlier email will say the quote was updated.`}
          </Typography>
        ) : null}
        {unpaid && edited ? (
          <Typography variant="body2" color="text.secondary">
            {'Save your changes first: the email shows the quote as it was last saved.'}
          </Typography>
        ) : null}
        {invoiceLine ? (
          <Typography variant="body2" color="text.secondary">
            {invoiceLine}
          </Typography>
        ) : null}
      </Stack>
      {!closed ? (
        <Stack direction="row" spacing={1}>
          {unpaid ? (
            <BlockedControl blocked={!canSend} reason={SEND_REFUSAL}>
              <Button variant="contained" size="small" disabled={busy || edited} onClick={openForm}>
                {label}
              </Button>
            </BlockedControl>
          ) : null}
          <BlockedControl blocked={!canSend} reason={SEND_REFUSAL}>
            <Button
              variant={unpaid ? 'outlined' : 'contained'}
              size="small"
              disabled={busy || (unpaid && edited)}
              onClick={() => setInvoicing(true)}
            >
              {'Send invoice'}
            </Button>
          </BlockedControl>
        </Stack>
      ) : null}
      <InvoiceSendDialog
        open={invoicing}
        onClose={() => setInvoicing(false)}
        hostId={hostId}
        orderId={quoteId}
        order={quote}
      />
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} maxWidth="sm" fullWidth aria-labelledby="quote-send-title">
        <DialogTitle id="quote-send-title">{`${label}: ${CommerceModel.formatQuoteNumber(quote, quoteId)}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
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
                section?.emailThread
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
              {`The email shows the quote number, revision ${revision} and total` +
                (proofCount ? ', the proof' : '') +
                `, with the quote attached as a PDF and a button to ${approvalFirst ? 'approve the proof' : 'pay'} on your site. ` +
                `Replies go to ${contact || 'your email'}.`}
            </Typography>
            {replacesLink ? (
              <Typography variant="body2" color="text.secondary">
                {'This sends a new pay link. The link in your earlier email will say the quote was updated.'}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy || !to.trim()} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
QuoteSendSection.displayName = 'QuoteSendSection'

export default QuoteSendSection
