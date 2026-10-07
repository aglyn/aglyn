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
import {
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type {
  ConsoleFulfillmentTracking,
  ConsoleOrderZoneAddress,
  ConsoleOrderZoneFulfillment,
  ConsoleOrderZoneOrder,
} from './order-zones'

/**
 * The order dialog's fulfillment surfaces (AGL-3611): the Fulfill items panel,
 * with a quantity per line, a carrier, a tracking number and the notify
 * switch; and the list of recorded shipments, each editable and cancellable.
 *
 * Neither writes. Every act goes through the dialog's `fulfill-order` route,
 * which re-checks the quantities and the transition under the write; these
 * only collect what the merchant means and hand it up.
 */

/** The carrier select's value for a carrier typed by hand. */
const OTHER_CARRIER = 'other'

/** What the panel asks the dialog to record. */
export interface FulfillItemsSubmission {
  /** Absent when the picked units are everything still to ship. */
  lineItems?: Array<{ lineItemId: number; quantity: number }>
  carrier: string
  trackingNumber: string
  trackingUrl?: string
  labelUrl?: string
  notify: boolean
}

/** The order a widget reads: the dialog's order in the zone's words. */
export function consoleOrderZoneOrder(
  order: CommerceModel.HostOrder,
  orderId: string,
): ConsoleOrderZoneOrder {
  const states = CommerceModel.orderLineFulfillmentStates(order)
  const address = order.shippingAddress
  const shippingAddress: ConsoleOrderZoneAddress | null = address
    ? {
        name: address.name ?? null,
        line1: address.line1 ?? null,
        line2: address.line2 ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        postalCode: address.postalCode ?? null,
        country: address.country ?? null,
        phone: address.phone ?? null,
      }
    : null
  return {
    id: orderId,
    number: CommerceModel.formatOrderNumber(order, orderId),
    status: order.status,
    channel: order.channel ?? 'online',
    // Orders are charged in US dollars today, as the public API reports them.
    currency: 'USD',
    customerEmail: order.customerEmail ?? null,
    customerName: order.customerName ?? null,
    shippingAddress,
    lines: (order.lineItems ?? []).map((line, index) => ({
      lineItemId: index,
      productId: line.productId,
      variantId: line.variantId ?? null,
      name: line.name,
      variantLabel: line.variantLabel ?? null,
      sku: line.sku ?? null,
      productType: line.productType ?? null,
      quantity: states[index]?.quantity ?? 0,
      unitAmountCents: line.unitAmountCents,
      fulfilledQuantity: states[index]?.fulfilledQuantity ?? 0,
      remainingQuantity: states[index]?.remainingQuantity ?? 0,
      requiresShipping: states[index]?.requiresShipping ?? true,
    })),
    fulfillments: (order.fulfillments ?? []).map((entry) => toZoneFulfillment(order, entry)),
    totals: {
      itemsCents: order.totals?.itemsCents ?? 0,
      shippingCents: order.totals?.shippingCents ?? 0,
      taxCents: order.totals?.taxCents ?? 0,
      discountCents: order.totals?.discountCents ?? 0,
      totalCents: order.totals?.totalCents ?? Number(order.amountCents ?? 0),
    },
    testMode: CommerceModel.orderIsTestMode(order),
  }
}

/** One recorded shipment in the zone's words. */
export function toZoneFulfillment(
  order: Pick<CommerceModel.HostOrder, 'lineItems'>,
  entry: CommerceModel.OrderFulfillment,
): ConsoleOrderZoneFulfillment {
  return {
    id: entry.id,
    lines: CommerceModel.fulfillmentLineQuantities(order, entry),
    carrier: entry.carrier ?? null,
    trackingNumber: entry.trackingNumber ?? null,
    trackingUrl: CommerceModel.fulfillmentTrackingUrl(entry),
    labelUrl: entry.labelUrl ?? null,
    status: CommerceModel.fulfillmentIsActive(entry) ? 'active' : 'cancelled',
    atMs: entry.atMs,
  }
}

/** The select's value for a typed carrier: a known name, or Other. */
function carrierChoiceFor(carrier: string): string {
  if (!carrier) return ''
  const label = CommerceModel.carrierLabelFor(carrier)
  return CommerceModel.FULFILLMENT_CARRIER_CHOICES.includes(label) ? label : OTHER_CARRIER
}

interface CarrierFieldsProps {
  carrier: string
  trackingNumber: string
  trackingUrl: string
  onChange: (patch: { carrier?: string; trackingNumber?: string; trackingUrl?: string }) => void
}

/**
 * Carrier, tracking number and, for a carrier without a known tracker, the
 * link. A native select so the choice is one keystroke and one change event.
 */
function CarrierFields(props: CarrierFieldsProps) {
  const { carrier, trackingNumber, trackingUrl, onChange } = props
  const [other, setOther] = useState(() => carrierChoiceFor(carrier) === OTHER_CARRIER)
  const choice = other ? OTHER_CARRIER : carrierChoiceFor(carrier)
  const derived = CommerceModel.trackingUrlFor(carrier, trackingNumber)
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        <TextField
          select
          label="Carrier"
          value={choice}
          onChange={(event) => {
            const value = event.target.value
            setOther(value === OTHER_CARRIER)
            onChange({ carrier: value === OTHER_CARRIER ? '' : value })
          }}
          size="small"
          sx={{ width: 160 }}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          <option value="">{'None'}</option>
          {CommerceModel.FULFILLMENT_CARRIER_CHOICES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={OTHER_CARRIER}>{'Other'}</option>
        </TextField>
        {other ? (
          <TextField
            label="Carrier name"
            value={carrier}
            onChange={(event) => onChange({ carrier: event.target.value })}
            size="small"
            sx={{ width: 160 }}
          />
        ) : null}
        <TextField
          label="Tracking number"
          value={trackingNumber}
          onChange={(event) => onChange({ trackingNumber: event.target.value })}
          size="small"
          sx={{ flex: 1 }}
        />
      </Stack>
      {trackingNumber && !derived ? (
        <TextField
          label="Tracking link"
          value={trackingUrl}
          onChange={(event) => onChange({ trackingUrl: event.target.value })}
          size="small"
          placeholder="https://"
          helperText="Optional. USPS, UPS, FedEx, DHL, Canada Post, Royal Mail and Australia Post get a link on their own."
        />
      ) : null}
    </Stack>
  )
}

export interface FulfillItemsPanelProps {
  order: CommerceModel.HostOrder
  busy: boolean
  onSubmit: (submission: FulfillItemsSubmission) => Promise<boolean>
  onCancel: () => void
  /** Draws the `orderFulfillment` zone with the panel's current selection. */
  renderZone?: (
    selection: ReadonlyArray<{ lineItemId: number; quantity: number }>,
    applyTracking: (tracking: ConsoleFulfillmentTracking) => void,
  ) => ReactNode
}

/**
 * Fulfill items: one quantity per line, starting at what is left of each
 * shippable line, so the common case — ship everything — is one click.
 */
export function FulfillItemsPanel(props: FulfillItemsPanelProps) {
  const { order, busy, onSubmit, onCancel, renderZone } = props
  const states = useMemo(() => CommerceModel.orderLineFulfillmentStates(order), [order])
  const [quantities, setQuantities] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      states.map((state) => [
        state.lineItemId,
        // Digital and service lines start at zero: nothing to ship. When the
        // order has nothing physical left, they start full instead, so the
        // panel still closes a digital-only order in one click.
        states.some((candidate) => candidate.requiresShipping && candidate.remainingQuantity > 0)
          ? state.requiresShipping
            ? state.remainingQuantity
            : 0
          : state.remainingQuantity,
      ]),
    ),
  )
  const [tracking, setTracking] = useState({ carrier: '', trackingNumber: '', trackingUrl: '', labelUrl: '' })
  const [notify, setNotify] = useState(true)
  const [zoneKey, setZoneKey] = useState(0)

  const selection = useMemo(
    () =>
      states
        .map((state) => ({ lineItemId: state.lineItemId, quantity: quantities[state.lineItemId] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
    [states, quantities],
  )
  const everything = useMemo(() => {
    const remaining = CommerceModel.remainingFulfillmentLines(order)
    return (
      remaining.length > 0 &&
      remaining.length === selection.length &&
      remaining.every(
        (entry, index) =>
          selection[index]?.lineItemId === entry.lineItemId && selection[index]?.quantity === entry.quantity,
      )
    )
  }, [order, selection])

  const setQuantity = (lineItemId: number, value: number, max: number) =>
    setQuantities((current) => ({
      ...current,
      [lineItemId]: Math.max(0, Math.min(max, Math.floor(Number.isFinite(value) ? value : 0))),
    }))

  const applyTracking = useCallback((next: ConsoleFulfillmentTracking) => {
    setTracking({
      carrier: String(next.carrier ?? ''),
      trackingNumber: String(next.trackingNumber ?? ''),
      trackingUrl: String(next.trackingUrl ?? ''),
      labelUrl: String(next.labelUrl ?? ''),
    })
    // The carrier select reads its Other state once; a remount re-reads it.
    setZoneKey((key) => key + 1)
  }, [])

  const submit = async () => {
    await onSubmit({
      ...(everything ? {} : { lineItems: selection }),
      carrier: tracking.carrier.trim(),
      trackingNumber: tracking.trackingNumber.trim(),
      ...(tracking.trackingUrl.trim() ? { trackingUrl: tracking.trackingUrl.trim() } : {}),
      ...(tracking.labelUrl ? { labelUrl: tracking.labelUrl } : {}),
      notify,
    })
  }

  return (
    <Stack spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Typography variant="subtitle2">{'Fulfill items'}</Typography>
      {(order.lineItems ?? []).map((line, index) => {
        const state = states[index]
        if (!state || state.remainingQuantity === 0) return null
        return (
          <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {line.name + (line.variantLabel ? ` — ${line.variantLabel}` : '')}
              {state.requiresShipping ? null : (
                <Typography component="span" variant="caption" color="text.secondary">
                  {' · no shipping needed'}
                </Typography>
              )}
            </Typography>
            <IconButton
              size="small"
              aria-label={`One fewer ${line.name}`}
              disabled={busy || (quantities[index] ?? 0) <= 0}
              onClick={() => setQuantity(index, (quantities[index] ?? 0) - 1, state.remainingQuantity)}
            >
              {'−'}
            </IconButton>
            <TextField
              size="small"
              type="number"
              value={quantities[index] ?? 0}
              onChange={(event) => setQuantity(index, Number(event.target.value), state.remainingQuantity)}
              sx={{ width: 72 }}
              slotProps={{
                htmlInput: {
                  min: 0,
                  max: state.remainingQuantity,
                  'aria-label': `Quantity of ${line.name} to fulfill`,
                },
              }}
            />
            <IconButton
              size="small"
              aria-label={`One more ${line.name}`}
              disabled={busy || (quantities[index] ?? 0) >= state.remainingQuantity}
              onClick={() => setQuantity(index, (quantities[index] ?? 0) + 1, state.remainingQuantity)}
            >
              {'+'}
            </IconButton>
            <Typography variant="caption" color="text.secondary" sx={{ width: 56 }}>
              {`of ${state.remainingQuantity}`}
            </Typography>
          </Stack>
        )
      })}
      <CarrierFields
        key={zoneKey}
        carrier={tracking.carrier}
        trackingNumber={tracking.trackingNumber}
        trackingUrl={tracking.trackingUrl}
        onChange={(patch) => setTracking((current) => ({ ...current, ...patch }))}
      />
      {tracking.labelUrl ? (
        <Link href={tracking.labelUrl} target="_blank" rel="noopener noreferrer" variant="caption">
          {'Shipping label'}
        </Link>
      ) : null}
      {renderZone ? renderZone(selection, applyTracking) : null}
      <FormControlLabel
        control={<Checkbox checked={notify} onChange={(event) => setNotify(event.target.checked)} />}
        label="Notify customer"
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button size="small" onClick={onCancel} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color="primary"
          disabled={busy || selection.length === 0}
          onClick={submit}
        >
          {'Fulfill'}
        </Button>
      </Stack>
    </Stack>
  )
}

export interface FulfillmentListProps {
  order: CommerceModel.HostOrder
  busy: boolean
  onUpdateTracking: (
    fulfillmentId: string,
    tracking: { carrier: string; trackingNumber: string; trackingUrl?: string },
  ) => Promise<boolean>
  onCancelFulfillment: (fulfillmentId: string) => Promise<void>
}

/** The shipments recorded on the order, newest last, with edit and cancel. */
export function FulfillmentList(props: FulfillmentListProps) {
  const { order, busy, onUpdateTracking, onCancelFulfillment } = props
  const [editing, setEditing] = useState<{
    id: string
    carrier: string
    trackingNumber: string
    trackingUrl: string
  } | null>(null)
  const fulfillments = order.fulfillments ?? []
  if (fulfillments.length === 0) return null
  const editable = CommerceModel.orderFulfillmentsEditable(order)
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{'Shipments'}</Typography>
      {fulfillments.map((entry) => {
        const active = CommerceModel.fulfillmentIsActive(entry)
        const lines = CommerceModel.fulfillmentLineQuantities(order, entry)
        const url = CommerceModel.fulfillmentTrackingUrl(entry)
        const carrier = entry.carrier ? CommerceModel.carrierLabelFor(entry.carrier) : ''
        return (
          <Stack key={entry.id} spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography
                variant="body2"
                sx={{ flex: 1, ...(active ? {} : { textDecoration: 'line-through' }) }}
                color={active ? 'text.primary' : 'text.secondary'}
              >
                {CommerceModel.describeFulfillmentLines(order, lines) || 'Fulfilled'}
              </Typography>
              {active ? null : <Chip label="canceled" size="small" variant="outlined" />}
              {active && editable && editing?.id !== entry.id ? (
                <>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        id: entry.id,
                        carrier: entry.carrier ?? '',
                        trackingNumber: entry.trackingNumber ?? '',
                        trackingUrl: entry.trackingUrl ?? '',
                      })
                    }
                  >
                    {'Edit tracking'}
                  </Button>
                  <Button size="small" color="error" disabled={busy} onClick={() => onCancelFulfillment(entry.id)}>
                    {'Cancel shipment'}
                  </Button>
                </>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {`${new Date(entry.atMs).toLocaleString()}`}
              {entry.trackingNumber ? ` · ${carrier || 'Tracking'} ` : ''}
              {entry.trackingNumber ? (
                url ? (
                  <Link href={url} target="_blank" rel="noopener noreferrer">
                    {entry.trackingNumber}
                  </Link>
                ) : (
                  entry.trackingNumber
                )
              ) : null}
              {entry.labelUrl ? (
                <>
                  {' · '}
                  <Link href={entry.labelUrl} target="_blank" rel="noopener noreferrer">
                    {'Label'}
                  </Link>
                </>
              ) : null}
            </Typography>
            {editing?.id === entry.id ? (
              <Stack spacing={1}>
                <CarrierFields
                  carrier={editing.carrier}
                  trackingNumber={editing.trackingNumber}
                  trackingUrl={editing.trackingUrl}
                  onChange={(patch) => setEditing({ ...editing, ...patch })}
                />
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button size="small" disabled={busy} onClick={() => setEditing(null)}>
                    {'Discard'}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy}
                    onClick={async () => {
                      const saved = await onUpdateTracking(entry.id, {
                        carrier: editing.carrier.trim(),
                        trackingNumber: editing.trackingNumber.trim(),
                        ...(editing.trackingUrl.trim() ? { trackingUrl: editing.trackingUrl.trim() } : {}),
                      })
                      if (saved) setEditing(null)
                    }}
                  >
                    {'Save tracking'}
                  </Button>
                </Stack>
              </Stack>
            ) : null}
          </Stack>
        )
      })}
    </Stack>
  )
}
