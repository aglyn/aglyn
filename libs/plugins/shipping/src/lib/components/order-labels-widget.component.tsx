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

import type { PluginShippingAddress, PluginShippingAddressCheck } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import type { ShippingHostSettings } from '../model/shipping-settings'
import { TRACKING_STATUS_LABELS } from '../model/tracking-status'
import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { formatCents, newAttemptKey, useShippingAvailability, useShippingFetch } from './shipping-api'

/**
 * The props the commerce plugin's `orderDetail` zone hands a widget, restated
 * here — a plugin never imports another — down to the fields this widget
 * reads.
 */
export interface OrderLabelsWidgetProps {
  hostId: string
  orgId?: string
  order: {
    id: string
    number: string
    status: string
    currency: string
    shippingAddress: {
      name: string | null
      line1: string | null
      line2: string | null
      city: string | null
      state: string | null
      postalCode: string | null
      country: string | null
      phone: string | null
    } | null
    lines: ReadonlyArray<{
      lineItemId: number
      name: string
      quantity: number
      fulfilledQuantity: number
      remainingQuantity: number
      requiresShipping: boolean
    }>
  }
}

export interface PublicRate {
  rateId: string
  serviceKey: string
  carrier: string
  label: string
  amountCents: number
  currency: string
  estimatedDays: number | null
  badges: Array<'cheapest' | 'fastest' | 'best_value'>
  merchantCarrierAccount: boolean
}

export interface PublicLabel {
  labelId: string
  kind: 'outbound' | 'return'
  status: string
  carrier: string | null
  serviceLabel: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  trackingStatus: PluginTrackingStatus | null
  labelUrl: string | null
  commercialInvoiceUrl: string | null
  costCents: number
  chargeCents: number
  currency: string
  billingMethod: string | null
  billingState: string | null
  billingFailure: string | null
  recordShipmentRefusal: string | null
  createdAtMs: number
}

const BADGE_LABELS = { cheapest: 'Cheapest', fastest: 'Fastest', best_value: 'Best value' } as const

const STATUS_LABELS: Record<string, string> = {
  purchased: 'Label bought',
  purchasing: 'Buying…',
  failed: 'Failed',
  void_pending: 'Refund pending',
  voided: 'Voided',
  void_rejected: 'Void refused',
}

/** Opens a label to print, in a tab of its own. */
export function openLabel(url: string | null): void {
  if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

function toAddress(address: OrderLabelsWidgetProps['order']['shippingAddress']): PluginShippingAddress | null {
  if (!address?.country) return null
  return {
    country: address.country,
    ...(address.name ? { name: address.name } : {}),
    ...(address.line1 ? { line1: address.line1 } : {}),
    ...(address.line2 ? { line2: address.line2 } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address.phone ? { phone: address.phone } : {}),
  }
}

/**
 * SHIPPING LABELS ON AN ORDER (AGL-3612), in the order dialog's
 * `orderDetail` zone: the order's labels with print, tracking and void, and
 * Buy label — pick the box, the units and a rate, and the label is bought,
 * written onto the order as a shipment and followed for tracking, all on
 * the server. A return label works the same way the other way round.
 */
export function OrderLabelsWidget(props: OrderLabelsWidgetProps) {
  const { hostId, order } = props
  const availability = useShippingAvailability(hostId)
  const request = useShippingFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [labels, setLabels] = useState<PublicLabel[]>([])
  const [dialog, setDialog] = useState<null | 'outbound' | 'return'>(null)

  const loadLabels = useCallback(async () => {
    try {
      const answer = await request<{ labels: PublicLabel[] }>(SHIPPING_API_ROUTES.labels, {
        query: { hostId, recordId: order.id },
      })
      setLabels(answer.labels)
    } catch {
      setLabels([])
    }
  }, [hostId, order.id, request])

  useEffect(() => {
    if (availability.available) void loadLabels()
  }, [availability.available, loadLabels])

  const shippable = order.lines.some((line) => line.requiresShipping && line.remainingQuantity > 0)
  const returnable = order.lines.some((line) => line.requiresShipping && line.fulfilledQuantity > 0)

  const handleVoid = async (label: PublicLabel) => {
    try {
      await request(SHIPPING_API_ROUTES.labelsVoid, { body: { hostId, labelId: label.labelId } })
      enqueueSnackbar('Void requested', { variant: 'success' })
      await loadLabels()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    }
  }

  if (!availability.available) return null

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {'Shipping labels'}
        </Typography>
        {returnable ? <Button onClick={() => setDialog('return')}>{'Return label'}</Button> : null}
        <Button variant="contained" disabled={!shippable || !order.shippingAddress} onClick={() => setDialog('outbound')}>
          {'Buy label'}
        </Button>
      </Stack>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {labels.map((label) => (
          <Stack key={label.labelId} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Chip size="small" label={STATUS_LABELS[label.status] ?? label.status} />
            {label.kind === 'return' ? <Chip size="small" variant="outlined" label="Return" /> : null}
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
              {[label.serviceLabel, label.trackingNumber].filter(Boolean).join(' · ')}
              {label.trackingStatus ? ` · ${TRACKING_STATUS_LABELS[label.trackingStatus]}` : ''}
            </Typography>
            <Typography variant="body2">{formatCents(label.chargeCents || label.costCents, label.currency)}</Typography>
            {label.labelUrl && label.status === 'purchased' ? (
              <Button size="small" onClick={() => openLabel(label.labelUrl)}>
                {'Print'}
              </Button>
            ) : null}
            {label.commercialInvoiceUrl && label.status === 'purchased' ? (
              <Button size="small" onClick={() => openLabel(label.commercialInvoiceUrl)}>
                {'Customs invoice'}
              </Button>
            ) : null}
            {label.status === 'purchased' || label.status === 'void_rejected' ? (
              <Button size="small" color="error" onClick={() => handleVoid(label)}>
                {'Void'}
              </Button>
            ) : null}
            {label.recordShipmentRefusal ? (
              <Alert severity="warning" sx={{ width: '100%' }}>
                {`The label was bought but the order was not updated: ${label.recordShipmentRefusal}.`}
              </Alert>
            ) : null}
            {label.billingFailure ? (
              <Alert severity="info" sx={{ width: '100%' }}>
                {`The label’s cost will be on your next invoice: ${label.billingFailure}`}
              </Alert>
            ) : null}
          </Stack>
        ))}
      </Stack>
      {dialog ? (
        <BuyLabelDialog
          hostId={hostId}
          order={order}
          kind={dialog}
          onClose={() => setDialog(null)}
          onBought={async (label) => {
            setDialog(null)
            enqueueSnackbar('Label bought', { variant: 'success' })
            openLabel(label.labelUrl)
            await loadLabels()
          }}
        />
      ) : null}
    </Box>
  )
}
OrderLabelsWidget.displayName = 'OrderLabelsWidget'

interface BuyLabelDialogProps {
  hostId: string
  order: OrderLabelsWidgetProps['order']
  kind: 'outbound' | 'return'
  onClose: () => void
  onBought: (label: PublicLabel) => void | Promise<void>
}

/** Pick a box, the units and a rate, then buy. */
export function BuyLabelDialog(props: BuyLabelDialogProps) {
  const { hostId, order, kind, onClose, onBought } = props
  const request = useShippingFetch()
  const [settings, setSettings] = useState<ShippingHostSettings | null>(null)
  const [presetId, setPresetId] = useState<string>('')
  const [custom, setCustom] = useState({ lengthCm: '', widthCm: '', heightCm: '' })
  const [weight, setWeight] = useState('')
  const [quantities, setQuantities] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      order.lines
        .filter((line) => line.requiresShipping)
        .map((line) => [line.lineItemId, kind === 'return' ? line.fulfilledQuantity : line.remainingQuantity]),
    ),
  )
  const [quote, setQuote] = useState<{ shipmentId: string; rates: PublicRate[]; messages: string[]; weightGrams: number } | null>(null)
  const [rateId, setRateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState<PluginShippingAddressCheck | null>(null)
  const [shipTo, setShipTo] = useState<PluginShippingAddress | null>(null)
  const [attemptKey, setAttemptKey] = useState(() => newAttemptKey())

  useEffect(() => {
    let live = true
    request<{ settings: ShippingHostSettings }>(SHIPPING_API_ROUTES.settings, { query: { hostId } })
      .then((answer) => {
        if (!live) return
        setSettings(answer.settings)
        setPresetId(answer.settings.defaultPackageId ?? answer.settings.packages[0]?.id ?? '')
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [hostId, request])

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .map(([lineIndex, quantity]) => ({ lineIndex: Number(lineIndex), quantity }))
        .filter((line) => line.quantity > 0),
    [quantities],
  )

  const handleRates = async () => {
    setBusy(true)
    setError(null)
    setQuote(null)
    setRateId('')
    try {
      const answer = await request<{ shipmentId: string; rates: PublicRate[]; messages: string[]; weightGrams: number }>(
        SHIPPING_API_ROUTES.rates,
        {
          body: {
            hostId,
            recordId: order.id,
            kind,
            lines,
            package:
              presetId === 'custom'
                ? {
                    lengthCm: Number(custom.lengthCm),
                    widthCm: Number(custom.widthCm),
                    heightCm: Number(custom.heightCm),
                    ...(Number(weight) > 0 ? { weightGrams: Number(weight) } : {}),
                  }
                : { presetId, ...(Number(weight) > 0 ? { weightGrams: Number(weight) } : {}) },
            ...(shipTo ? { shipTo } : {}),
          },
        },
      )
      setQuote(answer)
      if (!weight) setWeight(String(answer.weightGrams))
      const cheapest = answer.rates.find((rate) => rate.badges.includes('cheapest')) ?? answer.rates[0]
      if (cheapest) setRateId(cheapest.rateId)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleCheck = async () => {
    setBusy(true)
    try {
      const answer = await request<{ check: PluginShippingAddressCheck }>(SHIPPING_API_ROUTES.addressValidate, {
        body: { hostId, recordId: order.id, ...(shipTo ? { address: shipTo } : {}) },
      })
      setCheck(answer.check)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleBuy = async () => {
    if (!quote || !rateId) return
    setBusy(true)
    setError(null)
    try {
      const answer = await request<{ label: PublicLabel }>(SHIPPING_API_ROUTES.labelsBuy, {
        body: { hostId, recordId: order.id, shipmentId: quote.shipmentId, rateId, attemptKey },
      })
      setAttemptKey(newAttemptKey())
      await onBought(answer.label)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const original = toAddress(order.shippingAddress)

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{kind === 'return' ? `Return label for ${order.number}` : `Shipping label for ${order.number}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {kind === 'outbound' && original ? (
            <Stack spacing={1}>
              <Typography variant="body2">
                {[shipTo?.line1 ?? original.line1, shipTo?.city ?? original.city, shipTo?.state ?? original.state, shipTo?.postalCode ?? original.postalCode, original.country]
                  .filter(Boolean)
                  .join(', ')}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={handleCheck} disabled={busy}>
                  {'Check address'}
                </Button>
              </Stack>
              {check?.verdict === 'valid' ? <Alert severity="success">{'The carrier can deliver to this address.'}</Alert> : null}
              {check?.verdict === 'invalid' ? (
                <Alert severity="error">{check.messages.join(' ') || 'The carrier cannot deliver to this address.'}</Alert>
              ) : null}
              {check?.verdict === 'corrected' && check.suggested ? (
                <Alert
                  severity="warning"
                  action={
                    <Button
                      size="small"
                      onClick={() => {
                        setShipTo(check.suggested ?? null)
                        setCheck(null)
                        setQuote(null)
                      }}
                    >
                      {'Use this'}
                    </Button>
                  }
                >
                  {`The carrier suggests: ${[check.suggested.line1, check.suggested.city, check.suggested.state, check.suggested.postalCode]
                    .filter(Boolean)
                    .join(', ')}`}
                </Alert>
              ) : null}
            </Stack>
          ) : null}
          <Stack spacing={1}>
            <Typography variant="subtitle2">{kind === 'return' ? 'Units coming back' : 'Units in this parcel'}</Typography>
            {order.lines
              .filter((line) => line.requiresShipping)
              .map((line) => {
                const most = kind === 'return' ? line.fulfilledQuantity : line.remainingQuantity
                return (
                  <Stack key={line.lineItemId} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {line.name}
                    </Typography>
                    <TextField
                      type="number"
                      size="small"
                      label={`of ${most}`}
                      value={quantities[line.lineItemId] ?? 0}
                      onChange={(event) =>
                        setQuantities({
                          ...quantities,
                          [line.lineItemId]: Math.max(0, Math.min(most, Math.floor(Number(event.target.value) || 0))),
                        })
                      }
                      sx={{ width: 96 }}
                    />
                  </Stack>
                )
              })}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              select
              label="Box"
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
              sx={{ flex: 2 }}
            >
              {(settings?.packages ?? []).map((box) => (
                <MenuItem key={box.id} value={box.id}>
                  {`${box.name} (${box.lengthCm} × ${box.widthCm} × ${box.heightCm} cm)`}
                </MenuItem>
              ))}
              <MenuItem value="custom">{'Another size'}</MenuItem>
            </TextField>
            <TextField
              type="number"
              label="Weight (g)"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              helperText="Summed from the products; change it to the scale’s reading."
              sx={{ flex: 1 }}
            />
          </Stack>
          {presetId === 'custom' ? (
            <Stack direction="row" spacing={1}>
              {(['lengthCm', 'widthCm', 'heightCm'] as const).map((side) => (
                <TextField
                  key={side}
                  type="number"
                  label={side === 'lengthCm' ? 'Length (cm)' : side === 'widthCm' ? 'Width (cm)' : 'Height (cm)'}
                  value={custom[side]}
                  onChange={(event) => setCustom({ ...custom, [side]: event.target.value })}
                />
              ))}
            </Stack>
          ) : null}
          <Stack direction="row">
            <Button onClick={handleRates} disabled={busy || !lines.length}>
              {quote ? 'Get rates again' : 'Get rates'}
            </Button>
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {quote ? (
            quote.rates.length ? (
              <RadioGroup value={rateId} onChange={(event) => setRateId(event.target.value)}>
                {quote.rates.map((rate) => (
                  <FormControlLabel
                    key={rate.rateId}
                    value={rate.rateId}
                    control={<Radio />}
                    label={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2">{rate.label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 'fontWeightBold' }}>
                          {formatCents(rate.amountCents, rate.currency)}
                        </Typography>
                        {rate.estimatedDays !== null ? (
                          <Typography variant="body2" color="text.secondary">
                            {`${rate.estimatedDays} day${rate.estimatedDays === 1 ? '' : 's'}`}
                          </Typography>
                        ) : null}
                        {rate.badges.map((badge) => (
                          <Chip key={badge} size="small" color="primary" variant="outlined" label={BADGE_LABELS[badge]} />
                        ))}
                        {rate.merchantCarrierAccount ? <Chip size="small" label="Your account" /> : null}
                      </Stack>
                    }
                  />
                ))}
              </RadioGroup>
            ) : (
              <Alert severity="warning">{quote.messages[0] ?? 'No carrier quoted this parcel.'}</Alert>
            )
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" onClick={handleBuy} disabled={busy || !quote || !rateId}>
          {busy ? 'Working…' : 'Buy label'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default OrderLabelsWidget
