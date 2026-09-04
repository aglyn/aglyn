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
  buildAddToCartParams,
  buildBeginCheckoutParams,
  trackEvent,
  trackEventBeforeNavigation,
  type AnalyticsItem,
} from '@aglyn/aglyn/app-utils/analytics-events'
import {
  isPaymentsNotConfigured,
  storefrontPaymentsNotConfiguredText,
} from '@aglyn/aglyn/app-utils/payments-configured'
import * as CommerceModel from '../model'
import { mdiTagOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { Suspense, forwardRef, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { useStorefrontPurchaseEvent } from '../utils/use-storefront-purchase-event'
import { CART_UPDATED_EVENT } from './cart'
import { ID as PRODUCT_REVIEWS_ID } from './product-reviews'
import { ID as RELATED_PRODUCTS_ID } from './related-products'
import { readLocalWishlist, toggleWishlist } from './wishlist'
import { StorefrontPaymentElementFallback } from './storefront-payment-element-fallback'

/**
 * The Payment Element (AGL-1944), behind a lazy boundary rather than a plain
 * import. Stripe.js and its React wrapper are a large dependency, the flag is
 * OFF, and a static import would put the whole SDK into the bundle of every
 * product page on every published site to serve a code path no shopper reaches.
 * Split, it is fetched by the shoppers who actually get the in-page form.
 */
const StorefrontPaymentElement = lazy(() =>
  import('./storefront-payment-element').then((module) => ({
    default: module.StorefrontPaymentElement,
  })),
)

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'product-detail'

export interface ProductDetailProps {
  /** Product slug; blank resolves from /products/{slug} in the URL. */
  slug?: string
  buyLabel?: string
  /** Hide the description block (design it separately with tokens). */
  hideDescription?: boolean
  /** Offer a discount/coupon code field before the buy button. */
  showCoupon?: boolean
}

interface DetailVariant {
  id: string
  options?: Record<string, string>
  priceUsd: number
  compareAtPriceUsd?: number
  soldOut: boolean
  imageUrl?: string
}

interface Detail {
  id: string
  name: string
  slug: string
  description?: string
  mediaUrls: string[]
  options: CommerceModel.ProductOption[]
  variants: DetailVariant[]
  /** Recurring billing (AGL-303); framing + buyer choice on the PDP. */
  subscription?: { interval: 'month' | 'year'; trialDays?: number }
  /** Buyer picks one-time or subscribe at the same price (AGL-545). */
  subscriptionOptional?: boolean
}

const SAMPLE: Detail = {
  id: 'sample',
  name: 'Sample product',
  slug: '#',
  description: 'Drop this block on your product page template.',
  mediaUrls: [],
  options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  variants: [
    { id: 'a', options: { Size: 'S' }, priceUsd: 29, soldOut: false },
    { id: 'b', options: { Size: 'M' }, priceUsd: 29, soldOut: false },
    { id: 'c', options: { Size: 'L' }, priceUsd: 32, soldOut: true },
  ],
}

/**
 * The GA4 `items` entry for one line of this product.
 *
 * `item_id` is the PRODUCT id and never the variant's, matching the
 * `view_item` above and the cart's lines below: GA joins the funnel on that
 * id, and a `begin_checkout` keyed on a variant would report a product nothing
 * else on the storefront had ever mentioned.
 *
 * `price` is the resolved variant's, which arrived from the server's product
 * payload — the same figure `checkout` prices the charge from, so the reported
 * value and the amount Stripe collects come from one source.
 */
function buyItem(
  product: Detail,
  variant: DetailVariant | undefined,
  quantity: number,
): AnalyticsItem {
  return {
    item_id: product.id,
    item_name: product.name,
    price: variant?.priceUsd,
    quantity,
  }
}

function slugFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const match = window.location.pathname.match(/\/products\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * Product detail block (AGL-292): gallery, option pickers that resolve
 * the variant (price/media/stock follow), quantity, and a buy button
 * that charges through the server-priced checkout with the selected
 * variant. Resolves its product from the /products/{slug} URL unless a
 * slug prop pins it; sample data on the inert canvas.
 */
const ProductDetail = forwardRef<HTMLDivElement, ProductDetailProps>(
  (props, ref) => {
    const { slug: slugProp, buyLabel, hideDescription, showCoupon, ...rest } =
      props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const site = Aglyn.useSite()
    const siteFetch = Aglyn.useSiteFetch()
    const { hostId } = site

    // The single-product ("buy now") path returns the shopper to this page
    // rather than to the cart, so the PDP is the second of the two surfaces
    // that has to be able to report `purchase` (AGL-1641). Both mount points
    // share one guard, so a page carrying a cart AND a PDP still sends one.
    useStorefrontPurchaseEvent(hostId, siteFetch)
    // Seeded from the server-resolved page data (AGL-659) so the PDP renders
    // its real content in the SSR HTML. Starting at null meant the server
    // emitted a <Skeleton> and the crawler got a product page with no
    // product in it. Absent in the besigner/preview, where the effect below
    // still fetches — so this is an optimisation, not a new requirement.
    const seededProduct = (
      site.pageData as { commerce?: { product?: Detail } } | undefined
    )?.commerce?.product
    const [detail, setDetail] = useState<Detail | null | 'missing'>(
      seededProduct ?? null,
    )
    const [selections, setSelections] = useState<Record<string, string>>({})
    const [quantity, setQuantity] = useState(1)
    /** A discount or coupon code typed on the product page. */
    const [coupon, setCoupon] = useState('')
    const [activeImage, setActiveImage] = useState(0)
    // `unconfigured` is not an `error` with softer words (AGL-2019). A store
    // with no Stripe key answers 501, and rendering that at `severity="error"`
    // tells a shopper their payment failed when nothing was ever attempted —
    // the same distinction `ask` already makes, and the same one the cart's
    // 423 lockdown branch makes. It is the terminal one: it latches Buy off,
    // because every further click gets the identical refusal.
    const [status, setStatus] = useState<
      'idle' | 'sending' | 'error' | 'ask' | 'unconfigured'
    >('idle')
    const [message, setMessage] = useState('')
    // Buy-now's half of AGL-1721: asked only when the server refuses to price
    // shipping without a destination, so a digital product, a subscription, or
    // a merchant whose rates are the same everywhere never shows it. `null` is
    // "not asked" — the field appearing is the server's answer, not a guess.
    const [shipTo, setShipTo] = useState('')
    const [shipCountries, setShipCountries] = useState<string[] | null>(null)
    const [added, setAdded] = useState(false)
    const [wishlisted, setWishlisted] = useState(false)
    const [notifyEmail, setNotifyEmail] = useState('')
    const [notifyState, setNotifyState] = useState<'idle' | 'done'>('idle')
    // Buyer-chosen billing (AGL-545): only meaningful when the product
    // is subscriptionOptional; defaults to a one-time purchase.
    const [billing, setBilling] = useState<CommerceModel.CheckoutBillingChoice>(
      'once',
    )
    /**
     * The in-page checkout session (AGL-1944), null on every store until the
     * flag AND a publishable key say otherwise. A `clientSecret` is Stripe's
     * instruction to the browser; holding it says nothing about money having
     * moved, and nothing in this component ever claims it has.
     */
    const [nativeCheckout, setNativeCheckout] = useState<{
      clientSecret: string
      publishableKey: string
    } | null>(null)

    const slug = slugProp || slugFromLocation()

    useEffect(() => {
      if (hostId && resolvedId) {
        setWishlisted(readLocalWishlist(hostId).includes(resolvedId))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hostId, detail])

    useEffect(() => {
      if (!hostId || !slug) return
      // Already delivered with the page (AGL-659) — refetching the identical
      // payload on hydrate would just be a wasted round trip per visitor.
      if (seededProduct && seededProduct.slug === slug) return
      let active = true
      void fetch(
        `/api/commerce/product?hostId=${encodeURIComponent(hostId)}` +
          `&slug=${encodeURIComponent(slug)}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!active) return
          const product = payload?.product as Detail | undefined
          setDetail(product ?? 'missing')
          if (product) {
            // GA4 ecommerce mirror (AGL-327), through the shared taxonomy
            // since AGL-1591 rather than raw gtag — same consent gate, same
            // sanitizer, and the name is now checked by the compiler.
            trackEvent('view_item', {
              items: [{ item_id: product.id, item_name: product.name }],
            })
            const first =
              product.variants.find((variant) => !variant.soldOut) ??
              product.variants[0]
            setSelections(first?.options ?? {})
          }
        })
        .catch(() => {
          if (active) setDetail('missing')
        })
      return () => {
        active = false
      }
    }, [hostId, slug])

    const resolvedId =
      hostId && detail && detail !== 'missing' ? detail.id : null
    const resolved: Detail | null = hostId
      ? detail === 'missing'
        ? null
        : detail
      : SAMPLE

    const variant = useMemo(() => {
      if (!resolved) return undefined
      return (
        CommerceModel.findVariant(
          { variants: resolved.variants as any },
          selections,
        ) as DetailVariant | undefined
      ) ?? resolved.variants[0]
    }, [resolved, selections])

    // Add to cart (AGL-293) beside instant buy; badge refresh via event.
    const handleAddToCart = async () => {
      if (!hostId || !resolved || !variant) return
      setAdded(false)
      const response = await siteFetch('/api/commerce/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          action: 'add',
          productId: resolved.id,
          variantId: variant.id,
          quantity,
        }),
      }).catch(() => null)
      if (response?.ok) {
        setAdded(true)
        // Priced (AGL-1591's shape, completed): the resolved variant's price
        // and the chosen quantity are both known here and both come from the
        // server's product payload, so GA4's "value added to cart" is a real
        // number rather than the empty column an items-only hit leaves. The
        // `value` describes what was JUST ADDED, not the cart's new total —
        // see `buildAddToCartParams`.
        trackEvent(
          'add_to_cart',
          buildAddToCartParams({
            items: [buyItem(resolved, variant, quantity)],
          }),
        )
        window.dispatchEvent(new Event(CART_UPDATED_EVENT))
      }
    }

    /**
     * Idempotency key for ONE buy-now attempt (AGL-1697).
     *
     * Minted lazily on the first buy click, retired whenever the purchase
     * changes shape — a different product, variant, quantity, billing choice
     * or destination is a different attempt. A retry of THIS attempt presents
     * the same key, so the server replays the original session instead of
     * opening a second one (for a subscription product, a second RECURRING
     * subscription).
     */
    const attemptKey = useRef('')
    useEffect(() => {
      attemptKey.current = ''
      // `coupon` is in here because it CHANGES THE PRICE. Without it a shopper
      // who buys, comes back, types a code and buys again presents the same
      // key, and the server replays the original full-price session — a quoted
      // number that is not the number charged, which is the whole defect class
      // this path has been cleared of.
    }, [resolved?.id, variant?.id, quantity, billing, shipTo, coupon])

    const handleBuy = async () => {
      if (!hostId || !resolved || !variant || status === 'sending') return
      setStatus('sending')
      setMessage('')
      if (!attemptKey.current) {
        attemptKey.current =
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      try {
        const response = await siteFetch('/api/commerce/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': attemptKey.current,
          },
          body: JSON.stringify({
            hostId,
            productId: resolved.id,
            variantId: variant.id,
            quantity,
            // Billing choice (AGL-545): the server re-validates against
            // the product doc, so this is a request, not an instruction.
            ...(resolved.subscriptionOptional ? { billing } : {}),
            // Likewise a request (AGL-1721): the server resolves this
            // country's rates AND restricts the session to addresses in it,
            // so naming a cheap zone here cannot ship a parcel anywhere else.
            ...(shipTo ? { shippingCountry: shipTo } : {}),
            // The server resolves this against the discounts hub first and the
            // legacy coupons second, and refuses a code it cannot apply with a
            // reason — never a silent full-price charge.
            ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        // In-page payment (AGL-1944). A native session returns a client secret
        // and NO url — the two are mutually exclusive by construction, so the
        // redirect branch below is unreachable in native mode and vice versa.
        // Checked FIRST so a server that somehow sent both cannot silently
        // navigate the shopper away from the form we just decided to show.
        if (response.ok && payload?.clientSecret && payload?.publishableKey) {
          // Buy-now's `begin_checkout`. The cart path has reported this since
          // AGL-1591 and this one never did, so a storefront whose shoppers
          // skip the cart showed `view_item` → `add_to_cart` → nothing →
          // `purchase`: GA4's shopping funnel put every single-product sale in
          // the "abandoned checkout" bucket, and the merchant's checkout rate
          // read as a collapse rather than as an unmeasured path.
          //
          // Reported on BOTH branches, and from the same place, for the reason
          // the cart states: a count that halved the day the in-page payment
          // flag flipped would look like a conversion collapse.
          trackEvent(
            'begin_checkout',
            buildBeginCheckoutParams({
              items: [buyItem(resolved, variant, quantity)],
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
          // Awaited before the redirect (AGL-1580), for the reason spelled out
          // on the cart's matching branch: delivery here is a synchronous
          // `window.gtag` call today and the await costs nothing, but the
          // property that makes a bare call safe is invisible from this file.
          await trackEventBeforeNavigation(
            'begin_checkout',
            buildBeginCheckoutParams({
              items: [buyItem(resolved, variant, quantity)],
            }),
          )
          window.location.assign(payload.url)
          return
        }
        // Buy-now's half of AGL-2019. The server's own 501 wording is not
        // rendered to a visitor; this surface is public.
        if (isPaymentsNotConfigured(response.status)) {
          setMessage(storefrontPaymentsNotConfiguredText())
          setStatus('unconfigured')
          return
        }
        if (payload?.needsShippingCountry) {
          setShipCountries(
            (payload.shippingCountries as string[] | undefined)?.length
              ? (payload.shippingCountries as string[])
              : [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
          )
          setMessage(String(payload?.error ?? ''))
          // An unserved destination is a refusal and reads as one; being
          // asked the first time is not.
          setStatus(shipTo ? 'error' : 'ask')
          return
        }
        setMessage(String(payload?.error ?? ''))
        setStatus('error')
      } catch {
        setStatus('error')
      }
    }

    if (hostId && detail === null) {
      return (
        <Box ref={ref} {...rest} sx={[{ display: 'flex', gap: 3 }, ...nodeSx]}>
          <Skeleton variant="rectangular" width={320} height={320} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="60%" height={36} />
            <Skeleton width="25%" />
            <Skeleton width="90%" />
          </Box>
        </Box>
      )
    }
    if (!resolved) {
      return (
        <Box ref={ref} {...rest} sx={[{ p: 3 }, ...nodeSx]}>
          <Typography variant="body2" color="text.secondary">
            {'Product not found.'}
          </Typography>
        </Box>
      )
    }

    // Every rendered `<img src>` on this page goes through
    // `siteRelativeMediaSrc` (AGL-1726). Commerce called NO resolver at all,
    // which cost it two things at once: a `media:` reference — writable via
    // the resources API and the CSV importer — would have reached an `<img>`
    // as the literal string, and a stored absolute
    // `https://{subdomain}.aglyn.app/api/media/cdn/…` stayed absolute, so a
    // white-label storefront on the customer's own domain served product
    // photos naming OUR platform, cross-origin, in page source and in every
    // visitor's request. Production carried exactly one such document; the
    // resolver fixes it at READ time, so no backfill stands between the
    // defect and the fix.
    //
    // Deliberately NOT applied to `resolved.mediaUrls` wholesale: the
    // schema.org `image` array below is read out of band by a crawler, where
    // an absolute URL is the point. That one wants `absoluteMediaSrc` with
    // the site's own origin, which is the tenant page's job (AGL-1725).
    const galleryImage = Aglyn.siteRelativeMediaSrc(
      variant?.imageUrl ?? resolved.mediaUrls[activeImage] ?? resolved.mediaUrls[0],
      { hostId },
    )

    // Subscription framing (AGL-545): subscription-only products price as
    // $X/mo|/yr with a "Subscribe" button; subscriptionOptional products
    // surface the one-time/subscribe toggle instead. Same price either way
    // — the server re-prices from the product doc regardless.
    const subscription = resolved.subscription
    const intervalSuffix = subscription?.interval === 'year' ? '/yr' : '/mo'
    const subscribing =
      Boolean(subscription) &&
      (!resolved.subscriptionOptional || billing === 'subscribe')

    // schema.org Product/Offer (AGL-299). Kept ONLY for the case where this
    // block renders without server-seeded page data — the besigner preview,
    // or a page whose resolver didn't supply it. When the tenant page seeds
    // us it emits the same Product node server-side (AGL-660), and two
    // Product nodes for one item is worse than one, so we stand down.
    const structuredData =
      hostId && resolvedId && !seededProduct
        ? {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: resolved.name,
            ...(resolved.description
              ? { description: resolved.description }
              : {}),
            ...(resolved.mediaUrls.length
              ? { image: resolved.mediaUrls }
              : {}),
            offers: {
              '@type': 'Offer',
              priceCurrency: 'USD',
              price: String(variant?.priceUsd ?? 0),
              availability: variant?.soldOut
                ? 'https://schema.org/OutOfStock'
                : 'https://schema.org/InStock',
            },
          }
        : null

    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            display: 'flex',
            gap: 3,
            flexDirection: { xs: 'column', md: 'row' },
          },
          ...nodeSx,
        ]}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {galleryImage ? (
            <Box
              component="img"
              src={galleryImage}
              alt={resolved.name}
              // DELIBERATELY NOT DEFERRED (AGL-2486). This is the gallery
              // hero at the top of a product page — the one image on this
              // surface that really is the LCP candidate, and the browser
              // default here is already `eager`. Spreading
              // `DEFERRED_IMAGE_ATTRIBUTES` over it to "finish the job" is
              // the obvious next edit and it re-introduces the bug this
              // issue opened with: an LCP image not discovered until after
              // layout has run. The thumbnail strip below it IS deferred.
              //
              // No `fetchpriority` either, for the reason written out at
              // `image.tsx`: `high` is a claim about every other request in
              // flight, and a page whose real LCP is the product NAME would
              // pay for that claim.
              sx={{
                width: '100%',
                aspectRatio: '1 / 1',
                objectFit: 'cover',
                borderRadius: 1,
              }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                aspectRatio: '1 / 1',
                bgcolor: 'action.hover',
                borderRadius: 1,
              }}
            />
          )}
          {resolved.mediaUrls.length > 1 ? (
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              {resolved.mediaUrls.map((url, index) => (
                <Box
                  key={`${url}-${index}`}
                  component="img"
                  // Same resolver as the hero (AGL-1726) — a thumbnail is an
                  // `<img>` on the customer's page and leaks exactly as much.
                  src={Aglyn.siteRelativeMediaSrc(url, { hostId })}
                  alt=""
                  onClick={() => setActiveImage(index)}
                  sx={{
                    width: 56,
                    height: 56,
                    objectFit: 'cover',
                    borderRadius: 1,
                    cursor: 'pointer',
                    border: 2,
                    borderColor:
                      index === activeImage ? 'primary.main' : 'transparent',
                  }}
                  // Deferred (AGL-2486): 56px thumbnails that exist to swap
                  // the hero above. They were fetching eagerly ALONGSIDE
                  // that hero, so a five-image gallery had the hero
                  // competing with four thumbnails nobody had asked for yet.
                  {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
                />
              ))}
            </Box>
          ) : null}
        </Box>
        {structuredData ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: Aglyn.safeJsonLd(structuredData) }}
          />
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            {resolved.name}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              {`$${variant?.priceUsd ?? 0}${subscribing ? intervalSuffix : ''}`}
            </Typography>
            {subscribing && subscription?.trialDays ? (
              <Typography variant="caption" color="text.secondary">
                {`${subscription.trialDays}-day free trial`}
              </Typography>
            ) : null}
            {variant?.compareAtPriceUsd ? (
              <>
                <Typography
                  variant="body1"
                  color="text.disabled"
                  sx={{ textDecoration: 'line-through' }}
                >
                  {`$${variant.compareAtPriceUsd}`}
                </Typography>
                <Chip label="Sale" size="small" color="primary" />
              </>
            ) : null}
            {variant?.soldOut ? (
              <Chip label="Sold out" size="small" variant="outlined" />
            ) : null}
            <Button
              size="small"
              onClick={async () => {
                if (hostId && resolved.id !== 'sample') {
                  setWishlisted(await toggleWishlist(hostId, resolved.id, siteFetch))
                }
              }}
            >
              {wishlisted ? '♥ Saved' : '♡ Save'}
            </Button>
          </Box>
          {subscription && resolved.subscriptionOptional ? (
            <ToggleButtonGroup
              value={billing}
              exclusive
              size="small"
              onChange={(_event, value) => {
                if (value === 'once' || value === 'subscribe') {
                  setBilling(value)
                }
              }}
              sx={{ mb: 2 }}
            >
              <ToggleButton value="once">
                {`One-time $${variant?.priceUsd ?? 0}`}
              </ToggleButton>
              <ToggleButton value="subscribe">
                {`Subscribe $${variant?.priceUsd ?? 0}${intervalSuffix}`}
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          {resolved.options.map((option) => (
            <TextField
              key={option.name}
              label={option.name}
              value={selections[option.name] ?? ''}
              onChange={(event) =>
                setSelections((prev) => ({
                  ...prev,
                  [option.name]: event.target.value,
                }))
              }
              size="small"
              select
              fullWidth
              sx={{ mb: 1.5 }}
            >
              {option.values.map((value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          ))}
          {showCoupon ? (
            <TextField
              label="Discount code"
              value={coupon}
              onChange={(event) => setCoupon(event.target.value)}
              size="small"
              sx={{ mb: 2, display: 'block' }}
            />
          ) : null}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2 }}>
            <TextField
              label="Qty"
              value={quantity}
              onChange={(event) =>
                setQuantity(
                  Math.max(
                    1,
                    Math.min(99, Math.round(Number(event.target.value)) || 1),
                  ),
                )
              }
              size="small"
              sx={{ width: 80 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <Button
              variant="outlined"
              color="primary"
              size="large"
              disabled={!hostId || variant?.soldOut}
              onClick={handleAddToCart}
            >
              {added ? 'Added ✓' : 'Add to cart'}
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="large"
              disabled={
                !hostId ||
                status === 'sending' ||
                variant?.soldOut ||
                // No payments on this deployment: the same 501 every time, so
                // the control latches off rather than inviting a retry that
                // cannot succeed (AGL-2019).
                status === 'unconfigured' ||
                // Asked but unanswered: the server would only refuse again.
                (shipCountries !== null && !shipTo)
              }
              onClick={handleBuy}
              sx={{ flex: 1 }}
            >
              {variant?.soldOut
                ? 'Sold out'
                : status === 'sending'
                  ? // "Redirecting" is a lie once the form opens in place, and
                    // it is the shopper's only clue about what is about to
                    // happen to their page (AGL-1944).
                    nativeCheckout
                    ? 'Opening…'
                    : 'Redirecting…'
                  : buyLabel || (subscribing ? 'Subscribe' : 'Buy now')}
            </Button>
          </Box>
          {nativeCheckout ? (
            <Suspense fallback={<StorefrontPaymentElementFallback />}>
              <StorefrontPaymentElement
                clientSecret={nativeCheckout.clientSecret}
                publishableKey={nativeCheckout.publishableKey}
                payLabel={buyLabel || (subscribing ? 'Subscribe' : 'Pay now')}
                // Cancelling drops the form and leaves the session open —
                // deliberately. The shopper may come back to the same
                // attempt key, and an abandoned session is what the AGL-323
                // recovery emails are built on. Nothing is expired from the
                // browser: that is a write against the merchant's account.
                onCancel={() => setNativeCheckout(null)}
              />
            </Suspense>
          ) : null}
          {shipCountries ? (
            <TextField
              select
              label="Ship to"
              value={shipTo}
              onChange={(event) => setShipTo(event.target.value)}
              size="small"
              fullWidth
              helperText="Shipping rates depend on where this is going"
              sx={{ mb: 2 }}
            >
              {shipCountries.map((code) => (
                <MenuItem key={code} value={code}>
                  {CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {status === 'ask' || status === 'unconfigured' ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {message}
            </Alert>
          ) : null}
          {status === 'error' ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {message || 'Checkout is unavailable right now.'}
            </Alert>
          ) : null}
          {variant?.soldOut && hostId ? (
            notifyState === 'done' ? (
              <Alert severity="success" sx={{ mb: 2 }}>
                {'We will email you when it is back.'}
              </Alert>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  placeholder="you@example.com"
                  type="email"
                  // Third instance of the nameless-input defect (AGL-2392).
                  // Named for its job rather than "Email address": this row
                  // appears inside a product page that may also carry the
                  // newsletter block, and two fields both announced as
                  // "Email address" is barely better than none.
                  slotProps={{
                    htmlInput: {
                      'aria-label': 'Email address for back-in-stock alert',
                    },
                  }}
                  value={notifyEmail}
                  onChange={(event) => setNotifyEmail(event.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!notifyEmail.trim()}
                  onClick={async () => {
                    const response = await siteFetch(
                      '/api/commerce/notify-restock',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          hostId,
                          productId: resolved.id,
                          email: notifyEmail,
                        }),
                      },
                    ).catch(() => null)
                    if (response?.ok) setNotifyState('done')
                  }}
                >
                  {'Notify me'}
                </Button>
              </Box>
            )
          ) : null}
          {!hideDescription && resolved.description ? (
            <Typography variant="body1" color="text.secondary">
              {resolved.description}
            </Typography>
          ) : null}
        </Box>
      </Box>
    )
  },
)
ProductDetail.displayName = 'AglynProductDetail'

export const schema: Aglyn.ComponentSchema<ProductDetailProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Product detail',
  description: "One product's gallery, options and buy button.",
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiTagOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'slug',
      label: 'Product slug',
      description:
        'Pin to one product; blank follows the /products/{slug} URL ' +
        '(product page template).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'buyLabel',
      label: 'Buy button label',
      description: 'Defaults to "Buy now".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'hideDescription',
      label: 'Hide description',
      description: 'Design the description separately with tokens.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
    {
      // Off by default, so no existing page changes shape on deploy. The cart
      // has carried this field all along and the product page had none, so a
      // shopper buying the same goods through Buy now had nowhere to enter a
      // code the merchant had advertised.
      name: 'showCoupon',
      label: 'Show discount code field',
      description: 'Lets a buyer enter a discount or coupon code before buying.',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product detail',
    pluginId: BUNDLE_ID,
    description: 'Gallery, variant picker, and buy button for one product',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiTagOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    // Product page (AGL-561): the commerce-standard PDP subtree —
    // breadcrumb, detail, related products, reviews — for the product
    // page template screen. `{{product.name}}` resolves there via the
    // site page resolver's token pass (AGL-292); node shapes follow
    // the Sections & Blocks convention (AGL-539) and reference only
    // persisted component ids.
    $id: generatePresetId(ID, 'page'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Product page',
    pluginId: BUNDLE_ID,
    description:
      'Breadcrumb, product detail, related products, and reviews',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiTagOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: Aglyn.MUI_BUNDLE_ID,
      props: { spacing: 4 },
      // Styling on the node's own sx, never in props (AGL-1346): both
      // records render, but only `node.sx` is the one the Styles panel can
      // read, edit or clear.
      sx: { paddingTop: 2, paddingBottom: 2 },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: Aglyn.MUI_BUNDLE_ID,
          props: { direction: 'row', spacing: 1 },
          sx: { alignItems: 'center' },
          nodes: [
            {
              $id: null,
              componentId: 'muiScreenLink',
              pluginId: Aglyn.MUI_BUNDLE_ID,
              props: { children: 'Shop', size: 'small', color: 'inherit' },
            },
            {
              $id: null,
              componentId: 'muiTypography',
              pluginId: Aglyn.MUI_BUNDLE_ID,
              props: { variant: 'body2', children: '/ {{product.name}}' },
            },
          ],
        },
        {
          $id: null,
          componentId: ID,
          pluginId: BUNDLE_ID,
          props: {},
        },
        {
          $id: null,
          componentId: RELATED_PRODUCTS_ID,
          pluginId: BUNDLE_ID,
          props: {},
        },
        {
          $id: null,
          componentId: PRODUCT_REVIEWS_ID,
          pluginId: BUNDLE_ID,
          props: {},
        },
      ],
    },
  },
]

export default ProductDetail
