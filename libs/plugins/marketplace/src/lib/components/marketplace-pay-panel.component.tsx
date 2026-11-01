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

import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import type { BillingAddressValue } from '@aglyn/shared-ui-jsx/stripe/billing-address-form.component'
import { LazyBillingAddressForm, LazyBillingCardForm } from '@aglyn/shared-ui-jsx/stripe/lazy-stripe'
import { Alert, Button, CircularProgress, Divider, Stack, Typography } from '@mui/material'
import { Suspense } from 'react'
import {
  formatPayCents,
  payCardLabel,
  type PayPrerequisite,
  type PayQuote,
} from '../model/marketplace-pay'

/** Which part of paying for a listing is on screen. */
export type PayStep =
  | { kind: 'confirm'; quote: PayQuote }
  /** A card is needed, and this person can add one: `null` until its form has a secret. */
  | { kind: 'card'; clientSecret: string | null }
  | { kind: 'address' }
  /** Something is needed that this person cannot add. */
  | { kind: 'ask-billing'; need: PayPrerequisite; amountCents: number | null }

export interface MarketplacePayPanelProps {
  step: PayStep
  listingName: string
  busy: boolean
  /** Stripe's reason, or ours, for the last thing that did not go through. */
  error: string | null
  /** The workspace's Billing page, when its address is known. */
  billingHref?: string | null
  onPay: () => void
  onCardSaved: (setupIntentId: string) => Promise<void> | void
  onAddressSaved: (address: BillingAddressValue) => Promise<void> | void
  onCancel: () => void
}

const SUMMARY_LINE_SX = { justifyContent: 'space-between' } as const

function SummaryLine(props: { label: string; value: string; strong?: boolean }) {
  const variant = props.strong ? 'subtitle2' : 'body2'
  return (
    <Stack direction="row" spacing={2} sx={SUMMARY_LINE_SX}>
      <Typography variant={variant}>{props.label}</Typography>
      <Typography variant={variant}>{props.value}</Typography>
    </Stack>
  )
}

const FormLoading = () => <CircularProgress size={24} aria-label="Loading the card form" />

/**
 * Paying for a listing, in place (AGL-4049).
 *
 * Inline, under the button that asked for it, in the listing's sidebar and in
 * Create site alike, for the reason the billing card form is inline: a payment
 * surface that appears over the page and looks like a different product is a
 * reason to stop buying. Nothing here is a Dialog, and the card and address
 * fields are Stripe's own, so the card data guarantee is the billing page's.
 *
 * The total is on screen before the Pay button is: a saved card charged
 * without one is not a purchase anybody agreed to.
 *
 * Figma: "Aglyn Console (web)" → page "Marketplace · Publish & review" →
 * section "✅ CURRENT · Paying in the console", and page "Sites · Create site"
 * → frames "Choose your starter · Buy (card on file)" and "· Buy (add a card)".
 */
export function MarketplacePayPanel(props: MarketplacePayPanelProps) {
  const { step, listingName, busy, error, billingHref, onPay, onCardSaved, onAddressSaved, onCancel } =
    props
  const failure = error ? (
    <Alert severity="warning" data-marketplace-pay-error>
      {error}
    </Alert>
  ) : null

  if (step.kind === 'confirm') {
    const { quote } = step
    return (
      <Stack spacing={1.5} data-marketplace-pay="confirm">
        <Typography variant="subtitle2">{`Buy ${quote.listingName}`}</Typography>
        <Stack spacing={0.5}>
          <SummaryLine label="Price" value={formatPayCents(quote.amountCents)} />
          <SummaryLine label="Sales tax" value={formatPayCents(quote.taxCents)} />
          <Divider />
          <SummaryLine label="Total" value={formatPayCents(quote.totalCents)} strong />
        </Stack>
        {quote.canPay ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {`Charged to ${payCardLabel(quote.card)}. The receipt lands in Billing.`}
            </Typography>
            {/* A card that will not pay is changed in Billing: the way there is beside the reason. */}
            {error ? (
              <PrerequisiteNotice severity="warning" href={billingHref ?? undefined} actionLabel="Open Billing">
                {error}
              </PrerequisiteNotice>
            ) : null}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" size="small" disabled={busy} onClick={onPay}>
                {busy ? 'Paying…' : `Pay ${formatPayCents(quote.totalCents)}`}
              </Button>
              <Button size="small" disabled={busy} onClick={onCancel}>
                {'Cancel'}
              </Button>
            </Stack>
          </>
        ) : (
          <>
            <PrerequisiteNotice severity="warning">
              {`Buying this charges your workspace's card, which takes the "${orgPermissionLabel('billing.manage')}" permission. Ask someone who manages billing to buy it.`}
            </PrerequisiteNotice>
            <Stack direction="row">
              <Button size="small" onClick={onCancel}>
                {'Close'}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    )
  }

  if (step.kind === 'card') {
    return (
      <Stack spacing={1.5} data-marketplace-pay="card">
        <Typography variant="subtitle2">{`Add a card to buy ${listingName}`}</Typography>
        <Typography variant="body2" color="text.secondary">
          {'It stays on file for this workspace, in Billing, where you can change or remove it.'}
        </Typography>
        {failure}
        <Suspense fallback={<FormLoading />}>
          {step.clientSecret ? (
            <LazyBillingCardForm
              clientSecret={step.clientSecret}
              onConfirmed={onCardSaved}
              onCancel={onCancel}
            />
          ) : (
            <FormLoading />
          )}
        </Suspense>
      </Stack>
    )
  }

  if (step.kind === 'address') {
    return (
      <Stack spacing={1.5} data-marketplace-pay="address">
        <Typography variant="subtitle2">{'Add a billing address'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {'Sales tax is calculated from it. It stays on file for this workspace, in Billing.'}
        </Typography>
        {failure}
        <Suspense fallback={<FormLoading />}>
          <LazyBillingAddressForm onConfirmed={onAddressSaved} onCancel={onCancel} />
        </Suspense>
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5} data-marketplace-pay="ask-billing">
      {step.amountCents === null ? null : (
        <SummaryLine label="Price" value={formatPayCents(step.amountCents)} />
      )}
      <PrerequisiteNotice severity="warning">
        {`${
          step.need === 'card_required'
            ? 'This workspace needs a card on file to buy this.'
            : 'This workspace needs a billing address to buy this: sales tax is calculated from it.'
        } Someone with the "${orgPermissionLabel('billing.manage')}" permission can add it in Billing.`}
      </PrerequisiteNotice>
      <Stack direction="row">
        <Button size="small" onClick={onCancel}>
          {'Close'}
        </Button>
      </Stack>
    </Stack>
  )
}

export default MarketplacePayPanel
