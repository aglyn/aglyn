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

import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import { useMemo } from 'react'

/**
 * Pay for a plan without leaving the console (AGL-1132).
 *
 * Embedded Checkout rather than the Payment Element, deliberately: this is
 * our own chrome, so nobody expects the form to look like Aglyn, and keeping
 * Stripe's own form means wallets, 3DS and tax do not have to be rebuilt and
 * re-verified. The storefront is the opposite case and wants the Payment
 * Element — it is a merchant's site, and looking like Stripe is the thing
 * that costs them conversions.
 *
 * FULFILMENT DOES NOT HAPPEN HERE. The webhook
 * (`/api/billing/webhook`) is the only thing that grants a plan, exactly as
 * with the redirect flow. This component has no success callback for that
 * reason: an in-page flow makes trusting the browser tempting, and the
 * browser is the one participant that can lie about having paid. Stripe
 * returns the buyer to `return_url` and the billing page re-reads the org.
 */
export interface EmbeddedCheckoutDialogProps {
  /** Stripe session client secret; the dialog is closed while this is null. */
  clientSecret: string | null
  onClose: () => void
  /**
   * Stripe's own "the session completed" callback — the only moment in the
   * browser that knows a subscription was actually paid for.
   *
   * ⚠️ Not a substitute for the webhook. Entitlements come from Stripe's
   * server event and always will; this fires for the things that can only
   * happen in the page, and a visitor who closes the tab first simply does not
   * get them. Never gate access on it.
   */
  onComplete?: () => void
}

/**
 * `loadStripe` is module-level on purpose — it injects a script tag, and
 * calling it per render would add one per open. Null when unconfigured, which
 * the route also checks before ever choosing embedded mode.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
let stripePromise: Promise<Stripe | null> | null = null
function getStripe() {
  if (!publishableKey) return null
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

export function EmbeddedCheckoutDialogComponent({
  clientSecret,
  onClose,
  onComplete,
}: EmbeddedCheckoutDialogProps) {
  const stripe = useMemo(() => getStripe(), [])
  // Belt and braces with the route's own check: if the key is missing the
  // dialog renders nothing rather than an empty white box that looks like a
  // broken payment form.
  if (!clientSecret || !stripe) return null
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-label="Checkout"
    >
      <DialogContent sx={{ p: 0 }}>
        <EmbeddedCheckoutProvider
          stripe={stripe}
          /*
           * `onComplete` is read once, when the provider mounts — Stripe does
           * not re-read the options object. Spreading it conditionally rather
           * than always passing a wrapper keeps the redirect-mode session,
           * which has no completion in this page, from being handed a callback
           * that can never fire.
           */
          options={{ clientSecret, ...(onComplete ? { onComplete } : {}) }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </DialogContent>
    </Dialog>
  )
}

export default EmbeddedCheckoutDialogComponent
