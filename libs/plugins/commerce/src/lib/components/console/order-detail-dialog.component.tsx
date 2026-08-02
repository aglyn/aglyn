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
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
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

  const handleCancel = useCallback(async () => {
    if (!order) return
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
    await write({
      status: 'cancelled',
      timeline: CommerceModel.appendOrderEvent(order, 'cancelled'),
    })
  }, [order, confirm, write])

  const handleRefund = useCallback(async () => {
    if (!order || !orderId) return
    const confirmed = await confirm({
      title: 'Refund this order?',
      description: `Refunds ${usd(
        (order.totals?.totalCents ?? order.amountCents ?? 0) -
          (order.refundedCents ?? 0),
      )} to the buyer through Stripe.`,
      confirmationText: 'Refund',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, orderId }),
      })
      const payload = await response.json()
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Refund failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } else {
        enqueueSnackbar('Refund issued', { variant: 'success', persist: false })
      }
    } finally {
      setBusy(false)
    }
  }, [order, orderId, user, hostId, confirm, enqueueSnackbar])

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
            {order.refundedCents ? (
              <Typography variant="caption" color="error">
                {`Refunded ${usd(order.refundedCents)}`}
              </Typography>
            ) : null}
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
            <Button size="small" variant="contained" color="secondary" onClick={handleFulfill}>
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
          <Button color="error" onClick={handleCancel}>
            {'Cancel order'}
          </Button>
        ) : null}
        {can('refunded') ? (
          <Button color="error" disabled={busy} onClick={handleRefund}>
            {'Refund'}
          </Button>
        ) : null}
        {(can('fulfilled') || can('partially_fulfilled')) && !tracking ? (
          <Button
            variant="contained"
            color="secondary"
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
