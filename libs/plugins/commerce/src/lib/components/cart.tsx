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
import {
  buildBeginCheckoutParams,
  trackEvent,
} from '@aglyn/aglyn/app-utils/analytics-events'
import * as CommerceModel from '../model'
import { mdiCartOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Drawer from '@mui/material/Drawer'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import SvgIcon from '@mui/material/SvgIcon'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { StorefrontPaymentElementFallback } from './storefront-payment-element'

/**
 * The Payment Element (AGL-1944), lazily. Stripe.js and its React wrapper are
 * a large dependency and the flag is OFF, so a static import would ship the
 * whole SDK in the bundle of every page carrying a cart — which is most pages
 * on a storefront — to serve a path no shopper currently reaches.
 */
const StorefrontPaymentElement = lazy(() =>
  import('./storefront-payment-element').then((module) => ({
    default: module.StorefrontPaymentElement,
  })),
)
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { useStorefrontPurchaseEvent } from '../utils/use-storefront-purchase-event'

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
  const siteFetch = Aglyn.useSiteFetch()
  const [coupon, setCoupon] = useState('')
  const [email, setEmail] = useState('')
  const [optIn, setOptIn] = useState(false)
  const [giftCard, setGiftCard] = useState('')
  // Where the parcel is going (AGL-1721). Asked ONLY when the server says it
  // cannot price shipping without it — a merchant with one zone, one
  // rest-of-world zone, or no shipping at all never sees this field, which is
  // the common configuration. `null` is "not asked", so the field appearing is
  // itself the server's answer rather than a guess made here.
  const [shipTo, setShipTo] = useState('')
  const [shipCountries, setShipCountries] = useState<string[] | null>(null)
  // `paused` is its own state, not an `error` with gentler words (AGL-1511):
  // the two need different severities, and a shopper told in red that
  // checkout failed does not read the sentence explaining it did not. `ask` is
  // the same argument again: being asked for a destination is not a failure.
  const [status, setStatus] = useState<
    'idle' | 'sending' | 'error' | 'paused' | 'ask'
  >('idle')
  const [message, setMessage] = useState('')
  /**
   * The in-page checkout session (AGL-1944). Null unless the server chose
   * native mode, which needs both the release flag and a publishable key.
   */
  const [nativeCheckout, setNativeCheckout] = useState<{
    clientSecret: string
    publishableKey: string
  } | null>(null)
  /**
   * In-progress quantity edits, keyed by line, as the raw field text
   * (AGL-1772). The field used to POST /api/commerce/cart on every
   * keystroke — typing "100" was three Firestore writes, and clearing the
   * field to retype passed through `""` → 0, which is the REMOVE path, so a
   * select-all-and-retype could delete the line mid-edit (and the response
   * replacing `cart` state then fought the input).
   *
   * The repo convention for quantity inputs is local state committed on an
   * explicit settle — the PDP's Qty field (product-detail.tsx) holds
   * `useState` and sends nothing until the buy click, and besigner
   * attributes commit on blur. So: keystrokes only edit the draft; blur or
   * Enter commits ONE write; an empty or unparsable draft is a pending
   * state that reverts to the server's quantity, never a 0-as-remove. A
   * genuine remove still works both ways — the ✕ button, and typing an
   * actual 0 then leaving the field.
   */
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>(
    {},
  )
  const lineKey = (line: CartLineView) =>
    `${line.productId}:${line.variantId ?? ''}`
  const commitQuantity = (line: CartLineView) => {
    const key = lineKey(line)
    const draft = quantityDrafts[key]
    if (draft === undefined) return
    // Drops the draft, but only if it is still THIS one — a keystroke that
    // lands while the write is in flight starts a new edit, and clearing it
    // here would erase what the shopper is typing.
    const settle = () =>
      setQuantityDrafts((drafts) => {
        if (drafts[key] !== draft) return drafts
        const { [key]: _settled, ...rest } = drafts
        return rest
      })
    // `Number('')` is 0 — exactly the misreading that turned a cleared
    // field into a remove. Empty means "no answer": show the server's
    // quantity again and write nothing. NaN (letters) reverts the same way.
    if (draft.trim() === '') return settle()
    const parsed = Math.round(Number(draft))
    if (!Number.isFinite(parsed)) return settle()
    const quantity = Math.max(0, parsed)
    // A settled value equal to the server's is not an edit.
    if (quantity === line.quantity) return settle()
    // The draft keeps rendering until the response lands, so the field does
    // not flash the superseded quantity during the round-trip; the server's
    // answer (via the replaced `cart`) takes over when it arrives.
    void onMutate({
      action: 'set',
      productId: line.productId,
      variantId: line.variantId,
      quantity,
    }).finally(settle)
  }

  /**
   * Idempotency key for ONE checkout attempt (AGL-1697).
   *
   * Minted lazily on the first checkout click, retired whenever the attempt
   * changes shape — different lines, codes, email or destination are a
   * different checkout. Keyed off a CONTENT signature of the lines rather
   * than the `cart` object, whose identity changes on every refetch: retiring
   * on identity would hand a genuine retry a fresh key, which is exactly the
   * double-session this exists to prevent.
   */
  const attemptKey = useRef('')
  const cartSignature = useMemo(
    () =>
      JSON.stringify(
        (cart?.lines ?? []).map((line) => [
          line.productId,
          line.variantId ?? '',
          line.quantity,
        ]),
      ),
    [cart],
  )
  useEffect(() => {
    attemptKey.current = ''
  }, [cartSignature, email, coupon, giftCard, shipTo])

  const handleCheckout = useCallback(async () => {
    if (status === 'sending') return
    setStatus('sending')
    setMessage('')
    if (!attemptKey.current) {
      attemptKey.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    try {
      const response = await siteFetch('/api/commerce/cart-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Stable across a retry of THIS attempt (AGL-1697), so a
          // double-click cannot spawn a second session from one cart.
          'Idempotency-Key': attemptKey.current,
        },
        body: JSON.stringify({
          hostId,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(optIn ? { marketingOptIn: true } : {}),
          ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
          ...(giftCard.trim() ? { giftCardCode: giftCard.trim() } : {}),
          // A request, never an instruction: the server resolves the rates
          // for this country AND restricts the session's collectable
          // addresses to it, so declaring one cannot buy a cheaper zone's
          // rate than the address the shopper then enters (AGL-1721).
          ...(shipTo ? { shippingCountry: shipTo } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      // In-page payment (AGL-1944). Checked BEFORE the redirect branch: a
      // native session carries a client secret and no url, and if a server ever
      // sent both, navigating away would silently discard the form.
      //
      // `begin_checkout` is reported on BOTH paths, and from the same place, so
      // the GA4 funnel does not develop a hole the day the flag flips — a
      // storefront whose `begin_checkout` count halved would look like a
      // conversion collapse rather than a checkout that stopped redirecting.
      if (response.ok && payload?.clientSecret && payload?.publishableKey) {
        trackEvent(
          'begin_checkout',
          buildBeginCheckoutParams({
            value: (cart?.subtotalCents ?? 0) / 100,
            items: (cart?.lines ?? []).map((line) => ({
              item_id: line.productId,
              item_name: line.name,
              price: line.unitAmountCents / 100,
              quantity: line.quantity,
            })),
          }),
        )
        setNativeCheckout({
          clientSecret: String(payload.clientSecret),
          publishableKey: String(payload.publishableKey),
        })
        setStatus('idle')
        return
      }
      if (response.ok && payload?.url) {
        // GA4 checkout funnel (AGL-1561, converted by AGL-1591). This used to
        // call `window.gtag` raw with `value`/`currency` only, so the same
        // event name arrived from this surface and from the console's plan
        // checkout in two different shapes — and this half carried no `items`,
        // which is the field GA4's ecommerce funnel is actually built on.
        //
        // The item ids are the PRODUCT ids `view_item` and `add_to_cart`
        // already send, so the three now join into one per-product funnel.
        // `value` is stated rather than derived because the cart subtotal is
        // authoritative after a coupon or gift card, which the line prices
        // below are not. No `billing_interval`: a storefront cart is not a
        // subscription.
        trackEvent(
          'begin_checkout',
          buildBeginCheckoutParams({
            value: (cart?.subtotalCents ?? 0) / 100,
            items: (cart?.lines ?? []).map((line) => ({
              item_id: line.productId,
              item_name: line.name,
              price: line.unitAmountCents / 100,
              quantity: line.quantity,
            })),
          }),
        )
        window.location.assign(payload.url)
        return
      }
      // A read-only lockdown answers 423 with the visitor pause copy
      // (AGL-1511). Rendering `payload.error` here would print the wire
      // token "locked" at a shopper, and the `severity="error"` styling
      // would tell them their payment failed — the one thing this copy
      // exists to never say. So the refusal is parsed and shown as a calm
      // notice instead.
      const paused = Aglyn.parseLockdownRefusal(response.status, payload)
      if (paused) {
        setMessage(Aglyn.lockdownRefusalText(paused))
        setStatus('paused')
        return
      }
      // The merchant's rates differ by destination, so the server will not
      // price this cart until it knows one (AGL-1721). Reveal the field and
      // let the shopper answer; a store that never sends this never shows it.
      if (payload?.needsShippingCountry) {
        setShipCountries(
          (payload.shippingCountries as string[] | undefined)?.length
            ? (payload.shippingCountries as string[])
            : [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
        )
        setMessage(String(payload?.error ?? ''))
        // An unserved destination is a real refusal and reads as one; being
        // asked the first time is not.
        setStatus(shipTo ? 'error' : 'ask')
        return
      }
      setMessage(String(payload?.error ?? ''))
      setStatus('error')
    } catch {
      setStatus('error')
    }
    // `cart` is a dependency because the payload above reads it: without it
    // the handler closes over whichever cart was current when it was created,
    // and a checkout started after a quantity change would report the OLD
    // subtotal and the OLD lines. The pre-AGL-1591 raw call had the same bug
    // in the `value` alone, where a wrong number is indistinguishable from a
    // right one.
  }, [hostId, cart, coupon, email, optIn, giftCard, shipTo, status, siteFetch])

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
            value={quantityDrafts[lineKey(line)] ?? line.quantity}
            onChange={(event) =>
              setQuantityDrafts((drafts) => ({
                ...drafts,
                [lineKey(line)]: event.target.value,
              }))
            }
            onBlur={() => commitQuantity(line)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitQuantity(line)
            }}
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
      {shipCountries ? (
        <TextField
          select
          label="Ship to"
          value={shipTo}
          onChange={(event) => setShipTo(event.target.value)}
          size="small"
          helperText="Shipping rates depend on where this is going"
        >
          {shipCountries.map((code) => (
            <MenuItem key={code} value={code}>
              {CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      {status === 'paused' || status === 'ask' ? (
        <Alert severity="info">{message}</Alert>
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
          status === 'sending' ||
          cart.lines.every((line) => line.unavailable) ||
          // Asked but unanswered: the server would only refuse again.
          (shipCountries !== null && !shipTo)
        }
        onClick={handleCheckout}
      >
        {status === 'sending'
          ? // "Redirecting" stops being true the moment the form opens in
            // place (AGL-1944).
            nativeCheckout
            ? 'Opening…'
            : 'Redirecting…'
          : checkoutLabel || 'Checkout'}
      </Button>
      {nativeCheckout ? (
        <Suspense fallback={<StorefrontPaymentElementFallback />}>
          <StorefrontPaymentElement
            clientSecret={nativeCheckout.clientSecret}
            publishableKey={nativeCheckout.publishableKey}
            payLabel={checkoutLabel || 'Pay now'}
            // The session is left open on cancel, deliberately: it is what the
            // AGL-323 abandoned-cart recovery emails are built on, and expiring
            // it would be a write against the merchant's Stripe account made
            // from a browser.
            onCancel={() => setNativeCheckout(null)}
          />
        </Suspense>
      ) : null}
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
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { hostId } = Aglyn.useSite()
  const siteFetch = Aglyn.useSiteFetch()
  const [cart, setCart] = useState<CartView | null>(null)
  const [open, setOpen] = useState(false)

  // Closes the merchant's ecommerce funnel (AGL-1641). Stripe returns a cart
  // checkout to the page it started on — this one — so the `purchase` that
  // `begin_checkout` above has never had a counterpart to is reported here.
  // No-ops on every ordinary render: the hook returns immediately unless the
  // URL carries `?order=success&session_id=…`.
  useStorefrontPurchaseEvent(hostId, siteFetch)

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
      const response = await siteFetch('/api/commerce/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, ...body }),
      })
      if (response.ok) {
        setCart(await response.json())
        window.dispatchEvent(new Event(CART_UPDATED_EVENT))
      }
    },
    [hostId, siteFetch],
  )

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: variant === 'inline' ? 3 : 1,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
            display: 'inline-block',
          },
          ...nodeSx,
        ]}
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
    <Box ref={ref} {...rest} sx={[{ display: 'inline-flex' }, ...nodeSx]}>
      <IconButton aria-label="Cart" onClick={() => setOpen(true)}>
        <Badge badgeContent={cart?.count ?? 0} color="primary">
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
