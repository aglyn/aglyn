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

import { CheckoutProvider, PaymentElement, useCheckout } from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { useCallback, useMemo, useState } from 'react'

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
 */

export interface StorefrontPaymentElementProps {
  /** Stripe's instruction to the browser. Not a claim that money moved. */
  clientSecret: string
  publishableKey: string
  /** Shown on the pay button, so the merchant's own total reads through. */
  payLabel?: string
  /** Abandon the in-page form and return to the store. */
  onCancel?: () => void
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

function PaymentForm({
  payLabel,
  onCancel,
}: Pick<StorefrontPaymentElementProps, 'payLabel' | 'onCancel'>) {
  const checkout = useCheckout()
  const [status, setStatus] = useState<'idle' | 'confirming' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handlePay = useCallback(async () => {
    // Guarded rather than merely disabled: a disabled button is a rendering
    // fact, and a keyboard or a slow re-render can still land a second call
    // during a 3DS challenge.
    if (status === 'confirming') return
    setStatus('confirming')
    setMessage('')
    try {
      const result = await checkout.confirm()
      if (result?.type === 'error') {
        // A decline, an expired card, an incomplete field. Recoverable: the
        // form stays mounted with everything the shopper typed still in it.
        setMessage(
          String(result.error?.message ?? '') ||
            'That payment could not be completed. Try another card.',
        )
        setStatus('error')
        return
      }
      // Success does NOT mean fulfilled, and nothing is reported to our server
      // here. Stripe redirects to the `return_url` the session carries; if it
      // has not by the time this resolves, the confirm is still in flight and
      // the button stays disabled rather than inviting a second attempt.
    } catch {
      setMessage('That payment could not be completed. Try another card.')
      setStatus('error')
    }
  }, [checkout, status])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PaymentElement />
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
          disabled={status === 'confirming'}
          fullWidth
        >
          {status === 'confirming' ? 'Paying…' : payLabel || 'Pay now'}
        </Button>
        {onCancel ? (
          <Button
            variant="text"
            onClick={onCancel}
            disabled={status === 'confirming'}
          >
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
  onCancel,
}: StorefrontPaymentElementProps) {
  const stripe = useMemo(() => getStripe(publishableKey), [publishableKey])
  // Belt and braces with the server's own gate, which already refuses native
  // mode without a publishable key: rendering nothing beats rendering an empty
  // white box that looks like a broken payment form.
  if (!clientSecret || !stripe) return null
  return (
    <CheckoutProvider stripe={stripe} options={{ clientSecret }}>
      <Box sx={{ py: 2 }} data-testid="storefront-payment-element">
        <PaymentForm payLabel={payLabel} onCancel={onCancel} />
      </Box>
    </CheckoutProvider>
  )
}

/** Loading fallback for the lazy boundary the callers mount this behind. */
export function StorefrontPaymentElementFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
      <CircularProgress size={24} />
    </Box>
  )
}

export default StorefrontPaymentElement
