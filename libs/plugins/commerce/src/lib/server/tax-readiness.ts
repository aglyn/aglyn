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

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  checkoutTaxBlock,
  type SellerStripeTaxStatus,
  type StoreTaxReadiness,
  stripeTaxStatusFromSettings,
} from '../model/commerce-tax-readiness'
import { clearCheckoutTaxRefusal, readCheckoutTaxRefusal } from './checkout-tax-refusal'
import { holdsCommerceSiteKey } from './commerce-site-keys'
import {
  directSellerAccountForHost,
  fetchSellerStripeTaxSettings,
  sellerHasActiveTaxRegistration,
} from './seller-stripe-account'

/**
 * Whether sales tax lets shoppers check out (AGL-4245):
 * `GET /api/commerce/tax-readiness?hostId=…[&fresh=1]`, served by the console
 * for the Taxes card and the Payments card's notice.
 *
 * Answers a {@link StoreTaxReadiness}: the saved tax mode, whether the store
 * sells on its own Stripe account, that account's Stripe Tax (read with the
 * same `tax/settings` call checkout makes, plus whether any registration is
 * active), and whether checkout is refusing every shopper because of tax.
 *
 * Reading it as not blocked drops the refusal marker
 * (`checkout-tax-refusal.ts`), which is how the owner's alert clears once a
 * mode is chosen or Stripe Tax is on.
 *
 * Who may ask: whoever may read the payment methods card (works the store's
 * orders, or manages its payment methods). A 404 otherwise, so the route
 * never confirms a site exists.
 */

/** How long one account's Stripe Tax answer is reused, so a card's render does not call Stripe each time. */
export const SELLER_STRIPE_TAX_CACHE_MS = 60_000
/** The shortest gap between two reads that "Check again" forces. */
export const SELLER_STRIPE_TAX_FRESH_MIN_MS = 5_000

const statusCache = new Map<string, { at: number; value: SellerStripeTaxStatus }>()
const CACHE_MAX = 500

/** Test seam: forget every cached answer. */
export function resetSellerStripeTaxCacheForTests(): void {
  statusCache.clear()
}

export interface TaxReadinessReadDeps {
  settings(account: string): Promise<Record<string, unknown> | null>
  registration(account: string): Promise<boolean | null>
  now(): number
}

const defaultReadDeps: TaxReadinessReadDeps = {
  settings: fetchSellerStripeTaxSettings,
  registration: sellerHasActiveTaxRegistration,
  now: () => Date.now(),
}

/**
 * The seller's Stripe Tax, cached per account for
 * {@link SELLER_STRIPE_TAX_CACHE_MS}. `fresh` skips the cache unless the
 * cached answer is younger than {@link SELLER_STRIPE_TAX_FRESH_MIN_MS}. An
 * unreadable answer is not cached, so the next paint asks again.
 */
export async function cachedSellerStripeTaxStatus(
  account: string,
  options: { fresh?: boolean } = {},
  deps: TaxReadinessReadDeps = defaultReadDeps,
): Promise<SellerStripeTaxStatus> {
  const now = deps.now()
  const cached = statusCache.get(account)
  const maxAge = options.fresh ? SELLER_STRIPE_TAX_FRESH_MIN_MS : SELLER_STRIPE_TAX_CACHE_MS
  if (cached && now - cached.at < maxAge) return cached.value
  const [settings, registration] = await Promise.all([deps.settings(account), deps.registration(account)])
  const value = stripeTaxStatusFromSettings(settings, registration)
  if (value.readable) {
    if (statusCache.size >= CACHE_MAX) statusCache.clear()
    statusCache.set(account, { at: now, value })
  } else {
    statusCache.delete(account)
  }
  return value
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

const savedMode = (tax: unknown): StoreTaxReadiness['mode'] => {
  const mode = (tax as { mode?: unknown } | null | undefined)?.mode
  return mode === 'manual' || mode === 'stripe' || mode === 'none' ? mode : null
}

export async function taxReadinessHandler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)
  const hostId = String(query?.['hostId'] ?? '')
  if (!hostId) return json({ error: 'Missing hostId' }, 400)
  const fresh = String(query?.['fresh'] ?? '') === '1'

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) return json({ error: 'Not found' }, 404)
    const mayRead =
      holdsCommerceSiteKey(hostSnapshot, decoded.uid, 'commerce.paymentMethods') ||
      holdsCommerceSiteKey(hostSnapshot, decoded.uid, 'commerce.orders')
    if (!mayRead) return json({ error: 'Not found' }, 404)

    const owner = await getOrgForHost(hostId)
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: owner?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked
    if (!checkEntitlement((owner?.org ?? {}) as never, 'commerce')) {
      return json({ error: 'Selling is not included on this plan' }, 402)
    }

    const store = await hostRef.collection('settings').doc('store').get()
    const mode = savedMode(store.get('tax'))
    const account = await directSellerAccountForHost(hostId)
    const stripeTax = account ? await cachedSellerStripeTaxStatus(account, { fresh }) : null
    const blocked = checkoutTaxBlock({ mode, direct: Boolean(account), stripeTax })
    let refusedAtMs: number | null = null
    if (blocked) {
      const marker = await readCheckoutTaxRefusal(firestore, hostId)
      refusedAtMs = marker?.reason === blocked && Number.isFinite(Number(marker.lastAtMs))
        ? Number(marker.lastAtMs)
        : null
    } else {
      // Fixed: the next refusal, if the store ever breaks again, tells the owner again.
      await clearCheckoutTaxRefusal(firestore, hostId)
    }
    const answer: StoreTaxReadiness = { mode, direct: Boolean(account), stripeTax, blocked, refusedAtMs }
    return json(answer)
  } catch (error) {
    const refused = invalidIdTokenResponse(error)
    if (refused) return refused
    console.error('[commerce] tax readiness failed', hostId, error)
    return json({ error: 'Could not check sales tax setup' }, 500)
  }
}
