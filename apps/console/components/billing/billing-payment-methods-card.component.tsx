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
import EmbeddedCheckoutDialogComponent from '../embedded-checkout-dialog.component'
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
 * "Add new card" asks the server for a Stripe `mode=setup` Checkout session
 * and mounts its client secret in Stripe's own iframe — the same dialog the
 * upgrade path uses, which is the entire reason that dialog survives the move
 * to a native billing page. The PAN, CVC and expiry are typed into Stripe's
 * document and posted to Stripe; they are never in our DOM, never in a request
 * to our server, and never in a log. Everything around the iframe is ours.
 *
 * Reusing Embedded Checkout rather than mounting a Payment Element also means
 * wallets, Link and 3DS do not have to be rebuilt and re-verified for a second
 * card-entry surface.
 *
 * ## Why the empty state names the plan
 *
 * A card is attached to a Stripe customer, and an org that has never checked
 * out has no customer to attach one to. That is not a failure to explain away
 * — it is the honest shape of the thing, so the empty state says what unlocks
 * it rather than offering a button that could only fail.
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
   * Ask the route for a Stripe `mode=setup` session and mount its client
   * secret.
   *
   * The secret is held in local state and nowhere else: it is a short-lived
   * credential for ONE session, so parking it in the shared profile object
   * every card reads would keep it alive across renders with no use for it.
   */
  const openCardForm = async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({ action: 'begin-card-setup' })
      const secret = outcome.payload?.clientSecret
      if (outcome.ok && typeof secret === 'string') {
        setSetupClientSecret(secret)
      }
    } finally {
      dequeue()
      setBusy(false)
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
          {!loaded.customer ? (
            <Typography variant="body2" color="text.secondary">
              {'There are no payment methods yet. Upgrade to a paid plan to ' +
                'add a new one.'}
            </Typography>
          ) : loaded.paymentMethods.length === 0 ? (
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

          {loaded.customer && canManage ? (
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
          ) : null}

          {/*
            Stripe's own form, in a dialog. The card number is typed into
            Stripe's iframe and posted to Stripe — this component never sees
            it, and there is no callback here that could.
          */}
          <EmbeddedCheckoutDialogComponent
            clientSecret={setupClientSecret}
            onClose={() => {
              setSetupClientSecret(null)
              // The customer may have saved a card and then closed without
              // Stripe firing completion, so re-read rather than assume.
              reload()
            }}
            onComplete={() => {
              setSetupClientSecret(null)
              reload()
            }}
          />
        </Stack>
      )}
    </BillingProfileGateComponent>
  )
}

