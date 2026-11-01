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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn/app-utils/lockdown'
import { readGaClientId } from '@aglyn/aglyn/app-utils/analytics-events'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import type { BillingAddressValue } from '@aglyn/shared-ui-jsx/stripe/billing-address-form.component'
import { handleStripeNextAction } from '@aglyn/shared-ui-jsx/stripe/lazy-stripe'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { MarketplacePayPanel, type PayStep } from '../components/marketplace-pay-panel.component'
import {
  payPrerequisiteOf,
  type PayPrerequisite,
  type PayQuote,
} from '../model/marketplace-pay'

/** How one purchase ended. */
export type MarketplacePayOutcome =
  /** Paid, and the purchase is on record: the buyer owns it now. */
  | 'paid'
  /** The workspace owns it already: nothing was charged. */
  | 'owned'
  /** Stripe accepted the payment and it has not cleared yet. */
  | 'pending'
  /** Closed before paying, or it could not open: `error` says which. */
  | 'stopped'

/** How one purchase ended, and why it could not open, if it could not. */
export interface MarketplacePayResult {
  outcome: MarketplacePayOutcome
  error: string | null
  /** The refusal is a feature lockdown: a pause to read, not a failure of theirs. */
  locked?: boolean
}

/** The listing being bought, as a surface knows it. */
export interface PayListing {
  listingId: string
  displayName?: string | null
}

export interface MarketplacePay {
  /** Opens payment for a listing. Settles when the purchase has ended, either way. */
  buy: (listing: PayListing) => Promise<MarketplacePayResult>
  /** Asking what it would cost, or paying. */
  busy: boolean
  /** The panel, in place under the button that asked for it, or `null`. */
  panel: ReactNode
}

interface DoorAnswer {
  ok: boolean
  status: number
  payload: Record<string, any> | null
}

const newAttemptKey = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Buying a marketplace listing in the console (AGL-4049): the card on file, or
 * a card added right there, then the bank's step if the bank asks for one.
 *
 * Asks the door what it would charge before it shows anything, so the total,
 * the prerequisite or the refusal is the first thing the buyer sees. Stripe
 * loads only if a form or the bank's step actually needs it.
 *
 * One attempt per press of Pay: the same key goes with a double click and with
 * a retry after a lost connection, so neither can charge twice (AGL-1697). An
 * answer that ends the attempt retires the key, and pressing Pay again after a
 * decline is a new attempt.
 *
 * @param input.billingHref the workspace's Billing page, for a prerequisite
 *   this person cannot meet themselves.
 */
export function useMarketplacePay(input: {
  orgId: string | null | undefined
  /** Named so the dispatcher can gate the site this is bought from, when there is one. */
  hostId?: string | null
  billingHref?: string | null
}): MarketplacePay {
  const { orgId, hostId, billingHref } = input
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const attemptKeys = useRef(new Map<string, string>())
  const [listing, setListing] = useState<PayListing | null>(null)
  const [step, setStep] = useState<PayStep | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Hands the outcome to the `buy` that is waiting on it. */
  const settled = useRef<((result: MarketplacePayResult) => void) | null>(null)

  const finish = useCallback((result: MarketplacePayResult) => {
    setStep(null)
    setListing(null)
    setBusy(false)
    setError(null)
    settled.current?.(result)
    settled.current = null
  }, [])

  const askDoor = useCallback(
    async (
      target: PayListing,
      body: Record<string, unknown>,
      attemptKey?: string,
    ): Promise<DoorAnswer> => {
      const response = await authorizedFetch(userRef.current, '/api/marketplace/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(attemptKey ? { 'Idempotency-Key': attemptKey } : {}),
        },
        body: JSON.stringify({
          listingId: target.listingId,
          orgId,
          ...(hostId ? { hostId } : {}),
          ...body,
        }),
      })
      const payload = (await response.json().catch((): null => null)) as DoorAnswer['payload']
      return { ok: response.ok, status: response.status, payload }
    },
    [orgId, hostId],
  )

  /** What a refused answer says to the buyer. */
  const refusalText = (answer: DoorAnswer): string => {
    const locked = parseLockdownRefusal(answer.status, answer.payload)
    if (locked) return lockdownRefusalText(locked)
    if (answer.status === 501) return 'Purchases are not set up on this deployment.'
    const stated = answer.payload?.['error']
    return typeof stated === 'string' && stated ? stated : 'The payment did not go through.'
  }

  const billingRequest = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, any> | null> => {
      const response = await authorizedFetch(userRef.current, '/api/billing/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch((): null => null)
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : 'Billing could not be reached.',
        )
      }
      return payload
    },
    [orgId],
  )

  /** Moves to the step a prerequisite needs: a form here, or who can fix it. */
  const meetPrerequisite = useCallback(
    async (need: PayPrerequisite, canManageBilling: boolean) => {
      if (!canManageBilling) return setStep({ kind: 'ask-billing', need })
      if (need === 'billing_address_required') return setStep({ kind: 'address' })
      setStep({ kind: 'card', clientSecret: null })
      try {
        const opened = await billingRequest({ action: 'create-setup-intent' })
        const secret = opened?.['clientSecret']
        if (typeof secret !== 'string') throw new Error('The card form could not open.')
        setStep({ kind: 'card', clientSecret: secret })
      } catch (caught) {
        setError((caught as Error).message)
      }
    },
    [billingRequest],
  )

  /**
   * Asks what it would cost now, and shows whatever that answer needs: the
   * result when the purchase ends here, `null` when a step is on screen.
   */
  const quote = useCallback(
    async (target: PayListing): Promise<MarketplacePayResult | null> => {
      const answer = await askDoor(target, { action: 'quote' })
      if (answer.ok && answer.payload?.['quote']) {
        setStep({ kind: 'confirm', quote: answer.payload['quote'] as PayQuote })
        return null
      }
      if (answer.status === 409 && answer.payload?.['code'] === 'already_purchased') {
        return { outcome: 'owned', error: null }
      }
      const need = payPrerequisiteOf(answer.status, answer.payload)
      if (need) {
        await meetPrerequisite(need, answer.payload?.['canManageBilling'] === true)
        return null
      }
      return {
        outcome: 'stopped',
        error: refusalText(answer),
        locked: Boolean(parseLockdownRefusal(answer.status, answer.payload)),
      }
    },
    [askDoor, meetPrerequisite],
  )

  const buy = useCallback(
    (target: PayListing): Promise<MarketplacePayResult> => {
      if (!orgId || !target.listingId) {
        return Promise.resolve({ outcome: 'stopped', error: null })
      }
      return new Promise<MarketplacePayResult>((resolve) => {
        settled.current = resolve
        setListing(target)
        setError(null)
        setBusy(true)
        quote(target)
          .then((ended) => {
            if (ended) finish(ended)
            else setBusy(false)
          })
          .catch((caught: unknown) => {
            console.error(caught)
            finish({
              outcome: 'stopped',
              error: 'The payment could not open. Check your connection and try again.',
            })
          })
      })
    },
    [orgId, quote, finish],
  )

  /** Goes back to the total once a card or an address is on file. */
  const returnToQuote = useCallback(async () => {
    if (!listing) return
    setBusy(true)
    setError(null)
    try {
      const ended = await quote(listing)
      if (ended?.outcome === 'owned') return finish(ended)
      if (ended) setError(ended.error)
    } finally {
      setBusy(false)
    }
  }, [listing, quote, finish])

  const onCardSaved = useCallback(
    async (setupIntentId: string) => {
      setError(null)
      try {
        await billingRequest({ action: 'finalize-card-setup', setupIntentId })
      } catch (caught) {
        return setError((caught as Error).message)
      }
      await returnToQuote()
    },
    [billingRequest, returnToQuote],
  )

  const onAddressSaved = useCallback(
    async (address: BillingAddressValue) => {
      setError(null)
      try {
        await billingRequest({ action: 'set-billing-address', ...address })
      } catch (caught) {
        return setError((caught as Error).message)
      }
      await returnToQuote()
    },
    [billingRequest, returnToQuote],
  )

  const onPay = useCallback(async () => {
    if (!listing || step?.kind !== 'confirm') return
    const { listingId } = listing
    const key = attemptKeys.current.get(listingId) ?? newAttemptKey()
    attemptKeys.current.set(listingId, key)
    setBusy(true)
    setError(null)
    try {
      const answer = await askDoor(
        listing,
        {
          expectedTotalCents: step.quote.totalCents,
          gaClientId: await readGaClientId(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID),
        },
        key,
      )
      if (answer.ok) {
        const { paid, submitted, requiresAction, paymentClientSecret, invoiceId } =
          answer.payload ?? {}
        attemptKeys.current.delete(listingId)
        if (paid) return finish({ outcome: 'paid', error: null })
        if (submitted) return finish({ outcome: 'pending', error: null })
        if (requiresAction && typeof paymentClientSecret === 'string') {
          const refused = await handleStripeNextAction(paymentClientSecret)
          // The server decides, either way: it reads the invoice, records a
          // payment that landed, and voids one that did not.
          const settledAnswer = await askDoor(listing, { action: 'settle', invoiceId })
          if (settledAnswer.ok && settledAnswer.payload?.['paid']) {
            return finish({ outcome: 'paid', error: null })
          }
          if (settledAnswer.ok && settledAnswer.payload?.['submitted']) {
            return finish({ outcome: 'pending', error: null })
          }
          return setError(refused ?? refusalText(settledAnswer))
        }
        return setError('The payment did not go through.')
      }
      // An answer ends this attempt: the next press of Pay is a new one.
      attemptKeys.current.delete(listingId)
      if (answer.status === 409 && answer.payload?.['code'] === 'already_purchased') {
        return finish({ outcome: 'owned', error: null })
      }
      if (answer.status === 409 && answer.payload?.['code'] === 'total_changed') {
        await returnToQuote()
        return setError(refusalText(answer))
      }
      const need = payPrerequisiteOf(answer.status, answer.payload)
      if (need) return await meetPrerequisite(need, answer.payload?.['canManageBilling'] === true)
      setError(refusalText(answer))
    } catch (caught) {
      // No answer came back, so this attempt may still be running: the key
      // stays, and a second press replays it rather than charging again.
      console.error(caught)
      setError('The payment could not be confirmed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [listing, step, askDoor, finish, returnToQuote, meetPrerequisite])

  const panel =
    step && listing ? (
      <MarketplacePayPanel
        step={step}
        listingName={listing.displayName || 'this listing'}
        busy={busy}
        error={error}
        billingHref={billingHref}
        onPay={() => void onPay()}
        onCardSaved={onCardSaved}
        onAddressSaved={onAddressSaved}
        onCancel={() => finish({ outcome: 'stopped', error: null })}
      />
    ) : null

  return { buy, busy, panel }
}

export default useMarketplacePay
