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

import { saleChargeModel } from '@aglyn/tenant-data-admin/server/payment-provider'

/*==========================================
 * WHERE A SITE SALE'S STRIPE OBJECTS LIVE
 *
 * A direct-charge sale's session, payment intent, customer and subscription
 * live on the SELLER's connected account, and Stripe answers 404 for them on
 * the platform. The routes that come back to a sale later (the return page's
 * status read, a cancel, a refund lookup, the subscriber portal) only hold an
 * id, so they ask the site which account sells for it, try that account
 * first, and fall back to the platform on a 404. The fallback is what keeps
 * the sales that stay on the platform readable from the same route: Aglyn's
 * own card-reader hardware, and anything sold before the seller switched.
 *=========================================*/

/** The seller's account when the site sells by direct charges, else null. */
export async function directSellerAccountForHost(
  hostId: string,
): Promise<string | null> {
  if (!hostId) return null
  try {
    // Loaded on use: the routes that import this only need Firebase on the
    // path that actually reads a profile, and their specs load without it.
    const { firebaseAdmin, getOrgForHost } = await import(
      '@aglyn/tenant-data-admin'
    )
    const ownerOrg = await getOrgForHost(hostId)
    const ownerUid = String(ownerOrg?.org?.ownerUid ?? '')
    if (!ownerUid) return null
    const profile = await firebaseAdmin
      .app()
      .firestore()
      .collection('profiles')
      .doc(ownerUid)
      .get()
    const accountId = String(profile.get('stripeAccountId') ?? '').trim()
    if (!accountId) return null
    return saleChargeModel(profile.get('stripeChargeModel')) === 'direct'
      ? accountId
      : null
  } catch {
    return null
  }
}

/**
 * `fetch` against the Stripe API on the seller's account first, then on the
 * platform when the seller's account does not know the object. With no
 * seller account it is a plain platform call.
 */
export async function fetchOnSellerThenPlatform(
  url: string,
  init: RequestInit & { headers?: Record<string, string> },
  sellerAccount: string | null | undefined,
): Promise<Response> {
  if (!sellerAccount) return fetch(url, init)
  const onSeller = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), 'Stripe-Account': sellerAccount },
  })
  if (onSeller.status !== 404) return onSeller
  return fetch(url, init)
}

/** Whether a Stripe object says it was sold by direct charge. */
export function isDirectChargeObject(object: any): boolean {
  return (
    String(
      object?.metadata?.chargeModel ??
        object?.subscription_details?.metadata?.chargeModel ??
        object?.parent?.subscription_details?.metadata?.chargeModel ??
        '',
    ) === 'direct'
  )
}

/**
 * What a shopper is told when a direct-charge store chose Stripe Tax but has
 * not finished setting it up on its own Stripe account. Refused rather than
 * sold untaxed, the same doctrine as an unfinished tax settings card
 * (AGL-2145): the store decided to collect, so a zero-tax sale would be wrong.
 */
export const SELLER_STRIPE_TAX_NOT_SET_UP_MESSAGE =
  'This store is finishing its sales tax setup. Please try again later.'

/**
 * Whether the seller's own Stripe Tax is set up (head office, preset tax
 * code, at least one registration): Stripe's `tax/settings` status on their
 * account. A direct-charge session asks for `automatic_tax` only when it is,
 * because on an account without it Stripe refuses the session and the
 * shopper is told checkout failed. Not set up means the seller has chosen not
 * to collect through Stripe Tax yet: their tax, their call. Any failure to
 * read reads as not set up, the answer that never blocks a sale.
 */
export async function sellerStripeTaxActive(
  sellerAccount: string,
): Promise<boolean> {
  const key = String(process.env.STRIPE_SECRET_KEY ?? '').trim()
  if (!key || !sellerAccount) return false
  try {
    const response = await fetch('https://api.stripe.com/v1/tax/settings', {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Account': sellerAccount },
    })
    if (!response.ok) return false
    const settings = (await response.json().catch(() => null)) as {
      status?: string
    } | null
    return settings?.status === 'active'
  } catch {
    return false
  }
}
