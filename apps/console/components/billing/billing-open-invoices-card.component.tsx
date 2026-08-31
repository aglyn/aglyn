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

import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { getBrowserStripe } from '../../utils/browser-stripe'

interface OpenInvoice {
  id: string
  number: string | null
  status: string | null
  amountDueCents: number
  currency: string
  created: string | null
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}

export interface BillingOpenInvoicesCardProps {
  orgId?: string | null
  /** billing.manage: paying moves money. */
  canManage: boolean
  /**
   * Open the Stripe Billing Portal.
   *
   * KEPT, and kept HERE specifically. The native pay button above is new and
   * has not yet been exercised against a real failed payment, so the portal
   * has to stay reachable — but it belongs beside dunning recovery, which is
   * this card, rather than behind a button labelled "manage payment methods"
   * that should go to the surface that manages payment methods.
   *
   * Absent when the caller cannot open it, and then nothing renders.
   */
  onOpenPortal?: () => void
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/**
 * What this workspace owes right now, and the button that settles it.
 *
 * ## The gap this closes
 *
 * There was no way to pay an open invoice in the console. The Stripe Billing
 * Portal button was the entire recovery story, which is why it stays until
 * this card is the one people reach for — removing it first would have taken
 * a customer in dunning from "an inconsistent-looking page" to "no way to
 * pay at all".
 *
 * ## Why this card must not check the plan
 *
 * The org reading it is very often the one every other billing surface turns
 * away: `past_due`, `unpaid`, or already cancelled by dunning. The invoice is
 * owed regardless, and the route deliberately has no subscription check —
 * this card must not reintroduce one by hiding itself.
 *
 * ## It never says "paid"
 *
 * The button reports that Stripe ACCEPTED the attempt. Whether the money
 * arrived is decided by `invoice.payment_succeeded` on the webhook, and the
 * list re-reads from Stripe rather than assuming. A page that says "paid"
 * because its own request returned 200 is the browser deciding a thing only
 * the webhook knows.
 */
export default function BillingOpenInvoicesCardComponent({
  orgId,
  canManage,
  onOpenPortal,
}: BillingOpenInvoicesCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null)
  const [loadState, setLoadState] = useState<
    'pending' | 'unconfigured' | 'error' | 'loaded'
  >('pending')
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  const send = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await authorizedFetch(user, '/api/billing/pay-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...payload }),
      })
      return { status: response.status, body: await response.json().catch(() => ({})) }
    },
    [orgId, user],
  )

  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    setLoadState('pending')
    send({ action: 'get' })
      .then((outcome) => {
        if (cancelled) return
        if (outcome.status === 501) return void setLoadState('unconfigured')
        if (outcome.status >= 400) return void setLoadState('error')
        setInvoices(outcome.body?.invoices ?? [])
        setLoadState('loaded')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, user, send, nonce])

  const pay = async (invoice: OpenInvoice) => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await send({ action: 'pay', invoiceId: invoice.id })
      if (outcome.body?.alreadyPaid) {
        enqueueSnackbar('That invoice is already settled.', {
          variant: 'info',
          persist: false,
        })
        return void setNonce((value) => value + 1)
      }
      // The issuer wants authentication. The same handling as a first
      // purchase — an invoice that silently fails to a 3DS prompt nobody sees
      // is the same defect one step later.
      if (outcome.body?.requiresAction && outcome.body?.paymentClientSecret) {
        const stripe = await getBrowserStripe()
        if (!stripe) {
          return void enqueueSnackbar(
            'Your bank needs to confirm this payment, but the payment ' +
              'library could not load. Nothing has been charged.',
            { variant: 'warning', persist: false },
          )
        }
        // `handleNextAction`, because the route already confirmed the intent
        // server-side and it is sitting at `requires_action` — the only step
        // left belongs to the bank. This is the one Stripe.js method defined
        // for that status, and it throws on any other.
        //
        // `confirmPayment` is a different verb: it CONFIRMS an intent from
        // Payment Element data or an explicit `confirmParams.payment_method`.
        // Neither exists on this path — the card is the customer's saved
        // default, attached by Stripe when the invoice was paid — so there is
        // nothing for it to confirm with, and the intent is already past the
        // status it accepts.
        const confirmed = await stripe.handleNextAction({
          clientSecret: String(outcome.body.paymentClientSecret),
        })
        if (confirmed.error) {
          return void enqueueSnackbar(
            confirmed.error.message ??
              'Your bank did not confirm the payment. Nothing has been charged.',
            { variant: 'warning', persist: false },
          )
        }
      } else if (outcome.status >= 400) {
        return void enqueueSnackbar(
          outcome.body?.error ?? 'That payment did not go through.',
          { variant: 'warning', persist: false },
        )
      }
      // Deliberately not "Paid". Stripe accepted the attempt; the webhook
      // decides the rest, and the list re-reads rather than assuming.
      enqueueSnackbar(
        'Payment submitted. This invoice updates as soon as Stripe confirms it.',
        { variant: 'success', persist: false },
      )
      setNonce((value) => value + 1)
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  /*
   * Stripe's own portal, named for what it is rather than for one of the
   * things it happens to contain. It is the fallback while the native pay
   * button above is still unproven against a real failed payment, so it sits
   * with dunning recovery — the one place its absence would actually cost
   * somebody money.
   */
  const portalLink = onOpenPortal ? (
    <Link
      component="button"
      type="button"
      variant="caption"
      onClick={onOpenPortal}
      sx={{ alignSelf: 'flex-start' }}
    >
      {'Open the Stripe billing portal'}
    </Link>
  ) : null

  if (loadState === 'pending') {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Checking for anything outstanding…'}
      </Typography>
    )
  }
  if (loadState === 'unconfigured') {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Outstanding invoices appear here once billing is configured on this deployment.'}
      </Typography>
    )
  }
  if (loadState === 'error') {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => setNonce((v) => v + 1)}>
            {'Retry'}
          </Button>
        }
      >
        {'We couldn’t check for outstanding invoices. This says nothing about ' +
          'your billing — we could not reach it to find out.'}
      </Alert>
    )
  }
  if (!invoices?.length) {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Nothing outstanding.'}
        </Typography>
        {portalLink}
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <Alert severity="warning">
        {invoices.length === 1
          ? 'You have one unpaid invoice.'
          : `You have ${invoices.length} unpaid invoices.`}
      </Alert>
      <List dense disablePadding>
        {invoices.map((invoice) => (
          <ListItem key={invoice.id} disableGutters>
            <ListItemText
              primary={`${invoice.number ?? invoice.id} · ${money(
                invoice.amountDueCents,
                invoice.currency,
              )}`}
              secondary={
                invoice.created
                  ? new Date(invoice.created).toLocaleDateString()
                  : null
              }
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {invoice.hostedInvoiceUrl ? (
                <Link
                  href={invoice.hostedInvoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                >
                  {'View'}
                </Link>
              ) : null}
              {canManage ? (
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy}
                  onClick={() => void pay(invoice)}
                >
                  {'Pay now'}
                </Button>
              ) : null}
            </Stack>
          </ListItem>
        ))}
      </List>
      {portalLink}
    </Stack>
  )
}
