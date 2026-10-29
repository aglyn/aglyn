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

/**
 * The query a sites page opens "Create site" from, and the way back to it
 * after buying a starter (AGL-3761, AGL-4049).
 *
 * `/{org}/hosts?create=site` opens Create site: the empty console sends a
 * first site there once its workspace exists. A starter bought from "Choose
 * your starter" comes back the same way, naming the starter the person picked
 * (`&starter={listingId}`) and how the payment ended (`&purchase=success` or
 * `&purchase=canceled`), so Create site reopens on that pick. The server
 * that opens the payment builds the address from these names, and the sites
 * page reads it with them, so the two cannot disagree.
 */

export const SITE_CREATE_PARAM = 'create'
export const SITE_CREATE_VALUE = 'site'
/** The starter the person picked before paying for it. */
export const SITE_CREATE_STARTER_PARAM = 'starter'
/** How the payment ended, as the payment page sends the person back. */
export const SITE_CREATE_PURCHASE_PARAM = 'purchase'

export type SiteCreatePurchase = 'success' | 'canceled'

/** A starter Create site reopens on: the person's own pick, and how buying it ended. */
export interface SiteCreateStarterReturn {
  listingId: string
  /** `success` once paid, `canceled` when the person came back without paying, `null` when it does not say. */
  purchase: SiteCreatePurchase | null
}

/** What a sites page's address asks of Create site. */
export interface SiteCreateRequest {
  /** `?create=site` is present. */
  asked: boolean
  /** The starter to reopen on, or `null`. */
  starter: SiteCreateStarterReturn | null
}

/** A listing id as an address may carry one: the marketplace's own id shape. */
const LISTING_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The query that reopens Create site on a starter, in one order, for the
 * payment's way back: `create=site&starter={listingId}`, and `purchase` when
 * it is given. `null` for an id no listing can have, so a malformed one is
 * never written into an address.
 */
export function siteCreateReturnQuery(
  listingId: string,
  purchase?: SiteCreatePurchase,
): URLSearchParams | null {
  const id = typeof listingId === 'string' ? listingId.trim() : ''
  if (!LISTING_ID.test(id)) return null
  const params = new URLSearchParams()
  params.set(SITE_CREATE_PARAM, SITE_CREATE_VALUE)
  params.set(SITE_CREATE_STARTER_PARAM, id)
  if (purchase) params.set(SITE_CREATE_PURCHASE_PARAM, purchase)
  return params
}

/**
 * What an address asks of Create site, read defensively. A starter is read
 * only with `create=site`, and only a well-formed listing id; a `purchase`
 * value other than the two the payment sends is no answer at all.
 */
export function readSiteCreateRequest(
  params: { get(name: string): string | null } | null | undefined,
): SiteCreateRequest {
  const asked = params?.get(SITE_CREATE_PARAM) === SITE_CREATE_VALUE
  if (!asked) return { asked: false, starter: null }
  const listingId = (params?.get(SITE_CREATE_STARTER_PARAM) ?? '').trim()
  if (!LISTING_ID.test(listingId)) return { asked: true, starter: null }
  const purchase = params?.get(SITE_CREATE_PURCHASE_PARAM)
  return {
    asked: true,
    starter: {
      listingId,
      purchase: purchase === 'success' || purchase === 'canceled' ? purchase : null,
    },
  }
}
