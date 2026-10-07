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

// The `/checkout` entry, not the main one: react-stripe-js v6 moved the
// Checkout Sessions provider, its hook and its own `PaymentElement` there, and
// the main entry's `PaymentElement` is the Elements one, which does not mount
// under a Checkout provider.
import {
  CheckoutElementsProvider,
  PaymentElement,
  ShippingAddressElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout'
// `/pure` deliberately, not the bare entry (AGL-2486). The bare entry ends
// with a module-scope `Promise.resolve().then(() => getStripePromise())`,
// so merely EVALUATING it injects the js.stripe.com/v3 script tag —
// 249 KB gzipped — on any page that reaches this module, whether or not
// `loadStripe` is ever called. `/pure` is the same API without that
// statement, so the script is fetched when we ask for it and not before.
import { loadStripe } from '@stripe/stripe-js/pure'
// The TYPE only, and from the bare entry because `/pure` does not re-export
// it. `import type` is erased entirely at compile time, so this adds no
// runtime import and cannot re-introduce the script injection above.
import type {
  Stripe,
  StripeAddressElementChangeEvent,
  StripeCheckoutElementsSdkOptions,
} from '@stripe/stripe-js'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  storefrontPaymentAppearance,
  storefrontPaymentFonts,
} from './storefront-payment-appearance'
import type { StorefrontCheckoutWallets } from '../model/commerce-payment-methods'

/**
 * The storefront Payment Element (AGL-1944) — the shopper pays on the
 * merchant's own domain instead of being sent to `checkout.stripe.com`.
 *
 * ## THIS COMPONENT DOES NOT FULFIL ANYTHING
 *
 * It has no success callback, and that absence is the design rather than an
 * omission. `libs/plugins/commerce/src/lib/server/billing-webhook.ts` creates
 * the order on `checkout.session.completed` and is the only thing that ever
 * does. An in-page flow makes trusting the browser far more tempting than a
 * redirect does — the form is right there, `confirm()` resolves in hand, and
 * posting "done, please fulfil" is one line away — and the browser is the one
 * participant in a payment that can lie about having paid.
 *
 * It is also the participant that can VANISH. A shopper who confirms and
 * closes the tab never runs a callback, so a flow that fulfils here loses the
 * order outright while keeping the money; a shopper who refreshes the return
 * page runs it twice. Neither is reachable from a design with no callback in
 * it. What happens after a successful confirm is a redirect to `return_url`,
 * carrying the `session_id` the server put there — so the page can SHOW the
 * shopper a result by looking the order up, without being TOLD the outcome by
 * this code.
 *
 * ## Declines and 3DS
 *
 * Both were handled for us by the redirect and now have to be handled here.
 *
 * A decline resolves as `{ type: 'error' }` and is rendered inline WITHOUT
 * unmounting the form: the shopper's basket, address and chosen method are all
 * still on screen and they can try another card. That is the whole difference
 * between a recoverable decline and a dead end, and it is why the error state
 * below sits beside the element rather than replacing it.
 *
 * A 3DS challenge is Stripe's own: `confirm()` presents the challenge and, for
 * redirect-based methods, sends the browser to `return_url` and back. Nothing
 * here has to model it — but the button must stay disabled across the whole
 * await, because a second `confirm()` during a challenge is exactly the
 * double-submit the server's idempotency claim exists to survive and there is
 * no reason to make it lean on that.
 *
 * ## Everything the hosted page collected, collected here (AGL-3606)
 *
 * The hosted page asked for an email, a shipping address and a shipping
 * method, and showed a running total. A `ui_mode: 'elements'` session asks
 * for none of that on its own — the Payment Element is only the payment
 * method — so each is mounted here, read off the SESSION rather than off
 * anything the storefront believes:
 *
 * - **Email.** A session created with `customer_email` (the cart's email
 *   field) already has one and Stripe refuses `updateEmail` on it, so it is
 *   shown read-only. Otherwise a required field, sent with `updateEmail`
 *   before `confirm()` — the receipt and the order's customer both come from
 *   it, and a sale without one is an order nobody can be told about.
 * - **Shipping.** Only when the session carries shipping options, which the
 *   server attaches only when the store ships to the destination. The
 *   Shipping Address Element collects the address (and, under Stripe Tax,
 *   is where the tax is computed from); the picker lists the session's own
 *   options and selects through `updateShippingOption`.
 * - **Tax address without shipping.** Left to the Payment Element, which
 *   collects the country and postal code Stripe Tax needs when the session
 *   has `automatic_tax` and no shipping address. A Billing Address Element
 *   there would make `updateBillingAddress` conflict with it.
 * - **The total.** Rendered from `session.total`, which Stripe recomputes on
 *   every address and option change — tax and shipping included — so the
 *   number on the button is the number charged.
 * - **The look.** `elementsOptions.appearance` and `fonts` come from the site
 *   theme (`storefront-payment-appearance.ts`), so Stripe's frames wear the
 *   merchant's palette, radius and typeface.
 *
 * ## Expired and redirect-returned sessions
 *
 * A session that expired, or that cannot be loaded, offers a fresh one through
 * `onRestart` (a NEW attempt key, so the server does not replay the dead
 * session). A redirect-based method that fails comes back to `return_url`
 * with the session still open; `use-checkout-return-notice.ts` reads that on
 * the return page and says nothing was charged.
 */

export interface StorefrontPaymentElementProps {
  /** Stripe's instruction to the browser. Not a claim that money moved. */
  clientSecret: string
  publishableKey: string
  /** Shown on the pay button, so the merchant's own total reads through. */
  payLabel?: string
  /**
   * An email the storefront already knows but did not put on the session
   * (it prefills the field; the shopper can still change it). A session the
   * server created WITH an email shows that one read-only instead.
   */
  defaultEmail?: string
  /** Abandon the in-page form and return to the store. */
  onCancel?: () => void
  /**
   * Open a fresh session after this one expired or could not be loaded. The
   * caller must mint a NEW attempt key first, or the server replays the dead
   * session for the old one.
   */
  onRestart?: () => void
  /**
   * The wallets the merchant hid (AGL-3629). Stripe cannot exclude Apple Pay,
   * Google Pay or Link on the session, so the Payment Element is told instead.
   * Absent means every wallet the device supports shows.
   */
  wallets?: StorefrontCheckoutWallets
}

/**
 * `loadStripe` injects a script tag, so it is memoized per key rather than
 * called per render. Keyed because a page could in principle mount this for
 * two different merchants; in practice it is one, and the map costs nothing.
 */
const stripePromises = new Map<string, Promise<Stripe | null>>()
function getStripe(publishableKey: string): Promise<Stripe | null> | null {
  if (!publishableKey) return null
  let promise = stripePromises.get(publishableKey)
  if (!promise) {
    promise = loadStripe(publishableKey)
    stripePromises.set(publishableKey, promise)
  }
  return promise
}

/** Test seam: `loadStripe` caches per key across a file's tests otherwise. */
export function __resetStripePromises(): void {
  stripePromises.clear()
}

const GENERIC_FAILURE = 'That payment could not be completed. Try another card.'

/** How long the address must sit still before the session re-prices on it. */
const ADDRESS_SETTLE_MS = 400

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography
        variant={strong ? 'subtitle1' : 'body2'}
        color={strong ? 'text.primary' : 'text.secondary'}
      >
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle1' : 'body2'}>{value}</Typography>
    </Box>
  )
}

function SessionNotice({
  message,
  onCancel,
  onRestart,
}: {
  message: string
  onCancel?: () => void
  onRestart?: () => void
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="error" role="alert">
        {message}
      </Alert>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {onRestart ? (
          <Button variant="contained" onClick={onRestart}>
            {'Start checkout again'}
          </Button>
        ) : null}
        {onCancel ? (
          <Button variant="text" onClick={onCancel}>
            {'Back to the store'}
          </Button>
        ) : null}
      </Box>
    </Box>
  )
}

function PaymentForm({
  payLabel,
  defaultEmail,
  onCancel,
  onRestart,
  wallets,
}: Pick<
  StorefrontPaymentElementProps,
  'payLabel' | 'defaultEmail' | 'onCancel' | 'onRestart' | 'wallets'
>) {
  // A `{ type: 'loading' | 'success' | 'error' }` union since react-stripe-js
  // v6: the session is not usable until Stripe.js has booted against it.
  const checkoutState = useCheckoutElements()
  const checkout =
    checkoutState.type === 'success' ? checkoutState.checkout : null
  const [status, setStatus] = useState<'idle' | 'confirming' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [emailError, setEmailError] = useState('')
  const [shippingBusy, setShippingBusy] = useState(false)

  /**
   * The email the SERVER put on the session, latched at first load. Stripe
   * refuses `updateEmail` on such a session, so it is shown, not edited. Read
   * once rather than live because the session's email also becomes set the
   * moment THIS form calls `updateEmail` — which must not turn the field the
   * shopper is typing in into read-only text.
   */
  const serverEmail = useRef<string | null | undefined>(undefined)
  if (checkout && serverEmail.current === undefined) {
    serverEmail.current = checkout.email ? String(checkout.email) : null
  }
  const emailLocked = Boolean(serverEmail.current)

  const sessionShippingOptions = checkout?.shippingOptions
  const shippingOptions = useMemo(
    () => sessionShippingOptions ?? [],
    [sessionShippingOptions],
  )
  const collectsShipping = shippingOptions.length > 0
  const selectedShippingId = checkout?.shipping?.shippingOption?.id ?? ''

  // The hosted page pre-selects the first rate, so the in-page one does too:
  // a session with options and no selection cannot be confirmed, and making
  // the shopper discover that at the pay button is a decline they did not
  // cause. Once per session — a later deselect is not something Stripe does.
  const autoSelected = useRef(false)
  useEffect(() => {
    if (!checkout || !collectsShipping || selectedShippingId) return
    if (autoSelected.current) return
    autoSelected.current = true
    void checkout.updateShippingOption(shippingOptions[0].id)
  }, [checkout, collectsShipping, selectedShippingId, shippingOptions])

  const chooseShipping = useCallback(
    async (id: string) => {
      if (!checkout || id === selectedShippingId) return
      setShippingBusy(true)
      try {
        const result = await checkout.updateShippingOption(id)
        if (result?.type === 'error') {
          setMessage(
            String(result.error?.message ?? '') ||
              'That shipping option could not be selected.',
          )
        }
      } finally {
        setShippingBusy(false)
      }
    },
    [checkout, selectedShippingId],
  )

  // Re-price on the address once it is complete and has stopped changing:
  // the Address Element fires per keystroke, and under Stripe Tax every
  // update is a tax calculation. Confirm sends the element's value anyway, so
  // this exists for the TOTAL — the shopper sees tax before they pay.
  const addressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (addressTimer.current) clearTimeout(addressTimer.current)
    },
    [],
  )
  const onShippingAddressChange = useCallback(
    (event: StripeAddressElementChangeEvent) => {
      if (!checkout || !event.complete) return
      if (addressTimer.current) clearTimeout(addressTimer.current)
      const { name, address } = event.value
      addressTimer.current = setTimeout(() => {
        void checkout
          .updateShippingAddress({ name, address })
          .catch(() => undefined)
      }, ADDRESS_SETTLE_MS)
    },
    [checkout],
  )

  const commitEmail = useCallback(async (): Promise<boolean> => {
    if (!checkout || emailLocked) return true
    const trimmed = email.trim()
    if (!trimmed) {
      setEmailError('Enter your email for the receipt.')
      return false
    }
    if (checkout.email === trimmed) return true
    const result = await checkout.updateEmail(trimmed)
    if (result?.type === 'error') {
      setEmailError(
        String(result.error?.message ?? '') || 'Enter a valid email address.',
      )
      return false
    }
    setEmailError('')
    return true
  }, [checkout, email, emailLocked])

  const handlePay = useCallback(async () => {
    // Guarded rather than merely disabled: a disabled button is a rendering
    // fact, and a keyboard or a slow re-render can still land a second call
    // during a 3DS challenge.
    if (status === 'confirming' || !checkout) return
    setStatus('confirming')
    setMessage('')
    try {
      if (!(await commitEmail())) {
        setStatus('idle')
        return
      }
      const result = await checkout.confirm()
      if (result?.type === 'error') {
        // A decline, an expired card, an incomplete field, a failed 3DS
        // challenge. Recoverable: the form stays mounted with everything the
        // shopper typed still in it.
        setMessage(String(result.error?.message ?? '') || GENERIC_FAILURE)
        setStatus('error')
        return
      }
      // Success does NOT mean fulfilled, and nothing is reported to our server
      // here. Stripe redirects to the `return_url` the session carries; if it
      // has not by the time this resolves, the confirm is still in flight and
      // the button stays disabled rather than inviting a second attempt.
    } catch {
      // A throw is an integration error on Stripe's side of the contract, not
      // something the shopper did; its text is not written for them.
      setMessage(GENERIC_FAILURE)
      setStatus('error')
    }
  }, [checkout, commitEmail, status])

  if (checkoutState.type === 'error') {
    // The session could not be loaded — expired, or already completed in
    // another tab. Nothing typed here could be charged, so say so and offer a
    // fresh session or the way back rather than a form that cannot submit.
    return (
      <SessionNotice
        message="This checkout could not be loaded. Start again, or return to the store."
        onCancel={onCancel}
        onRestart={onRestart}
      />
    )
  }

  if (!checkout) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={28} aria-label="Loading checkout" />
      </Box>
    )
  }

  if (checkout.status?.type === 'expired') {
    return (
      <SessionNotice
        message="This checkout expired before it was paid. Nothing was charged."
        onCancel={onCancel}
        onRestart={onRestart}
      />
    )
  }

  if (checkout.status?.type === 'complete') {
    // Paid in another tab, or the return redirect is already under way.
    // Offering a restart here would be offering to charge twice.
    return (
      <Alert severity="success" role="status">
        {'This order is already paid.'}
      </Alert>
    )
  }

  const total = checkout.total
  const busy = status === 'confirming'
  const discount = total?.discount?.minorUnitsAmount ?? 0
  const tax = total?.taxExclusive?.minorUnitsAmount ?? 0
  const taxPending = checkout.tax?.status && checkout.tax.status !== 'ready'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {emailLocked ? (
        <Typography variant="body2" color="text.secondary">
          {`Receipt to ${serverEmail.current}`}
        </Typography>
      ) : (
        <TextField
          type="email"
          label="Email"
          required
          fullWidth
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            if (emailError) setEmailError('')
          }}
          onBlur={() => {
            if (email.trim()) void commitEmail()
          }}
          error={Boolean(emailError)}
          helperText={emailError || 'Your receipt is sent here.'}
          disabled={busy}
        />
      )}
      {collectsShipping ? (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          data-testid="storefront-shipping"
        >
          <Typography variant="subtitle2">{'Shipping address'}</Typography>
          <ShippingAddressElement onChange={onShippingAddressChange} />
          <Typography variant="subtitle2">{'Shipping method'}</Typography>
          <RadioGroup
            aria-label="Shipping method"
            value={selectedShippingId}
            onChange={(event) => void chooseShipping(event.target.value)}
          >
            {shippingOptions.map((option) => (
              <FormControlLabel
                key={option.id}
                value={option.id}
                disabled={busy || shippingBusy}
                control={<Radio />}
                label={`${option.displayName || 'Shipping'} — ${option.amount}`}
              />
            ))}
          </RadioGroup>
        </Box>
      ) : null}
      <PaymentElement options={wallets ? { wallets } : undefined} />
      {total ? (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
          data-testid="storefront-checkout-total"
        >
          <SummaryRow label="Subtotal" value={total.subtotal.amount} />
          {discount ? (
            <SummaryRow label="Discount" value={`−${total.discount.amount}`} />
          ) : null}
          {collectsShipping ? (
            <SummaryRow
              label="Shipping"
              value={selectedShippingId ? total.shippingRate.amount : '—'}
            />
          ) : null}
          {tax || taxPending ? (
            <SummaryRow
              label="Tax"
              value={taxPending ? 'Calculated from your address' : total.taxExclusive.amount}
            />
          ) : null}
          <Divider />
          <SummaryRow label="Total" value={total.total.amount} strong />
        </Box>
      ) : null}
      {message ? (
        // `error` severity is right here and wrong for a lockdown pause — this
        // really is "your payment did not go through", which is the one thing
        // a shopper must be told plainly.
        <Alert severity="error" role="alert">
          {message}
        </Alert>
      ) : null}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          onClick={handlePay}
          disabled={busy || shippingBusy}
          fullWidth
        >
          {busy ? 'Paying…' : payLabel || 'Pay now'}
        </Button>
        {onCancel ? (
          <Button variant="text" onClick={onCancel} disabled={busy}>
            {'Cancel'}
          </Button>
        ) : null}
      </Box>
    </Box>
  )
}

export function StorefrontPaymentElement({
  clientSecret,
  publishableKey,
  payLabel,
  defaultEmail,
  onCancel,
  onRestart,
  wallets,
}: StorefrontPaymentElementProps) {
  const stripe = useMemo(() => getStripe(publishableKey), [publishableKey])
  const theme = useTheme()
  // Built once per session: the provider reads its options at mount and
  // ignores later changes, so a memo keyed on the theme as well would only
  // suggest a re-theme that never happens.
  const options = useMemo<StripeCheckoutElementsSdkOptions>(
    () => ({
      clientSecret,
      elementsOptions: {
        appearance: storefrontPaymentAppearance(theme),
        fonts: storefrontPaymentFonts(
          typeof theme.typography?.fontFamily === 'string'
            ? theme.typography.fontFamily
            : undefined,
        ),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientSecret],
  )
  // Belt and braces with the server's own gate, which already refuses native
  // mode without a publishable key: rendering nothing beats rendering an empty
  // white box that looks like a broken payment form.
  if (!clientSecret || !stripe) return null
  return (
    <CheckoutElementsProvider stripe={stripe} options={options}>
      <Box sx={{ py: 2 }} data-testid="storefront-payment-element">
        <PaymentForm
          payLabel={payLabel}
          defaultEmail={defaultEmail}
          onCancel={onCancel}
          onRestart={onRestart}
          wallets={wallets}
        />
      </Box>
    </CheckoutElementsProvider>
  )
}

/**
 * Re-exported so the old import path still resolves, but the definition now
 * lives in its own module (AGL-2486): a fallback imported FROM the lazily
 * loaded module drags that module into the eager bundle and cancels the
 * `lazy()`. Callers must import it from `./storefront-payment-element-fallback`
 * — importing it from here is exactly the bug, and re-exporting it does not
 * make that safe.
 */
export { StorefrontPaymentElementFallback } from './storefront-payment-element-fallback'

export default StorefrontPaymentElement
