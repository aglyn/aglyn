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

import * as Aglyn from '@aglyn/aglyn'
import { mdiCartOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Drawer from '@mui/material/Drawer'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import SvgIcon from '@mui/material/SvgIcon'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'cart'

/** Blocks dispatch this after mutating the cart so badges refresh. */
export const CART_UPDATED_EVENT = 'aglyn:cart-updated'

export interface CartProps {
  /** 'button' = app-bar icon + drawer; 'inline' = full cart in place. */
  variant?: 'button' | 'inline'
  checkoutLabel?: string
  /** Show the coupon-code field above checkout. */
  showCoupon?: boolean
  emptyText?: string
}

interface CartLineView {
  productId: string
  variantId?: string
  quantity: number
  name: string
  variantLabel?: string
  unitAmountCents: number
  imageUrl?: string
  unavailable?: boolean
}

interface CartView {
  lines: CartLineView[]
  count: number
  subtotalCents: number
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

function CartLines(props: {
  hostId: string
  cart: CartView | null
  showCoupon?: boolean
  checkoutLabel?: string
  emptyText?: string
  onMutate: (body: Record<string, unknown>) => Promise<void>
}) {
  const { hostId, cart, showCoupon, checkoutLabel, emptyText, onMutate } =
    props
  const [coupon, setCoupon] = useState('')
  const [email, setEmail] = useState('')
  const [optIn, setOptIn] = useState(false)
  const [giftCard, setGiftCard] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleCheckout = useCallback(async () => {
    if (status === 'sending') return
    setStatus('sending')
    setMessage('')
    try {
      const response = await fetch('/api/commerce/cart-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(optIn ? { marketingOptIn: true } : {}),
          ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
          ...(giftCard.trim() ? { giftCardCode: giftCard.trim() } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.url) {
        ;(window as any).gtag?.('event', 'begin_checkout', {
          value: (cart?.subtotalCents ?? 0) / 100,
          currency: 'USD',
        })
        window.location.assign(payload.url)
        return
      }
      setMessage(String(payload?.error ?? ''))
      setStatus('error')
    } catch {
      setStatus('error')
    }
  }, [hostId, coupon, email, optIn, giftCard, status])

  if (!cart || cart.lines.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {emptyText || 'Your cart is empty.'}
      </Typography>
    )
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 2 }}>
      {cart.lines.map((line) => (
        <Box
          key={`${line.productId}:${line.variantId ?? ''}`}
          sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}
        >
          {line.imageUrl ? (
            <Box
              component="img"
              src={line.imageUrl}
              alt=""
              sx={{
                width: 48,
                height: 48,
                objectFit: 'cover',
                borderRadius: 1,
              }}
            />
          ) : (
            <Box
              sx={{
                width: 48,
                height: 48,
                bgcolor: 'action.hover',
                borderRadius: 1,
              }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {line.name}
              {line.variantLabel ? ` — ${line.variantLabel}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {line.unavailable
                ? 'No longer available'
                : usd(line.unitAmountCents)}
            </Typography>
          </Box>
          <TextField
            value={line.quantity}
            onChange={(event) =>
              void onMutate({
                action: 'set',
                productId: line.productId,
                variantId: line.variantId,
                quantity: Math.max(
                  0,
                  Math.round(Number(event.target.value)) || 0,
                ),
              })
            }
            size="small"
            sx={{ width: 60 }}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <Button
            size="small"
            color="error"
            onClick={() =>
              void onMutate({
                action: 'remove',
                productId: line.productId,
                variantId: line.variantId,
              })
            }
          >
            {'✕'}
          </Button>
        </Box>
      ))}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">{'Subtotal'}</Typography>
        <Typography variant="subtitle2">{usd(cart.subtotalCents)}</Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {'Shipping and taxes are calculated at checkout.'}
      </Typography>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        size="small"
        helperText="For your receipt and order updates"
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={optIn}
            onChange={(event) => setOptIn(event.target.checked)}
          />
        }
        label={
          <Typography variant="caption">
            {'Email me news and offers'}
          </Typography>
        }
      />
      {showCoupon ? (
        <>
          <TextField
            label="Coupon code"
            value={coupon}
            onChange={(event) => setCoupon(event.target.value)}
            size="small"
          />
          <TextField
            label="Gift card"
            value={giftCard}
            onChange={(event) => setGiftCard(event.target.value)}
            size="small"
            placeholder="GC-…"
          />
        </>
      ) : null}
      {status === 'error' ? (
        <Alert severity="error">
          {message || 'Checkout is unavailable right now.'}
        </Alert>
      ) : null}
      <Button
        variant="contained"
        color="primary"
        disabled={
          status === 'sending' || cart.lines.every((line) => line.unavailable)
        }
        onClick={handleCheckout}
      >
        {status === 'sending' ? 'Redirecting…' : checkoutLabel || 'Checkout'}
      </Button>
    </Box>
  )
}

/**
 * Cart block (AGL-293): 'button' renders a badge icon + slide-out
 * drawer for app bars; 'inline' renders the full cart for a cart page.
 * Lines live server-side (cookie cart); every mutation re-resolves
 * prices. Other blocks broadcast CART_UPDATED_EVENT to refresh badges.
 */
const Cart = forwardRef<HTMLDivElement, CartProps>((props, ref) => {
  const { variant, checkoutLabel, showCoupon, emptyText, ...rest } = props
  const { hostId } = Aglyn.useSite()
  const [cart, setCart] = useState<CartView | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!hostId) return
    try {
      const response = await fetch(
        `/api/commerce/cart?hostId=${encodeURIComponent(hostId)}`,
      )
      if (response.ok) setCart(await response.json())
    } catch {
      // Badge silently stays stale offline.
    }
  }, [hostId])

  useEffect(() => {
    void refresh()
    const handler = () => void refresh()
    window.addEventListener(CART_UPDATED_EVENT, handler)
    return () => window.removeEventListener(CART_UPDATED_EVENT, handler)
  }, [refresh])

  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      if (!hostId) return
      const response = await fetch('/api/commerce/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, ...body }),
      })
      if (response.ok) {
        setCart(await response.json())
        window.dispatchEvent(new Event(CART_UPDATED_EVENT))
      }
    },
    [hostId],
  )

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          p: variant === 'inline' ? 3 : 1,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          color: 'text.secondary',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          display: 'inline-block',
        }}
      >
        {variant === 'inline' ? 'Cart — lines render here' : '🛒 Cart'}
      </Box>
    )
  }

  if (variant === 'inline') {
    return (
      <Box ref={ref} {...rest}>
        <CartLines
          hostId={hostId}
          cart={cart}
          showCoupon={showCoupon}
          checkoutLabel={checkoutLabel}
          emptyText={emptyText}
          onMutate={mutate}
        />
      </Box>
    )
  }

  return (
    <Box ref={ref} {...rest} sx={{ display: 'inline-flex' }}>
      <IconButton aria-label="Cart" onClick={() => setOpen(true)}>
        <Badge badgeContent={cart?.count ?? 0} color="secondary">
          <SvgIcon>
            <path d={mdiCartOutline.path} />
          </SvgIcon>
        </Badge>
      </IconButton>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: { xs: '85vw', sm: 380 } }}>
          <Typography variant="h6" sx={{ p: 2, pb: 0 }}>
            {'Your cart'}
          </Typography>
          <CartLines
            hostId={hostId}
            cart={cart}
            showCoupon={showCoupon}
            checkoutLabel={checkoutLabel}
            emptyText={emptyText}
            onMutate={mutate}
          />
        </Box>
      </Drawer>
    </Box>
  )
})
Cart.displayName = 'AglynCart'

export const schema: Aglyn.ComponentSchema<CartProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Cart',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiCartOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'variant',
      label: 'Style',
      description: 'Icon-with-drawer for app bars, or the full inline cart.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'button', label: 'Icon + drawer' },
        { value: 'inline', label: 'Inline (cart page)' },
      ],
    },
    {
      name: 'checkoutLabel',
      label: 'Checkout label',
      description: 'Defaults to "Checkout".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'showCoupon',
      label: 'Show coupon field',
      description: 'Codes are managed on the Products page.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      name: 'emptyText',
      label: 'Empty text',
      description: 'Copy when the cart is empty.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID, 'button'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Cart button',
    pluginId: BUNDLE_ID,
    description: 'Badge icon with a slide-out cart drawer',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiCartOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { variant: 'button' },
    },
  },
  {
    $id: generatePresetId(ID, 'inline'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Cart page',
    pluginId: BUNDLE_ID,
    description: 'Full cart with quantities, coupon, and checkout',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiCartOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { variant: 'inline', showCoupon: true },
    },
  },
]

export default Cart
