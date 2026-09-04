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

import { useConfirmationContext, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import BillingProfileGateComponent from './billing-profile-gate.component'
import BillingCardFormComponent from './billing-card-form.component'
import type { BillingPaymentMethod, BillingProfile } from './use-billing-profile'

export interface BillingPaymentMethodsCardProps {
  profile: BillingProfile
  /** billing.manage: the actions act; read-only otherwise. */
  canManage: boolean
}

/**
 * The cards on file.
 *
 * ## The card number never touches us
 *
 * "Add new card" asks the server for a SetupIntent and mounts it in Stripe
 * Elements, INLINE in this card. Every field is its own cross-origin iframe on
 * Stripe's domain, so the PAN, CVC and expiry are typed into Stripe's document
 * and posted to Stripe; they are never in our DOM, never in a request to our
 * server, and never in a log. Everything around those fields is ours.
 *
 * Inline rather than the modal this replaced: an interface that appears
 * unbidden, looks like a different product and then asks for payment details
 * is a reason to stop being a customer. That objection is about PRESENTATION
 * and is answerable without weakening anything — Elements' `appearance` takes
 * our own theme, so the fields render at our sizes, in our type, between our
 * own inputs, and the card-data guarantee is untouched.
 *
 * ## No plan is required to put a card on file
 *
 * A card attaches to a Stripe CUSTOMER, not to a subscription. The customer
 * used to be minted only by Checkout, which is the only reason this card ever
 * asked for a plan first — an implementation detail wearing the clothes of a
 * rule. The route creates one on demand at the moment a card is added, so the
 * button is offered whatever the plan state is.
 */
function describeMethod(method: BillingPaymentMethod): string {
  // Not card-only. Link and the wallet methods have no `.card` at all and
  // identify by email; rendering them through a card-shaped template is what
  // once printed a Link method as "No payment method" (AGL-940).
  if (method.last4) {
    const brand = method.brand ?? method.type ?? 'Card'
    return `${brand.toUpperCase()} •••• ${method.last4}`
  }
  if (method.email) return `${method.type ?? 'Wallet'} · ${method.email}`
  return method.type ?? 'Payment method'
}

function describeExpiry(method: BillingPaymentMethod): string | null {
  if (!method.expMonth || !method.expYear) return null
  return `Expires ${String(method.expMonth).padStart(2, '0')}/${method.expYear}`
}

export default function BillingPaymentMethodsCardComponent({
  profile,
  canManage,
}: BillingPaymentMethodsCardProps) {
  const { state, loadState, reload, request } = profile
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Ask the route for a SetupIntent and mount its client secret.
   *
   * The secret is held in local state and nowhere else: it is a short-lived
   * credential for ONE intent, so parking it in the shared profile object
   * every card reads would keep it alive across renders with no use for it.
   */
  const openCardForm = async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({ action: 'create-setup-intent' })
      const secret = outcome.payload?.clientSecret
      if (outcome.ok && typeof secret === 'string') {
        setSetupClientSecret(secret)
      }
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  /**
   * Stripe says the card is saved; the SERVER decides what that means.
   *
   * The intent id goes back to `finalize-card-setup`, which re-reads it from
   * Stripe, checks it succeeded and belongs to this org's customer, and makes
   * a first card the default. None of that is decided here — the browser is
   * the one participant in this exchange that can lie about it.
   */
  const cardConfirmed = async (setupIntentId: string) => {
    setSetupClientSecret(null)
    const outcome = await request({
      action: 'finalize-card-setup',
      setupIntentId,
    })
    if (outcome.ok) {
      enqueueSnackbar('Card saved.', { variant: 'success', persist: false })
    }
  }

  const makeDefault = async (paymentMethodId: string) => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({ action: 'set-default-card', paymentMethodId })
      if (outcome.ok) {
        enqueueSnackbar('Default payment method updated.', {
          variant: 'success',
          persist: false,
        })
      }
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  const removeCard = async (method: BillingPaymentMethod) => {
    const accepted = await confirm({
      title: 'Remove this payment method?',
      description:
        `${describeMethod(method)} will be detached from your billing ` +
        'account. Invoices already paid are unaffected.',
      confirmationText: 'Remove it',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({
        action: 'remove-card',
        paymentMethodId: method.id,
      })
      if (outcome.ok) {
        enqueueSnackbar('Payment method removed.', {
          variant: 'success',
          persist: false,
        })
      }
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  return (
    <BillingProfileGateComponent
      loadState={loadState}
      state={state}
      onRetry={reload}
      subject="payment methods"
    >
      {(loaded) => (
        <Stack spacing={2}>
          {loaded.paymentMethods.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'There are no payment methods yet.'}
            </Typography>
          ) : (
            <List dense disablePadding>
              {loaded.paymentMethods.map((method) => (
                <ListItem key={method.id} disableGutters>
                  <ListItemText
                    primary={
                      <Stack
                        direction="row"
                        spacing={1}
                        component="span"
                        sx={{ alignItems: 'center' }}
                      >
                        <span>{describeMethod(method)}</span>
                        {method.isDefault ? (
                          <Chip
                            component="span"
                            label="Default"
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                        ) : null}
                      </Stack>
                    }
                    secondary={describeExpiry(method)}
                    slotProps={{ primary: { component: 'div' } }}
                  />
                  {canManage ? (
                    <Stack direction="row" spacing={1}>
                      {method.isDefault ? null : (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => makeDefault(method.id)}
                        >
                          {'Make default'}
                        </Button>
                      )}
                      <Button
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() => removeCard(method)}
                      >
                        {'Remove'}
                      </Button>
                    </Stack>
                  ) : null}
                </ListItem>
              ))}
            </List>
          )}

          {/*
            Offered with or without a subscription. A card needs a Stripe
            CUSTOMER, not a plan — and someone putting one on file before they
            upgrade is a customer trying to pay us. The route creates the
            customer on demand when the setup intent is asked for.
          */}
          {canManage ? (
            setupClientSecret ? (
              /*
                Stripe's fields, inline. Nothing opens over the page and the
                customer stays exactly where they were.
              */
              <BillingCardFormComponent
                clientSecret={setupClientSecret}
                onConfirmed={cardConfirmed}
                onCancel={() => setSetupClientSecret(null)}
              />
            ) : (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={busy}
                  onClick={openCardForm}
                >
                  {'Add new card'}
                </Button>
              </Stack>
            )
          ) : null}
        </Stack>
      )}
    </BillingProfileGateComponent>
  )
}

