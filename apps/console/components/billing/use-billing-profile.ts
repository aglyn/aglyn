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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/** One saved card, wallet or Link account, as the payment-methods card reads it. */
export interface BillingPaymentMethod {
  id: string
  type: string | null
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
  /** Link and the wallets identify by email, not a PAN. */
  email: string | null
  isDefault: boolean
}

/** One tax registration held against the org's Stripe customer. */
export interface BillingTaxId {
  id: string
  type: string | null
  value: string | null
  /** Stripe verifies some types asynchronously. */
  verification: string | null
}

export interface BillingProfileState {
  configured: boolean
  customer: {
    email: string | null
    name: string | null
    address: {
      line1: string
      line2: string
      city: string
      state: string
      postalCode: string
      country: string
    } | null
  } | null
  taxIds: BillingTaxId[]
  paymentMethods: BillingPaymentMethod[]
  hasBillableSubscription?: boolean
  /** The org is billed in the Stripe mode this deployment cannot read. */
  otherModeOnly?: boolean
  deploymentMode?: 'live' | 'test'
}

/**
 * Four outcomes, not two.
 *
 * `unconfigured` is a fact the deployment told us (HTTP 501) and reads as a
 * calm sentence; `error` is a fact we failed to learn and must not be dressed
 * up as one — showing "billing is not configured" to a paying customer whose
 * network blipped is a claim about their account that nobody checked.
 */
export type BillingProfileLoadState =
  | 'pending'
  | 'unconfigured'
  | 'error'
  | 'loaded'

export interface BillingProfileRequestOutcome {
  ok: boolean
  /** The route's own sentence on a refusal — Stripe's, where Stripe refused. */
  error?: string
  /**
   * The raw success payload, for the one action that answers with something
   * other than a profile: `begin-card-setup` returns a Stripe client secret.
   */
  payload?: any
}

export interface BillingProfile {
  state: BillingProfileState | null
  loadState: BillingProfileLoadState
  /** Re-read from the server. */
  reload: () => void
  /**
   * Send one action. On success the returned profile replaces local state, so
   * a save in one card is immediately visible in the others without any card
   * knowing about the rest.
   */
  request: (
    body: Record<string, unknown>,
  ) => Promise<BillingProfileRequestOutcome>
}

/**
 * The one loader behind the billing settings cards.
 *
 * ONE fetch for four cards, held by the page and passed down. The alternative
 * — a `useEffect` per card — is four round trips on every load and, worse,
 * four copies of the same customer that drift the moment one of them saves:
 * changing the billing address would leave the tax ID card rendering the old
 * one until a reload nobody thought to do.
 *
 * Every mutating action returns the WHOLE profile for the same reason, so this
 * hook never has to decide when a save invalidates something else.
 */
export function useBillingProfile(
  orgId: string | null | undefined,
  enabled: boolean,
): BillingProfile {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<BillingProfileState | null>(null)
  const [loadState, setLoadState] =
    useState<BillingProfileLoadState>('pending')
  const [nonce, setNonce] = useState(0)

  const post = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{
      ok: boolean
      status: number
      payload: any
    }> => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      return { ok: response.ok, status: response.status, payload }
    },
    [user, orgId],
  )

  useEffect(() => {
    if (!orgId || !user || !enabled) return
    let cancelled = false
    setLoadState('pending')
    post({ action: 'get' })
      .then((outcome) => {
        if (cancelled) return
        if (outcome.status === 501) return void setLoadState('unconfigured')
        if (!outcome.ok) return void setLoadState('error')
        setState(outcome.payload as BillingProfileState)
        setLoadState('loaded')
      })
      // A rejected fetch — offline, a wedged route — never produced a status
      // to branch on, so this is the only place it can become a state.
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, user, enabled, post, nonce])

  const request = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<BillingProfileRequestOutcome> => {
      try {
        const outcome = await post(body)
        if (outcome.status === 501) {
          setLoadState('unconfigured')
          return { ok: false, error: 'Billing is not configured' }
        }
        if (!outcome.ok) {
          // The route's own sentence, verbatim. Where Stripe refused, that
          // sentence IS Stripe's — it names the format expected for the tax
          // ID type the customer chose, which nothing here could invent and
          // which stays true as the rules change.
          const error = outcome.payload?.error ?? 'That change did not save.'
          enqueueSnackbar(error, { variant: 'warning', persist: false })
          return { ok: false, error }
        }
        // A mutating action answers with the whole profile; `begin-card-setup`
        // answers with a client secret and nothing else, so only adopt a
        // payload that actually is one.
        if (outcome.payload && 'taxIds' in outcome.payload) {
          setState(outcome.payload as BillingProfileState)
          setLoadState('loaded')
        }
        return { ok: true, payload: outcome.payload }
      } catch {
        const error = 'We could not reach billing. Nothing has changed.'
        enqueueSnackbar(error, { variant: 'warning', persist: false })
        return { ok: false, error }
      }
    },
    [post, enqueueSnackbar],
  )

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { state, loadState, reload, request }
}
