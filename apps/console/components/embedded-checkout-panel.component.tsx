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
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

/**
 * Pay for a plan without leaving the console (AGL-1132), IN PLACE.
 *
 * ## Why this is no longer a modal
 *
 * It was a `Dialog`. An interface that appears over the page, looks like a
 * different product and then asks for payment details is a reason to stop
 * being a customer — so nothing opens any more: the checkout renders in the
 * flow of the billing page, under the plan the customer just chose, with a
 * heading and a way back that are ours.
 *
 * ## Why it is still Stripe's checkout and not our own fields
 *
 * The card ENTRY moved to inline Elements (`billing-card-form.component`),
 * because adding a card is a settings action. A plan PURCHASE is not: this
 * session carries `automatic_tax`, `tax_id_collection`, address collection,
 * promotion codes, wallets, 3DS and the metered line item, and several of
 * those are load-bearing for a tax position rather than for a layout.
 * Rebuilding them behind our own form would make this code the thing that
 * decides whether a customer is charged the right tax — which is the one
 * responsibility worth accepting Stripe's visual language for.
 *
 * FULFILMENT DOES NOT HAPPEN HERE. The webhook (`/api/billing/webhook`) is
 * the only thing that grants a plan, exactly as with the redirect flow. This
 * component has no success callback for that reason: an in-page flow makes
 * trusting the browser tempting, and the browser is the one participant that
 * can lie about having paid. Stripe returns the buyer to `return_url` and the
 * billing page re-reads the org.
 */
export interface EmbeddedCheckoutPanelProps {
  /** Stripe session client secret; the panel renders nothing while null. */
  clientSecret: string | null
  /** Abandon the checkout and return to the plan grid. */
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

export function EmbeddedCheckoutPanelComponent({
  clientSecret,
  onClose,
  onComplete,
}: EmbeddedCheckoutPanelProps) {
  const stripe = useMemo(() => getStripe(), [])
  // Belt and braces with the route's own check: if the key is missing this
  // renders nothing rather than an empty white box that looks like a broken
  // payment form.
  if (!clientSecret || !stripe) return null
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        p: 2,
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
      >
        <Typography variant="h6" component="div">
          {'Complete your upgrade'}
        </Typography>
        {/* A way back that belongs to us. A modal had a dismiss affordance for
            free; rendering in place means the exit has to be stated. */}
        <Button size="small" onClick={onClose}>
          {'Cancel'}
        </Button>
      </Stack>
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
    </Box>
  )
}

export default EmbeddedCheckoutPanelComponent
