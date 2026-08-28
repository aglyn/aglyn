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

import { PLAN_LABELS, type OrgPlan } from '@aglyn/aglyn'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import BillingAddressCardComponent from './billing-address-card.component'
import BillingPaymentMethodsCardComponent from './billing-payment-methods-card.component'
import BillingPlanQuoteComponent from './billing-plan-quote.component'
import BillingTaxIdCardComponent from './billing-tax-id-card.component'
import type { BillingProfile } from './use-billing-profile'

export interface BillingUpgradeDialogProps {
  /** The plan being bought; null closes the dialog. */
  plan: OrgPlan | null
  interval: 'month' | 'year'
  orgId?: string | null
  /** The page's single read of the Stripe customer, shared with the settings cards. */
  profile: BillingProfile
  canManage: boolean
  onClose: () => void
  /**
   * Subscribe. The SAME call the plan grid makes when nothing was missing —
   * the dialog collects, it does not buy, so there is exactly one subscribe
   * path and one place that handles SCA and the webhook's verdict.
   */
  onConfirm: () => Promise<void>
}

/**
 * Everything an upgrade needs, collected on the way to the upgrade.
 *
 * ## Why the button no longer refuses
 *
 * The plan grid used to disable Upgrade and name the two cards to go and fill
 * in first. That is a correct description of the requirement and a bad way to
 * sell anything: the customer arrived wanting to buy, and the product answered
 * with homework on another screen. This collects the same two pieces without
 * leaving the decision — one surface, in the order the pieces are actually
 * needed.
 *
 * ⚠️ THE SERVER STILL REFUSES. `/api/billing/checkout` answers 409
 * `payment_method_required` and 409 `billing_address_required`, and those are
 * the enforcement — this dialog is how a customer satisfies them, never a
 * replacement for them. A version of this change that also relaxed the route
 * would have removed the protection rather than moved it.
 *
 * ## The order is a tax rule, not a layout preference
 *
 * `automatic_tax` computes from the customer's address, and answers
 * `requires_location_inputs` — a tax of zero, on a total that looks final —
 * when there is not one. So the quote is not even MOUNTED until an address is
 * on file; there is no arrangement of this screen in which a total appears
 * before the address it was computed from.
 *
 * The tax ID sits between them for the same reason one step further on. A
 * VAT-registered business in the EU or UK gets reverse charge only if Stripe
 * knows the registration when it prices the invoice; an ID added afterwards
 * changes nothing about the charge that already happened. It is offered above
 * the quote, and the quote re-prices when one is added.
 *
 * ## Nothing here is a second copy of anything
 *
 * The four sections are the console's own billing cards, rendered as they are
 * on the settings page. That is what makes the payment method PERSIST: adding
 * a card here runs the same `create-setup-intent` → `finalize-card-setup` pair
 * as adding one from settings, so it is attached to the org's Stripe customer
 * and becomes the default. It is not a one-off token for this charge, and the
 * customer is never asked for it again.
 *
 * It is also why Stripe's embedded checkout panel is not here. Every method
 * that panel offered — Link, bank debits, Cash App, Klarna — is offered by the
 * `PaymentElement` these cards already mount.
 */
export default function BillingUpgradeDialogComponent({
  plan,
  interval,
  orgId,
  profile,
  canManage,
  onClose,
  onConfirm,
}: BillingUpgradeDialogProps) {
  const [busy, setBusy] = useState(false)
  /** The optional tax-ID section, revealed by the customer rather than by us. */
  const [taxIdOpen, setTaxIdOpen] = useState(false)

  const loaded = profile.loadState === 'loaded' ? profile.state : null
  const hasAddress = Boolean(loaded?.customer?.address?.country)
  const hasMethod = (loaded?.paymentMethods ?? []).length > 0
  const hasTaxId = (loaded?.taxIds ?? []).length > 0

  /**
   * What the quote was priced against.
   *
   * The quote fetches once per plan/interval, which is right on the billing
   * page and wrong here: this is the one screen where the two INPUTS to a tax
   * calculation change while the quote is on screen. Keying the component on
   * them remounts it — so saving an address, or adding a VAT number, re-prices
   * instead of leaving a stale total under a changed customer.
   *
   * The payment method is deliberately not in the key. It cannot change a
   * price, and re-quoting on it would spend a Stripe call to display the same
   * number.
   */
  const quoteKey = useMemo(
    () =>
      [
        loaded?.customer?.address?.country ?? '',
        loaded?.customer?.address?.postalCode ?? '',
        (loaded?.taxIds ?? []).map((taxId) => taxId.id).join(','),
      ].join('|'),
    [loaded?.customer?.address, loaded?.taxIds],
  )

  // A dialog that closed and reopened for another plan starts clean rather
  // than holding the last visit's disclosure open.
  useEffect(() => {
    if (!plan) setTaxIdOpen(false)
  }, [plan])

  if (!plan) return null

  const planLabel = PLAN_LABELS[plan] ?? plan
  const ready = hasAddress && hasMethod

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="billing-upgrade-title"
    >
      <DialogTitle id="billing-upgrade-title">
        {`Upgrade to ${planLabel}`}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {/* ── 1. The address, because the tax comes from it ── */}
          {hasAddress ? (
            <Typography variant="body2" color="text.secondary">
              {'Billing address on file — your invoices and the sales tax on ' +
                'them use it.'}
            </Typography>
          ) : (
            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Billing address'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {'Sales tax is calculated from this address, so it is needed ' +
                  'before we can show you a total.'}
              </Typography>
              <BillingAddressCardComponent
                profile={profile}
                canManage={canManage}
              />
            </Stack>
          )}

          {/*
            ── 2. The tax ID, while it can still change the charge ──

            Offered, not demanded: most customers have no registration to give,
            and whether one changes the outcome is Stripe's determination and
            depends on jurisdiction — so this raises the question rather than
            answering it. Placed ABOVE the quote because that is the whole
            point; the same prompt after a charge is an apology.
          */}
          {hasTaxId ? (
            <Typography variant="body2" color="text.secondary">
              {'Tax ID on file — it appears on your invoices and is included ' +
                'in the total below.'}
            </Typography>
          ) : taxIdOpen ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Tax ID'}</Typography>
              <BillingTaxIdCardComponent
                profile={profile}
                canManage={canManage}
              />
            </Stack>
          ) : (
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => setTaxIdOpen(true)}
            >
              {'Registered for VAT, GST or a similar business tax? Add a tax ID'}
            </Button>
          )}

          {/* ── 3. The payment method, saved to this workspace ── */}
          {hasMethod ? (
            <Typography variant="body2" color="text.secondary">
              {'Payment method on file — the first invoice and every renewal ' +
                'are charged to it.'}
            </Typography>
          ) : (
            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Payment method'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {'Saved to this workspace, so renewals are charged to it and ' +
                  'you are not asked for it again.'}
              </Typography>
              <BillingPaymentMethodsCardComponent
                profile={profile}
                canManage={canManage}
              />
            </Stack>
          )}

          <Divider />

          {/*
            ── 4. The total, WITH tax ──

            Mounted only once there is an address. Rendering it earlier would
            put a confident-looking total on screen that Stripe had computed no
            tax for, which is the exact failure the quote was built to prevent.
          */}
          {hasAddress ? (
            <BillingPlanQuoteComponent
              key={quoteKey}
              orgId={orgId}
              plan={plan}
              interval={interval}
              canManage={canManage}
            />
          ) : (
            <Alert severity="info">
              {'Add your billing address above to see what this plan costs ' +
                'with tax included.'}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {'Cancel'}
        </Button>
        {/*
          Disabled only on what the SERVER would refuse, and named as the
          purchase it is. This is not the old gate returning: the customer can
          reach it from the plan grid with nothing on file, and everything it
          waits on is collected on this same screen.
        */}
        <Button
          variant="contained"
          disabled={busy || !ready || !canManage}
          onClick={() => void confirm()}
        >
          {busy ? 'Subscribing…' : `Subscribe to ${planLabel}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
