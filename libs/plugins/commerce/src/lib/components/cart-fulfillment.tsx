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

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PickupLocationOption } from '../model/local-fulfillment-settings'
import { pickupReadyWithinLabel } from '../model/local-fulfillment-settings'

/**
 * How the shopper receives the order (AGL-3624): shipped, picked up at one of
 * the store's locations, or brought by the store's own driver. Asked at the
 * cart because that is where the store still decides what the checkout
 * offers; `POST /api/commerce/local-fulfillment-options` answers what this
 * store and this basket can have, and the checkout decides the fee, the
 * minimum and the window again from the store's settings — nothing shown
 * here is trusted.
 *
 * A store with no pickup location and no local delivery gets an empty answer
 * and draws nothing: its cart is exactly what it was.
 */

export interface CartDeliveryWindow {
  id: string
  startMs: number
  endMs: number
  label: string
}

export interface CartDeliveryQuote {
  zoneId?: string
  zoneName?: string
  feeCents?: number
  minimumCents?: number
  freeOverCents?: number
  shortfallCents?: number
  unavailable?: string
}

export interface CartFulfillmentOptions {
  pickup: PickupLocationOption[]
  delivery: {
    country: string
    instructions?: string
    needsAddress: boolean
    windows: CartDeliveryWindow[]
    quote?: CartDeliveryQuote
  } | null
  /** Whether the store can text the buyer about the pickup or delivery. */
  texts?: boolean
}

export type CartFulfillmentMethod = 'shipping' | 'pickup' | 'local_delivery'

const EMPTY: CartFulfillmentOptions = { pickup: [], delivery: null }

export function useCartFulfillment(
  hostId: string | undefined,
  cartSignature: string,
  /**
   * A product's Buy button asks for that product rather than the cart; `null`
   * asks nothing (a subscription, a download).
   */
  buyNow?: { productId: string; variantId?: string; quantity: number } | null,
) {
  const buyNowKey = buyNow === undefined ? '' : JSON.stringify(buyNow)
  const [options, setOptions] = useState<CartFulfillmentOptions>(EMPTY)
  const [method, setMethod] = useState<CartFulfillmentMethod>('shipping')
  const [locationId, setLocationId] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [line1, setLine1] = useState('')
  const [windowId, setWindowId] = useState('')
  const [textPhone, setTextPhone] = useState('')
  const [round, setRound] = useState(0)
  // The postal code and street the quote below was asked for, settled after
  // the shopper stops typing so a keystroke is not a request.
  const [asked, setAsked] = useState({ postalCode: '', line1: '' })
  useEffect(() => {
    const timer = setTimeout(() => setAsked({ postalCode: postalCode.trim(), line1: line1.trim() }), 400)
    return () => clearTimeout(timer)
  }, [postalCode, line1])

  useEffect(() => {
    if (!hostId || cartSignature === '[]' || buyNow === null) {
      setOptions(EMPTY)
      return
    }
    let live = true
    const wantsQuote = method === 'local_delivery' && asked.postalCode.length >= 3
    fetch('/api/commerce/local-fulfillment-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostId,
        ...(buyNow ? buyNow : {}),
        ...(wantsQuote ? { postalCode: asked.postalCode } : {}),
        ...(wantsQuote && asked.line1 ? { address: { line1: asked.line1, postalCode: asked.postalCode } } : {}),
      }),
    })
      .then((response) => (response.ok ? response.json() : EMPTY))
      .then((payload: CartFulfillmentOptions) => {
        if (!live) return
        const next: CartFulfillmentOptions = {
          pickup: Array.isArray(payload?.pickup) ? payload.pickup : [],
          delivery: payload?.delivery ?? null,
          texts: Boolean(payload?.texts),
        }
        setOptions(next)
        // A choice the store no longer offers falls back to shipping.
        setMethod((prior) =>
          (prior === 'pickup' && !next.pickup.length) || (prior === 'local_delivery' && !next.delivery)
            ? 'shipping'
            : prior,
        )
        setLocationId((prior) =>
          next.pickup.some((location) => location.id === prior) ? prior : (next.pickup[0]?.id ?? ''),
        )
        setWindowId((prior) =>
          next.delivery?.windows.some((window) => window.id === prior) ? prior : '',
        )
      })
      .catch(() => live && setOptions(EMPTY))
    return () => {
      live = false
    }
    // `buyNow` is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, cartSignature, round, method, asked, buyNowKey])

  const offered = options.pickup.length > 0 || Boolean(options.delivery)
  const quote = options.delivery?.quote
  const deliverable = Boolean(quote && !quote.unavailable && !(quote.shortfallCents && quote.shortfallCents > 0))
  /** What the checkout is sent; `null` for a shipped order. */
  const phone = options.texts && textPhone.trim() ? { textPhone: textPhone.trim() } : {}
  const request = useMemo(() => {
    if (method === 'pickup' && locationId) return { method: 'pickup' as const, locationId, ...phone }
    if (method === 'local_delivery') {
      return {
        method: 'local_delivery' as const,
        ...phone,
        postalCode: postalCode.trim(),
        ...(windowId ? { windowStartMs: Number(windowId) } : {}),
        ...(line1.trim() ? { address: { line1: line1.trim(), postalCode: postalCode.trim() } } : {}),
      }
    }
    return null
    // `phone` is derived from the two values listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, locationId, postalCode, windowId, line1, textPhone, options.texts])
  /** Whether the choice is complete enough to check out with. */
  const ready =
    method === 'shipping' ||
    (method === 'pickup' && Boolean(locationId)) ||
    // The quote is the server's answer for what was typed: a zone that
    // reaches it and an order that meets its minimum.
    (method === 'local_delivery' && Boolean(postalCode.trim()) && Boolean(windowId) && deliverable)
  const signature = JSON.stringify(request)
  const reload = useCallback(() => setRound((value) => value + 1), [])
  return {
    options,
    offered,
    method,
    setMethod,
    locationId,
    setLocationId,
    postalCode,
    setPostalCode,
    line1,
    setLine1,
    windowId,
    setWindowId,
    textPhone,
    setTextPhone,
    request,
    ready,
    signature,
    reload,
  }
}

export type CartFulfillmentState = ReturnType<typeof useCartFulfillment>

export function CartFulfillmentChoice(props: {
  state: CartFulfillmentState
  formatCents: (cents: number) => string
}) {
  const { state, formatCents } = props
  const { options, method } = state
  if (!state.offered) return null
  const location = options.pickup.find((entry) => entry.id === state.locationId)
  const delivery = options.delivery
  const quote = delivery?.quote
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControl>
        <FormLabel id="cart-fulfillment-method">
          <Typography variant="subtitle2" component="span">
            {'How do you want your order?'}
          </Typography>
        </FormLabel>
        <RadioGroup
          aria-labelledby="cart-fulfillment-method"
          value={method}
          onChange={(event) => state.setMethod(event.target.value as CartFulfillmentMethod)}
        >
          <FormControlLabel value="shipping" control={<Radio size="small" />} label="Ship it" />
          {options.pickup.length ? (
            <FormControlLabel
              value="pickup"
              control={<Radio size="small" />}
              label={options.pickup.length === 1 ? `Pick up at ${options.pickup[0].name}` : 'Pick up in store'}
            />
          ) : null}
          {delivery ? (
            <FormControlLabel value="local_delivery" control={<Radio size="small" />} label="Local delivery" />
          ) : null}
        </RadioGroup>
      </FormControl>
      {method === 'pickup' ? (
        <>
          {options.pickup.length > 1 ? (
            <TextField
              select
              label="Pickup location"
              value={state.locationId}
              onChange={(event) => state.setLocationId(event.target.value)}
              size="small"
            >
              {options.pickup.map((entry) => (
                <MenuItem key={entry.id} value={entry.id}>
                  {entry.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {location ? (
            <Box>
              {location.address ? (
                <Typography variant="body2">{location.address}</Typography>
              ) : null}
              {location.hours ? (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ whiteSpace: 'pre-line' }}>
                  {location.hours}
                </Typography>
              ) : null}
              {location.readyWithinMinutes ? (
                <Typography variant="caption" color="text.secondary" component="p">
                  {`${pickupReadyWithinLabel(location.readyWithinMinutes)}. We’ll email you when it’s ready.`}
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary" component="p">
                  {'We’ll email you when it’s ready.'}
                </Typography>
              )}
              {location.instructions ? (
                <Typography variant="caption" color="text.secondary" component="p">
                  {location.instructions}
                </Typography>
              ) : null}
            </Box>
          ) : null}
        </>
      ) : null}
      {method !== 'shipping' && options.texts ? (
        <TextField
          label="Mobile number (optional)"
          value={state.textPhone}
          onChange={(event) => state.setTextPhone(event.target.value)}
          size="small"
          helperText={
            method === 'pickup'
              ? 'We’ll text you when your order is ready'
              : 'We’ll text you when your order is on its way'
          }
          slotProps={{ htmlInput: { autoComplete: 'tel', inputMode: 'tel', maxLength: 24 } }}
        />
      ) : null}
      {method === 'local_delivery' && delivery ? (
        <>
          <TextField
            label="Postal code"
            value={state.postalCode}
            onChange={(event) => state.setPostalCode(event.target.value)}
            size="small"
            slotProps={{ htmlInput: { autoComplete: 'shipping postal-code', maxLength: 12 } }}
          />
          {delivery.needsAddress ? (
            <TextField
              label="Street address"
              value={state.line1}
              onChange={(event) => state.setLine1(event.target.value)}
              size="small"
              helperText="Delivery depends on the distance from the store"
              slotProps={{ htmlInput: { autoComplete: 'shipping address-line1', maxLength: 120 } }}
            />
          ) : null}
          {quote?.unavailable ? <Alert severity="info">{quote.unavailable}</Alert> : null}
          {quote && !quote.unavailable ? (
            quote.shortfallCents && quote.shortfallCents > 0 ? (
              <Alert severity="info">
                {`Delivery needs an order of at least ${formatCents(quote.minimumCents ?? 0)}. ` +
                  `Add ${formatCents(quote.shortfallCents)} more.`}
              </Alert>
            ) : (
              <Typography variant="body2">
                {quote.feeCents
                  ? `Delivery: ${formatCents(quote.feeCents)}`
                  : 'Delivery: free'}
                {quote.freeOverCents && quote.feeCents
                  ? ` (free over ${formatCents(quote.freeOverCents)})`
                  : ''}
              </Typography>
            )
          ) : null}
          {delivery.windows.length ? (
            <TextField
              select
              label="Delivery time"
              value={state.windowId}
              onChange={(event) => state.setWindowId(event.target.value)}
              size="small"
            >
              {delivery.windows.map((window) => (
                <MenuItem key={window.id} value={window.id}>
                  {window.label}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Alert severity="info">{'No delivery times are open right now.'}</Alert>
          )}
          {delivery.instructions ? (
            <Typography variant="caption" color="text.secondary">
              {delivery.instructions}
            </Typography>
          ) : null}
        </>
      ) : null}
    </Box>
  )
}
