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

import { parseLockdownRefusal, type LockdownRefusalNotice } from '@aglyn/aglyn'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import LockdownNotice from '../lockdown-notice.component'
import { taxExplanation } from '../../utils/tax-explanation'

/** What `/api/billing/checkout` `action: 'preview'` answers with. */
interface QuoteState {
  preview?: {
    subtotalCents: number
    taxCents: number
    totalCents: number
    currency: string
    taxComplete: boolean
    taxReason: string | null
    /** What the discounts took off, positive cents; absent on older payloads. */
    discountCents?: number
  }
  customerTaxExempt?: string | null
  hasTaxId?: boolean
  promotionCodeApplied?: string | null
  needsBillingDetails?: boolean
  needsBillingAddress?: boolean
}

export interface BillingPlanQuoteProps {
  orgId?: string | null
  /** The plan being quoted, or null when nothing is selected. */
  plan: string | null
  interval: 'month' | 'year'
  canManage: boolean
  /**
   * The code Stripe resolved and applied to the quote above, or '' for none.
   *
   * ⚠️ Owned by the page, not by this card. The purchase is made by
   * `startSubscribe` on the Billing page and the code has to reach the body it
   * POSTs; held in this component's own `useState` it reached the preview and
   * nothing else, so the quote re-priced, this card said the total already
   * included the code, and the card was charged the undiscounted amount.
   */
  appliedCode: string
  /**
   * Report what the SERVER applied — never what was typed.
   *
   * The value handed back is `promotionCodeApplied` off the priced preview, so
   * a code Stripe declined to resolve leaves the page's copy empty and cannot
   * be carried into a purchase as though it had worked.
   */
  onAppliedCodeChange: (code: string) => void
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/**
 * What this plan will actually cost, tax included, BEFORE anything is charged.
 *
 * ## Why this exists at all
 *
 * Checkout displayed the tax as the address was typed, and deleting Checkout
 * deleted that. Rebuilding it as a client-side sum would be worse than
 * nothing: a total our arithmetic produced and Stripe's invoice then
 * contradicts is the number that ends up in front of a tax authority. So the
 * figures come from Stripe's own invoice preview, and the only thing computed
 * here is which sentence explains them.
 *
 * ## The zero that has four meanings
 *
 * `taxCents: 0` can mean reverse charge applied, the customer is exempt, the
 * jurisdiction charges nothing — or that Stripe could not compute it at all,
 * because `automatic_tax` answers `requires_location_inputs` with a tax of
 * zero. The last one is not a quote, it is a guess, and it is the one a
 * customer would discover on the invoice. `taxExplanation` separates them and
 * says which; a total that is not final is not shown as one.
 *
 * ## The promotion code
 *
 * Checkout's "Add promotion code" box was the only way a code could be
 * redeemed, and it went with the panel. This is its replacement, on the
 * resolve-then-apply path the route already had: `discounts[0][promotion_code]`
 * takes the code's ID, never the string a customer types, so the server looks
 * it up and reports whether it resolved. An invalid or expired code says so
 * HERE — before anything is charged — rather than failing at the purchase.
 */
export default function BillingPlanQuoteComponent({
  orgId,
  plan,
  interval,
  canManage,
  appliedCode,
  onAppliedCodeChange,
}: BillingPlanQuoteProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const [quote, setQuote] = useState<QuoteState | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  /**
   * A checkout feature lockdown, held PARSED rather than flattened (AGL-1558).
   *
   * The quote rides `/api/billing/checkout`, which staff can lock over a live
   * billing bug. The customer reading a 423 here is mid-purchase and wondering
   * whether they were charged, and the two fields a snackbar cannot carry —
   * the support address and the expected-back line — are exactly the two that
   * answer that.
   */
  const [lockdown, setLockdown] = useState<LockdownRefusalNotice | null>(null)

  const fetchQuote = useCallback(
    async (promotionCode: string) => {
      if (!orgId || !plan || !user) return
      setBusy(true)
      setFailed(false)
      try {
        const response = await authorizedFetch(user, '/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'preview',
            orgId,
            plan,
            interval,
            promotionCode,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) return void setLockdown(locked)
        if (!response.ok) {
          // The server's own sentence for a code it does not recognize; the
          // generic fallback survives for everything that is not a lockdown.
          const message = payload?.error ?? 'We could not price that plan.'
          setCodeError(message)
          enqueueSnackbar(message, { variant: 'warning', persist: false })
          return
        }
        setCodeError(null)
        setQuote(payload as QuoteState)
        onAppliedCodeChange(payload?.promotionCodeApplied ?? '')
      } catch {
        setFailed(true)
      } finally {
        setBusy(false)
      }
    },
    [orgId, plan, interval, user, enqueueSnackbar, onAppliedCodeChange],
  )

  useEffect(() => {
    // Re-quoted when the plan or the interval changes. The preview is
    // deliberately above the idempotency claim on the server, so comparing two
    // plans cannot burn the key that pays for one.
    if (plan) void fetchQuote(appliedCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, interval])

  if (!plan) return null

  if (lockdown) {
    return <LockdownNotice notice={lockdown} onClose={() => setLockdown(null)} />
  }

  if (failed) {
    return (
      <Alert severity="warning">
        {'We could not price this plan just now. Nothing has been charged.'}
      </Alert>
    )
  }

  if (quote?.needsBillingDetails || quote?.needsBillingAddress) {
    // Not a total with the tax quietly missing from it.
    return (
      <Alert severity="info">
        {'Add your billing address above to see what this plan costs with ' +
          'tax included.'}
      </Alert>
    )
  }

  const preview = quote?.preview
  if (!preview) {
    return (
      <Typography variant="body2" color="text.secondary">
        {busy ? 'Pricing this plan…' : 'Select a plan to see its total.'}
      </Typography>
    )
  }

  const tax = taxExplanation({
    taxComplete: preview.taxComplete,
    taxCents: preview.taxCents,
    taxReason: preview.taxReason,
    customerTaxExempt: quote?.customerTaxExempt,
  })
  // Stripe's `subtotal` is PRE-discount and its `total` is POST-discount, so
  // the rows below cannot be made to add up while the discount is missing from
  // them: $25.00 subtotal, $0.05 tax and a $0.80 total is a card that asks the
  // reader to believe arithmetic that does not work. `?? 0` is the honest
  // reading of a payload without the field — no discount row rather than a
  // fabricated one.
  const discountCents = preview.discountCents ?? 0

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2">{'Subtotal'}</Typography>
        <Typography variant="body2">
          {money(preview.subtotalCents, preview.currency)}
        </Typography>
      </Stack>
      {/* The line that makes the other three reconcile. Rendered only when
          something was actually discounted, and labelled with the code that
          did it so the row names its own cause. */}
      {discountCents > 0 ? (
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="body2">
            {appliedCode ? `Discount (${appliedCode})` : 'Discount'}
          </Typography>
          <Typography variant="body2" color="success.main">
            {`−${money(discountCents, preview.currency)}`}
          </Typography>
        </Stack>
      ) : null}
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2">{'Tax'}</Typography>
        <Typography variant="body2">
          {/* A dash, not "$0.00", when Stripe has not computed it. Printing a
              zero would be a claim nobody checked. */}
          {tax.totalIsFinal ? money(preview.taxCents, preview.currency) : '—'}
        </Typography>
      </Stack>
      <Divider />
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {tax.totalIsFinal ? 'Total today' : 'Total before tax'}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {money(preview.totalCents, preview.currency)}
        </Typography>
      </Stack>
      {/* The sentence that makes a zero legible. Always shown, including when
          tax WAS charged — an unexplained figure is the same problem in the
          other direction. */}
      <Typography
        variant="caption"
        color={tax.totalIsFinal ? 'text.secondary' : 'warning.main'}
      >
        {tax.sentence}
      </Typography>

      {/*
        The tax ID prompt, positioned where it can still change the outcome.
        A business tax ID is an input to what Stripe charges — it is what makes
        reverse charge apply — and the card that collects one sits further down
        this same page. A customer who finds it AFTER subscribing has already
        paid VAT that would have been zeroed.

        Shown only when tax is actually being charged and no ID is on file.
        Deliberately does NOT promise the tax will drop: whether a registration
        changes the outcome is Stripe's determination and depends on
        jurisdiction, so this raises the question rather than answering it.
      */}
      {tax.kind === 'charged' && quote?.hasTaxId === false ? (
        <Alert severity="info">
          {'Registered for VAT, GST or a similar business tax? Add your tax ID ' +
            'in Billing before you subscribe — in some countries it changes ' +
            'what you are charged, and it can only affect invoices issued ' +
            'after it is on file.'}
        </Alert>
      ) : null}

      {canManage ? (
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label="Promotion code"
              size="small"
              value={codeInput}
              disabled={busy}
              onChange={(event) => setCodeInput(event.target.value)}
              slotProps={{ htmlInput: { 'aria-label': 'Promotion code' } }}
            />
            <Button
              size="small"
              disabled={busy || !codeInput.trim()}
              onClick={() => {
                const dequeue = queueLoading()
                void fetchQuote(codeInput.trim()).finally(dequeue)
              }}
              sx={{ mt: 0.5 }}
            >
              {'Apply'}
            </Button>
            {/*
              The way back OFF a code, which Apply cannot be.

              Apply is disabled on an empty box, so once a code resolved there
              was no gesture that removed it — harmless while the code only
              re-priced a quote, and not harmless now that it decides what the
              card is charged. A customer who applied the wrong one of two
              codes could otherwise only get rid of it by leaving the page.

              Re-quotes with an empty code, so the total, the discount row and
              the page's copy of the applied code are all re-established by the
              SERVER rather than cleared locally into a state Stripe never
              agreed to.
            */}
            {appliedCode ? (
              <Button
                size="small"
                color="inherit"
                disabled={busy}
                onClick={() => {
                  setCodeInput('')
                  const dequeue = queueLoading()
                  void fetchQuote('').finally(dequeue)
                }}
                sx={{ mt: 0.5 }}
              >
                {'Remove'}
              </Button>
            ) : null}
          </Stack>
          {codeError ? (
            <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setCodeError(null)}>
              {codeError}
            </Alert>
          ) : null}
          {appliedCode ? (
            <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 1 }}>
              {`Code ${appliedCode} applied — the total above already includes it.`}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  )
}
