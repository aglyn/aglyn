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

import * as Aglyn from '@aglyn/aglyn'
import * as CommerceModel from '../../model'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { doc, runTransaction, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'

export interface OrderDetailDialogProps {
  hostId: string
  order: (CommerceModel.HostOrder & { $id: string }) | null
  onClose: () => void
}

const STATUS_COLOR: Record<
  string,
  'default' | 'success' | 'warning' | 'error' | 'info'
> = {
  pending: 'warning',
  paid: 'info',
  partially_fulfilled: 'info',
  fulfilled: 'success',
  delivered: 'success',
  cancelled: 'default',
  refunded: 'error',
}

/**
 * The dispute chip's colour (AGL-1796).
 *
 * `open` is WARNING rather than error because it is the case that still has a
 * deadline on it — the merchant can still act, and a red chip on a case they
 * might win says the money is gone when it is not. `lost` is the one that took
 * the money, and shares `refunded`'s red for that reason.
 */
export const DISPUTE_COLOR: Record<
  CommerceModel.OrderDisputeTone,
  'default' | 'success' | 'warning' | 'error'
> = {
  open: 'warning',
  lost: 'error',
  won: 'success',
  settled: 'default',
}

const usd = (cents: number | undefined) =>
  `$${((cents ?? 0) / 100).toFixed(2)}`

/**
 * Order detail (AGL-287): timeline, line items, totals, and the actions
 * the status machine allows — fulfill with tracking, refund (admin,
 * server API), cancel, notes, printable packing slip.
 */
export function OrderDetailDialog(props: OrderDetailDialogProps) {
  const { hostId, order: rawOrder, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [tracking, setTracking] = useState<{ carrier: string; number: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const order = rawOrder ? CommerceModel.liftLegacyOrder(rawOrder) : null
  const orderId = rawOrder?.$id

  const write = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!orderId) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'orders', orderId), patch)
    },
    [firestore, hostId, orderId],
  )

  const handleFulfill = useCallback(async () => {
    if (!order || !tracking) return
    const fulfillment: CommerceModel.OrderFulfillment = {
      id: Aglyn.createResourceUid(),
      lineItemIds: (order.lineItems ?? []).map((_line, index) => index),
      ...(tracking.carrier ? { carrier: tracking.carrier } : {}),
      ...(tracking.number ? { trackingNumber: tracking.number } : {}),
      atMs: Date.now(),
    }
    await write({
      status: 'fulfilled',
      fulfillments: [...(order.fulfillments ?? []), fulfillment],
      timeline: CommerceModel.appendOrderEvent(
        order,
        'fulfilled',
        tracking.number
          ? `${tracking.carrier || 'Shipped'} ${tracking.number}`
          : 'Fulfilled',
      ),
    })
    setTracking(null)
    enqueueSnackbar('Order fulfilled', { variant: 'success', persist: false })
  }, [order, tracking, write, enqueueSnackbar])

  /**
   * Cancel goes through `/api/commerce/cancel-order` (AGL-1818), not a client
   * write. The status flip and the stock release are one transaction there,
   * and the route re-asks `canTransitionOrder` under the same lock — the
   * `can('cancelled')` gate below only decides whether to RENDER the button,
   * so a dialog held open while the order ships in another tab used to write
   * `cancelled` straight onto a `fulfilled` order. Now that race comes back
   * as a 409 carrying the state that refused it.
   *
   * The messages follow the AGL-1784/1786 contract — say what happened:
   * a 409 is the guard refusing, not the cancel machinery failing; the
   * route's own 500 is a rolled-back transaction (nothing landed, retry is
   * safe and correct); an answer with no JSON word from the handler, or no
   * answer at all, is NOT KNOWN — never "nothing happened". A retry is safe
   * in every case because the route cancels once: a second cancel finds
   * `cancelled` and returns success without touching stock.
   */
  const handleCancel = useCallback(async () => {
    if (!order || !orderId) return
    const confirmed = await confirm({
      title: 'Cancel this order?',
      description:
        'The buyer is NOT refunded automatically — refund first if they paid.',
      confirmationText: 'Cancel order',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      let response: Response
      try {
        response = await fetch('/api/commerce/cancel-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, orderId }),
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar(
          'The request did not complete, so it is NOT known whether the ' +
            'order was cancelled. Reopen the order to check — retrying is ' +
            'safe, the server cancels once.',
          { variant: 'error', allowDuplicate: true },
        )
        return
      }
      const payload: any = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 409) {
          // The transition guard refusing: the order moved on (shipped,
          // refunded) while this dialog was open. The route's message names
          // the state that refused it, and nothing was written.
          enqueueSnackbar(
            payload?.error ?? 'This order can no longer be cancelled',
            {
              variant: 'warning',
              allowDuplicate: true,
            },
          )
        } else if (payload?.error && response.status < 500) {
          // A refusal that wrote nothing — session, role, or an order that
          // is not there. The route's own word, verbatim.
          enqueueSnackbar(payload.error, {
            variant: 'error',
            allowDuplicate: true,
          })
        } else if (payload?.error) {
          // The route's 500 is a rolled-back transaction: nothing landed and
          // the order is still open. Only the handler's own JSON word
          // licenses saying so.
          enqueueSnackbar(
            `${payload.error} — nothing changed, the order is still open. Retrying is safe.`,
            { variant: 'error', allowDuplicate: true },
          )
        } else {
          // No JSON word from the handler (a gateway page, a proxy timeout):
          // whether the cancel landed is NOT known.
          enqueueSnackbar(
            `The cancel failed (${response.status}) and it is NOT known ` +
              'whether it landed. Reopen the order to check — retrying is ' +
              'safe, the server cancels once.',
            { variant: 'error', allowDuplicate: true },
          )
        }
        return
      }
      const units = Number(payload?.units ?? 0)
      enqueueSnackbar(
        payload?.alreadyCancelled
          ? 'Order was already cancelled'
          : units > 0
            ? `Order cancelled — ${units} ${units === 1 ? 'unit' : 'units'} returned to stock`
            : 'Order cancelled',
        { variant: 'success', persist: false },
      )
    } finally {
      setBusy(false)
    }
  }, [order, orderId, user, hostId, confirm, enqueueSnackbar])

  /**
   * Idempotency key for ONE refund attempt (AGL-1696), the same shape the POS
   * register uses for a sale (AGL-1691).
   *
   * Minted lazily so a retry of this attempt — a lost response, a second
   * click, the admin reopening the dialog after a timeout — reuses it and the
   * server replays instead of sending the money again. Retired on a definitive
   * answer, which makes the NEXT refund a new attempt: two partial refunds of
   * the same amount on the same order are two real refunds, and keying on the
   * order (or the amount) would silently swallow the second.
   *
   * NOT retired on a network failure or a 5xx — that is precisely the window
   * the key exists to cover.
   */
  const attemptKey = useRef('')
  useEffect(() => {
    attemptKey.current = ''
  }, [orderId])

  const handleRefund = useCallback(async () => {
    if (!order || !orderId) return
    const confirmed = await confirm({
      title: 'Refund this order?',
      description:
        `Refunds ${usd(
          (order.totals?.totalCents ?? order.amountCents ?? 0) -
            (order.refundedCents ?? 0),
        )} to the buyer through Stripe.` +
        // An open INQUIRY keeps this button live on purpose (AGL-1820):
        // Stripe names a full refund as the way to resolve one before it
        // escalates to a chargeback. Said here so the admin reads the refund
        // as the documented exit, not a risk taken against the badge.
        (CommerceModel.orderHasOpenDispute(order) &&
        !CommerceModel.orderDisputeBlocksRefund(order)
          ? ' An inquiry is open on this charge — a full refund resolves it' +
            ' before it can become a chargeback.'
          : ''),
      confirmationText: 'Refund',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    // `randomUUID` needs a secure context, which the console always is, but
    // fall back rather than throw on a refund.
    if (!attemptKey.current) {
      attemptKey.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attemptKey.current,
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, orderId }),
      })
      const payload = await response.json()
      // A definitive answer ends this attempt either way: the next refund is a
      // new one and must get a new key. A 5xx or a thrown fetch keeps the key,
      // so pressing Refund again dedupes rather than sends a second transfer.
      if (response.status < 500) attemptKey.current = ''
      if (!response.ok) {
        // A 409 is a guard REFUSING — the status machine, or the open-dispute
        // block (AGL-1809), whose body explains what to do instead — not the
        // refund machinery failing. The route wrote nothing, so it surfaces
        // verbatim as a warning, same as the cancel path's 409 (AGL-1818).
        enqueueSnackbar(payload?.error ?? 'Refund failed', {
          variant: response.status === 409 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      } else {
        enqueueSnackbar('Refund issued', { variant: 'success', persist: false })
      }
    } finally {
      setBusy(false)
    }
  }, [order, orderId, user, hostId, confirm, enqueueSnackbar])

  /**
   * Answer the restock question a reversal flagged (AGL-1806).
   *
   * The answer MOVES NO STOCK, which is AGL-1797's ledger argument and it is
   * binding: the products hub's "Adjust stock" is the one stock writer (it
   * writes the counts AND the `InventoryAdjustment` row the hub renders as
   * history), so "Restocked" here is clicked AFTER the merchant used it, and
   * "No restock" says the goods are not recoverable. Either answer only sets
   * the `resolution` triple `OrderRestockCheck` declares and says so on the
   * timeline.
   *
   * A TRANSACTION rather than the dialog's plain `write`, keyed on the
   * rendered `flaggedAtMs`, because an answer must land ONCE. The flag writer
   * re-asks an ANSWERED question after the next reversal, and the cancel
   * route (AGL-1808) answers an open one itself when it returns the stock —
   * so a stale dialog writing blind would either re-answer a settled question
   * or replace a brand-new one with a resolved copy of the old. The
   * transaction re-reads on the server (the web SDK will not run one from
   * cache — the products hub's `writeGuardedBySeed` refusal of unconfirmed
   * data, by other means) and refuses both cases with the truth: nothing was
   * written.
   */
  const handleRestockAnswer = useCallback(
    async (resolution: 'restocked' | 'dismissed') => {
      const check = order?.restockCheck
      if (!order || !orderId || !check || check.resolution) return
      setBusy(true)
      try {
        const reference = doc(firestore, 'hosts', hostId, 'orders', orderId)
        const verdict = await runTransaction(firestore, async (transaction) => {
          const snapshot = await transaction.get(reference)
          if (!snapshot.exists()) return 'gone'
          const current = CommerceModel.liftLegacyOrder(
            (snapshot.data() ?? {}) as never,
          )
          const fresh = current.restockCheck
          if (!fresh || fresh.resolution) return 'answered'
          if (fresh.flaggedAtMs !== check.flaggedAtMs) return 'changed'
          const resolvedAtMs = Date.now()
          const uid = String((user as any)?.uid ?? '')
          transaction.update(reference, {
            restockCheck: {
              ...fresh,
              resolution,
              resolvedAtMs,
              ...(uid ? { resolvedBy: uid } : {}),
            } satisfies CommerceModel.OrderRestockCheck,
            // The SERVER's timeline, not the dialog's — a note landed from
            // another tab must survive the append.
            timeline: CommerceModel.appendOrderEvent(
              current,
              'restock-check',
              resolution === 'restocked'
                ? 'answered — restocked'
                : 'answered — no restock',
              resolvedAtMs,
            ),
          })
          return 'recorded'
        })
        if (verdict === 'recorded') {
          enqueueSnackbar(
            resolution === 'restocked'
              ? 'Recorded as restocked'
              : 'Recorded — no restock',
            { variant: 'success', persist: false },
          )
        } else if (verdict === 'answered') {
          // The cancel route, or another admin, got there first.
          enqueueSnackbar(
            'This restock question was already answered — nothing changed.',
            { variant: 'info', persist: false },
          )
        } else if (verdict === 'changed') {
          // A later reversal re-asked; this dialog shows the OLD question.
          enqueueSnackbar(
            'The restock question changed while this dialog was open — ' +
              'nothing was written. Reopen the order to see the current one.',
            { variant: 'warning', allowDuplicate: true },
          )
        } else {
          enqueueSnackbar('This order no longer exists — nothing was written.', {
            variant: 'warning',
            allowDuplicate: true,
          })
        }
      } catch (error) {
        // A transaction is all-or-nothing, and a thrown one did not commit.
        console.error(error)
        enqueueSnackbar(
          'The answer was not recorded — it needs a live connection and the ' +
            'editor or admin role. Nothing changed; answering again is safe.',
          { variant: 'error', allowDuplicate: true },
        )
      } finally {
        setBusy(false)
      }
    },
    [order, orderId, firestore, hostId, user, enqueueSnackbar],
  )

  const handleNote = useCallback(async () => {
    if (!order || !note.trim()) return
    await write({
      timeline: CommerceModel.appendOrderEvent(order, 'note', note.trim().slice(0, 500)),
    })
    setNote('')
  }, [order, note, write])

  const handlePackingSlip = useCallback(() => {
    if (!order) return
    const win = window.open('', '_blank', 'width=600,height=800')
    if (!win) return
    const rows = (order.lineItems ?? [])
      .map(
        (line) =>
          `<tr><td>${line.quantity}×</td><td>${line.name}${
            line.variantLabel ? ` — ${line.variantLabel}` : ''
          }</td><td>${line.sku ?? ''}</td></tr>`,
      )
      .join('')
    const address = order.shippingAddress
    win.document.write(
      `<h2>Packing slip ${CommerceModel.formatOrderNumber(order, orderId)}</h2>` +
        (address
          ? `<p>${[address.name, address.line1, address.line2, `${address.city ?? ''} ${address.state ?? ''} ${address.postalCode ?? ''}`, address.country].filter(Boolean).join('<br/>')}</p>`
          : '') +
        `<table border="0" cellpadding="6">${rows}</table>`,
    )
    win.document.close()
    // Print from the opener, not from an injected inline script (AGL-523) —
    // the popup inherits this document's CSP, where an un-nonced inline
    // script is blocked under the enforcing policy. Same reasoning as the POS
    // receipt.
    win.focus()
    win.print()
  }, [order, orderId])

  if (!order) return null
  const totals = order.totals
  const can = (to: CommerceModel.OrderStatus) => CommerceModel.canTransitionOrder(order.status, to)
  // A lost chargeback leaves `status: 'refunded'` (AGL-1787), so the status
  // chip alone tells the merchant they chose this. The badge is the correction.
  const dispute = CommerceModel.describeOrderDispute(order)
  const reversal = CommerceModel.splitOrderReversal(order)
  // The restock question a reversal flagged, while it is still open
  // (AGL-1806). Absent `resolution` IS the open state — the writer only ever
  // re-flags an answered check (AGL-1797).
  const restock =
    order.restockCheck && !order.restockCheck.resolution
      ? order.restockCheck
      : null

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <span>{`Order ${CommerceModel.formatOrderNumber(order, orderId)}`}</span>
          <Chip
            label={order.status.replace('_', ' ')}
            size="small"
            color={STATUS_COLOR[order.status] ?? 'default'}
            variant="outlined"
          />
          {dispute ? (
            <Tooltip title={dispute.detail}>
              <Chip
                label={dispute.label}
                size="small"
                color={DISPUTE_COLOR[dispute.tone]}
                variant="filled"
              />
            </Tooltip>
          ) : null}
          {order.channel && order.channel !== 'online' ? (
            <Chip label={order.channel} size="small" variant="outlined" />
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {[order.customerName, order.customerEmail]
            .filter(Boolean)
            .join(' · ') || 'Guest buyer'}
        </Typography>
        {(order.lineItems ?? []).map((line, index) => (
          <Stack key={index} direction="row" spacing={1}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {`${line.quantity}× ${line.name}` +
                (line.variantLabel ? ` — ${line.variantLabel}` : '')}
            </Typography>
            <Typography variant="body2">
              {usd(line.unitAmountCents * line.quantity)}
            </Typography>
          </Stack>
        ))}
        {totals ? (
          <>
            <Divider />
            {(
              [
                ['Items', totals.itemsCents],
                ['Shipping', totals.shippingCents],
                ['Tax', totals.taxCents],
                ['Discount', -totals.discountCents],
                ['Total', totals.totalCents],
              ] as Array<[string, number]>
            ).map(([label, cents]) => (
              <Stack key={label} direction="row">
                <Typography
                  variant="body2"
                  sx={{ flex: 1 }}
                  color={label === 'Total' ? 'text.primary' : 'text.secondary'}
                >
                  {label}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: label === 'Total' ? 600 : 400 }}
                >
                  {`${cents < 0 ? '-' : ''}${usd(Math.abs(cents))}`}
                </Typography>
              </Stack>
            ))}
            {/*
              Both figures live in `refundedCents` (AGL-1787), so a lost
              chargeback used to render as "Refunded $62.00" — the merchant's
              own decision, spelled the same as money taken from them. Split by
              door, and show BOTH when a partial refund and a chargeback each
              took a piece.
             */}
            {reversal.refundedCents ? (
              <Typography variant="caption" color="error">
                {`Refunded ${usd(reversal.refundedCents)}`}
              </Typography>
            ) : null}
            {reversal.chargedBackCents ? (
              <Typography variant="caption" color="error">
                {`Charged back ${usd(reversal.chargedBackCents)}`}
              </Typography>
            ) : null}
          </>
        ) : null}
        {restock ? (
          <>
            <Divider />
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{'Restock check'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {`${restock.units} ${
                  restock.units === 1 ? 'unit' : 'units'
                } may need restocking after this ${
                  restock.kind === 'chargeback' ? 'chargeback' : 'refund'
                }.` +
                  // The chargeback default is NO, same as the timeline's
                  // wording: the shopper kept the item and took the money.
                  (restock.kind === 'chargeback'
                    ? ' The shopper kept the goods unless they actually came back.'
                    : '') +
                  // On a partial, no reversal records which lines it covered
                  // (AGL-1797), so the flagged units are the MOST it could be.
                  (restock.fullyReversed
                    ? ''
                    : ' Only part of the money came back, so these units are an upper bound — only you know which goods returned.')}
              </Typography>
              {restock.lines.map((line, index) => (
                <Typography key={index} variant="caption" color="text.secondary">
                  {`${line.quantity}× ${line.name ?? line.productId}` +
                    (line.variantLabel ? ` — ${line.variantLabel}` : '')}
                </Typography>
              ))}
              <Typography variant="caption" color="text.secondary">
                {'If goods came back, put them on the shelf with "Adjust ' +
                  'stock" in the products hub first — these answers move no ' +
                  'stock, they only clear this question.'}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => handleRestockAnswer('restocked')}
                >
                  {'Restocked'}
                </Button>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => handleRestockAnswer('dismissed')}
                >
                  {'No restock'}
                </Button>
              </Stack>
            </Stack>
          </>
        ) : null}
        <Divider />
        <Typography variant="subtitle2">{'Timeline'}</Typography>
        {(order.timeline ?? [])
          .slice()
          .reverse()
          .map((event, index) => (
            <Typography key={index} variant="caption" color="text.secondary">
              {`${new Date(event.atMs).toLocaleString()} — ${event.event}` +
                (event.detail ? `: ${event.detail}` : '')}
            </Typography>
          ))}
        <Stack direction="row" spacing={1}>
          <TextField
            label="Add note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          <Button size="small" disabled={!note.trim()} onClick={handleNote}>
            {'Add'}
          </Button>
        </Stack>
        {tracking ? (
          <Stack direction="row" spacing={1}>
            <TextField
              label="Carrier"
              value={tracking.carrier}
              onChange={(event) =>
                setTracking({ ...tracking, carrier: event.target.value })
              }
              size="small"
              sx={{ width: 140 }}
              placeholder="UPS"
            />
            <TextField
              label="Tracking number"
              value={tracking.number}
              onChange={(event) =>
                setTracking({ ...tracking, number: event.target.value })
              }
              size="small"
              sx={{ flex: 1 }}
            />
            <Button size="small" variant="contained" color="primary" onClick={handleFulfill}>
              {'Fulfill'}
            </Button>
          </Stack>
        ) : null}
        {order.paymentLinkUrl && order.status === 'pending' ? (
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => {
              navigator.clipboard.writeText(String(order.paymentLinkUrl))
              enqueueSnackbar('Payment link copied', {
                variant: 'success',
                persist: false,
              })
            }}
          >
            {'Copy payment link'}
          </Button>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handlePackingSlip}>{'Packing slip'}</Button>
        {can('cancelled') ? (
          <Button color="error" disabled={busy} onClick={handleCancel}>
            {'Cancel order'}
          </Button>
        ) : null}
        {can('refunded') ? (
          // Disabled on `orderDisputeBlocksRefund`, NOT the badge's broader
          // `orderHasOpenDispute` (AGL-1820): a formal open dispute means the
          // bank already pulled the funds and the route answers 409
          // (AGL-1809), while an open INQUIRY shows the badge but must keep
          // this button live — a full refund is how an inquiry is resolved.
          CommerceModel.orderDisputeBlocksRefund(order) ? (
            <Tooltip
              title={
                'A chargeback is open on this order, and refunding would not' +
                ' withdraw it — the bank has already taken the disputed' +
                ' amount, so a refund on top would pay the shopper twice.' +
                ' Respond to the dispute or accept it in the Stripe' +
                ' dashboard; refund any remainder once it settles.'
              }
            >
              {/* A disabled button fires no pointer events; the wrapper
                  carries the hover for the tooltip. */}
              <span>
                <Button color="error" disabled>
                  {'Refund'}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button color="error" disabled={busy} onClick={handleRefund}>
              {'Refund'}
            </Button>
          )
        ) : null}
        {(can('fulfilled') || can('partially_fulfilled')) && !tracking ? (
          <Button
            variant="contained"
            color="primary"
            onClick={() => setTracking({ carrier: '', number: '' })}
          >
            {'Fulfill…'}
          </Button>
        ) : null}
        {can('delivered') ? (
          <Button
            onClick={() =>
              write({
                status: 'delivered',
                timeline: CommerceModel.appendOrderEvent(order, 'delivered'),
              })
            }
          >
            {'Mark delivered'}
          </Button>
        ) : null}
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}
OrderDetailDialog.displayName = 'OrderDetailDialog'

export default OrderDetailDialog
