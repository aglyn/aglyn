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

import { AddressElement, Elements, useElements } from '@stripe/react-stripe-js'
import { Alert, Box, Button, Stack, useTheme } from '@mui/material'
import { useMemo, useState } from 'react'
import { getBrowserStripe } from './browser-stripe'
import { stripeAppearanceFromTheme } from './stripe-elements-appearance'

/** A billing address, in the words the billing profile takes it. */
export interface BillingAddressValue {
  name: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

export interface BillingAddressFormProps {
  /** Hand back the address; the server saves it and says whether it took. */
  onConfirmed: (address: BillingAddressValue) => Promise<void> | void
  onCancel: () => void
}

function AddressFields({ onConfirmed, onCancel }: BillingAddressFormProps) {
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const element = elements?.getElement('address')
    if (!element) return
    setBusy(true)
    setError(null)
    try {
      const { complete, value } = await element.getValue()
      if (!complete) {
        setError('Enter the whole address: sales tax is calculated from it.')
        return
      }
      await onConfirmed({
        name: value.name,
        line1: value.address.line1,
        line2: value.address.line2 ?? '',
        city: value.address.city,
        state: value.address.state,
        postalCode: value.address.postal_code,
        country: value.address.country,
      })
    } catch {
      setError('That address could not be saved. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2}>
      <AddressElement options={{ mode: 'billing' }} />
      {error ? (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" disabled={!elements || busy} onClick={submit}>
          {busy ? 'Saving…' : 'Save address'}
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel}>
          {'Cancel'}
        </Button>
      </Stack>
    </Stack>
  )
}

/**
 * A billing address in Stripe's own Address Element, in our theme, for a
 * purchase that needs one before it can be taxed. It holds no card data, and
 * the address goes to the same `set-billing-address` action Billing's own card
 * uses, so the two cannot disagree.
 */
export default function BillingAddressFormComponent(props: BillingAddressFormProps) {
  const theme = useTheme()
  const stripe = useMemo(() => getBrowserStripe(), [])
  const appearance = useMemo(() => stripeAppearanceFromTheme(theme), [theme])
  if (!stripe) return null
  return (
    <Box>
      <Elements stripe={stripe} options={{ appearance }}>
        <AddressFields {...props} />
      </Elements>
    </Box>
  )
}
