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

import { pluginRecordHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { doc } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from './firebase/firebase-services'
import { useConsoleHostRoute } from './use-console-host-route'
import { useFirestoreDoc } from './use-firestore-doc'
import { useOrgPlan } from './use-org-plan'

/**
 * Whether a site's workspace can take card payments, as the console can tell
 * from the workspace owner's profile.
 *
 * - `pending` — the org or the owner's profile has not answered yet. Never
 *   gate on this: a notice that flashes before the read lands tells a
 *   connected merchant to connect.
 * - `error` — the profile could not be read. Also never gated on.
 * - `not-connected` — no Stripe account on file.
 * - `charges-disabled` — Stripe has not enabled charges yet (onboarding
 *   unfinished, or Stripe needs more details).
 * - `mode-mismatch` — the account is in the other Stripe mode from this
 *   deployment (a test account on a live deployment, or the reverse).
 * - `mode-unverified` — a live deployment with an account whose mode was
 *   never recorded; reconnecting records it.
 * - `ready` — charges go through.
 */
export type MerchantPaymentsState =
  | 'pending'
  | 'error'
  | 'not-connected'
  | 'charges-disabled'
  | 'mode-mismatch'
  | 'mode-unverified'
  | 'ready'

export type MerchantPaymentsPlatformMode = 'live' | 'test' | undefined

/**
 * This deployment's Stripe mode, from its publishable key: `pk_live_…` is
 * live, `pk_test_…` is test. The server reads the same answer off its secret
 * key, and the two keys of one deployment are always a pair.
 */
export function merchantPaymentsPlatformMode(
  // The dot form: a bundler inlines `process.env.NEXT_PUBLIC_…` into browser
  // code only when the name is written out like this.
  publishableKey: string | undefined = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
): MerchantPaymentsPlatformMode {
  const key = String(publishableKey ?? '').trim()
  if (key.startsWith('pk_live_')) return 'live'
  if (key.startsWith('pk_test_')) return 'test'
  return undefined
}

/**
 * The verdict for one owner profile. It is the client's copy of the server's
 * `merchantAccountReadiness` and has to answer exactly as that does: a console
 * that calls an account ready while checkout refuses it, or the reverse, puts
 * a notice beside a control that works, or none beside one that fails.
 *
 * Only a literal `true` enables charges and only a literal boolean records a
 * mode, because a field written as `'true'` or `1` was written by something
 * other than the onboarding route.
 */
export function merchantPaymentsStateFromProfile(
  profile: Record<string, unknown> | null | undefined,
  platformMode: MerchantPaymentsPlatformMode,
): Exclude<MerchantPaymentsState, 'pending' | 'error'> {
  const accountId = typeof profile?.['stripeAccountId'] === 'string' ? profile['stripeAccountId'].trim() : ''
  if (!accountId) return 'not-connected'
  if (profile?.['stripeChargesEnabled'] !== true) return 'charges-disabled'
  const accountLivemode = profile?.['stripeAccountLivemode']
  if (typeof accountLivemode === 'boolean') {
    if (!platformMode) return 'ready'
    return accountLivemode === (platformMode === 'live') ? 'ready' : 'mode-mismatch'
  }
  return platformMode === 'live' ? 'mode-unverified' : 'ready'
}

/**
 * One sentence on what stands between the workspace and card payments, for a
 * notice or a disabled control's reason. `null` when nothing does, or while
 * the answer is unknown.
 */
export function merchantPaymentsBlockedReason(state: MerchantPaymentsState): string | null {
  switch (state) {
    case 'not-connected':
      return 'Connect Stripe to take card payments.'
    case 'charges-disabled':
      return 'Finish setting up Stripe to take card payments: Stripe has not turned on charges for this account yet.'
    case 'mode-mismatch':
    case 'mode-unverified':
      return 'Reconnect Stripe to take card payments: the connected account has not been confirmed for live payments.'
    default:
      return null
  }
}

/**
 * A site's store settings page (`payments`, `shipping`, `pos` …), or `null`
 * until the site's console address resolves or when no installed plugin
 * publishes store settings. Resolved through the plugin record-route seam, so
 * a plugin that only needs to point at the page never imports the one that
 * owns it.
 */
export function useStoreSettingsHref(hostId: string | undefined, page: string): string | null {
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  return useMemo(
    () => (orgSlug && subdomain ? pluginRecordHref('store-settings', { orgSlug, host: subdomain }, page) : null),
    [orgSlug, subdomain, page],
  )
}

export interface MerchantPaymentsStatus {
  state: MerchantPaymentsState
  /** The answer has arrived, so a notice may be shown or held. */
  settled: boolean
  /** Settled and able to charge. */
  ready: boolean
  /** Settled and NOT able to charge: the case to explain. */
  blocked: boolean
  /** {@link merchantPaymentsBlockedReason} for the current state. */
  reason: string | null
  /** The site's Payments settings page, where Stripe is connected. */
  href: string | null
}

/**
 * Card-payment readiness for the workspace that owns a site.
 *
 * Reads the OWNER's profile, the document every money route checks, rather
 * than the signed-in member's: an admin who is not the owner has no Stripe
 * account of their own, and reading theirs would report a connected store as
 * not set up.
 */
export function useMerchantPayments(hostId: string | undefined): MerchantPaymentsStatus {
  const firestore = useFirestore()
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const href = useStoreSettingsHref(hostId, 'payments')
  const ownerUid = typeof org?.['ownerUid'] === 'string' ? (org['ownerUid'] as string) : ''
  const { data: profile, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (ownerUid ? doc(firestore, 'profiles', ownerUid) : null),
    [firestore, ownerUid],
  )
  return useMemo(() => {
    let state: MerchantPaymentsState
    if (!orgReady) state = 'pending'
    else if (!ownerUid) state = 'not-connected'
    else if (status === 'error') state = 'error'
    else if (status !== 'success') state = 'pending'
    else state = merchantPaymentsStateFromProfile(profile, merchantPaymentsPlatformMode())
    const settled = state !== 'pending' && state !== 'error'
    return {
      state,
      settled,
      ready: state === 'ready',
      blocked: settled && state !== 'ready',
      reason: merchantPaymentsBlockedReason(state),
      href,
    }
  }, [orgReady, ownerUid, status, profile, href])
}

export default useMerchantPayments
