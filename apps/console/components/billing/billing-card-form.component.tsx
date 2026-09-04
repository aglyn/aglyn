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
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { Alert, Box, Button, Stack, useTheme } from '@mui/material'
import { useMemo, useState } from 'react'
import { getBrowserStripe } from '../../utils/browser-stripe'
import { stripeAppearanceFromTheme } from '../../utils/stripe-elements-appearance'

/**
 * Add a card WITHOUT leaving the page or the design (AGL follow-up to the
 * native billing surface).
 *
 * ## Why this is not a dialog any more
 *
 * It used to open Stripe's hosted checkout in a modal. Being asked for
 * payment details by an interface that has just appeared and looks like a
 * different product is a reason to stop being a customer — and that reaction
 * is about PRESENTATION, not about where the card data goes.
 *
 * Elements answers exactly that half. Each field is its own cross-origin
 * iframe on Stripe's domain, so the guarantee is unchanged — the PAN, the CVC
 * and the expiry are typed into Stripe's document and posted to Stripe, and
 * never touch our DOM, our server or our logs. What changes is that the
 * fields render inline, at our sizes, in our type, with our Save button
 * beside them.
 *
 * ## The part that is easy to get wrong
 *
 * `appearance` must carry LITERAL colors. Elements paints inside Stripe's
 * origin, where our CSS custom properties do not exist, so a
 * `var(--mui-palette-…)` string resolves to nothing and the field silently
 * falls back to Stripe's default styling. `stripeAppearanceFromTheme`
 * resolves them against the document before they cross that boundary.
 *
 * ## Fulfilment still is not here
 *
 * Confirming a SetupIntent saves a card; it grants nothing. The default is
 * set server-side in `finalize-card-setup`, which re-reads the intent from
 * Stripe rather than trusting this component's word that it succeeded.
 */

export interface BillingCardFormProps {
  /** SetupIntent client secret from `create-setup-intent`. */
  clientSecret: string
  /** Hand back the confirmed intent id; the server verifies it from there. */
  onConfirmed: (setupIntentId: string) => Promise<void> | void
  onCancel: () => void
}

function CardFields({ onConfirmed, onCancel }: Omit<BillingCardFormProps, 'clientSecret'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  /** Stripe's own refusal for the card just submitted, or null. */
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    try {
      // `redirect: 'if_required'` keeps the customer here for an ordinary
      // card. A bank that demands 3DS still gets its own Stripe-hosted step —
      // that one is the issuer's and is not ours to restyle or skip.
      const result = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      })
      if (result.error) {
        // Stripe's own sentence. It names what the issuer or the validator
        // objected to, which is what the customer needs in order to fix it,
        // and it stays true as the rules change.
        setError(result.error.message ?? 'That card could not be saved.')
        return
      }
      const setupIntentId = result.setupIntent?.id
      if (!setupIntentId) {
        setError('That card could not be saved. Nothing has changed.')
        return
      }
      await onConfirmed(setupIntentId)
    } catch {
      setError('We could not reach Stripe. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2}>
      {/*
        Stripe's fields. There is deliberately no input of ours anywhere in
        this component — `billing-card-entry-stays-in-stripe.spec.ts` sweeps
        for one, and that guard is what keeps "looks like our form" from
        drifting into "is our form".
      */}
      <PaymentElement options={{ layout: 'tabs' }} />
      {error ? (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          size="small"
          disabled={!stripe || busy}
          onClick={submit}
        >
          {busy ? 'Saving…' : 'Save card'}
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel}>
          {'Cancel'}
        </Button>
      </Stack>
    </Stack>
  )
}

export default function BillingCardFormComponent({
  clientSecret,
  onConfirmed,
  onCancel,
}: BillingCardFormProps) {
  const theme = useTheme()
  const stripe = useMemo(() => getBrowserStripe(), [])
  // Rebuilt when the scheme flips, so a customer who switches to dark mode
  // mid-form does not keep a light card form.
  const appearance = useMemo(
    () => stripeAppearanceFromTheme(theme),
    [theme],
  )
  if (!stripe) return null
  return (
    <Box>
      <Elements stripe={stripe} options={{ clientSecret, appearance }}>
        <CardFields onConfirmed={onConfirmed} onCancel={onCancel} />
      </Elements>
    </Box>
  )
}
