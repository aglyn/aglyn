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
import {
  merchantPaymentsBlockedReason,
  merchantPaymentsPlatformMode,
  merchantPaymentsStateFromProfile,
  type MerchantPaymentsState,
} from './merchant-payments-state'

export * from './merchant-payments-state'

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
