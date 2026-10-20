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

import type { PluginDomainSearchResult } from '@aglyn/aglyn/plugin-manager/plugin-domain-search'
import { platformEffects } from './platform-effects'
import { sellingConfigured } from './routes'
import { searchDomains, type DomainOffer } from './search'

/*
 * DOMAINS' ANSWER TO `core.domain-search` (AGL-3958), registered from the
 * console-server declarations. Staff building a client's site in one screen
 * search here, and the owner later buys the pick on the Get a domain card.
 *
 * So it is the card's own search, word for word: the same candidates, the
 * same rule for what is offered, and the same prices — what the owner will
 * be charged (`domainRetailCents`), never what the registrar charges us. The
 * offers are in cents; core's results are US dollars.
 */

/** The longest query asked about, as the card's search route caps it. */
const MAX_QUERY_LENGTH = 120

/** An offer as core shows it: dollars, for the first year and every year after. */
export function offerAsCoreResult(offer: DomainOffer): PluginDomainSearchResult {
  return {
    name: offer.domain,
    available: offer.available,
    firstYearUsd: Math.round(offer.firstYearCents) / 100,
    renewalUsd: Math.round(offer.renewalCents) / 100,
  }
}

/**
 * Names for `query`, priced. `null` on a deployment that does not sell
 * names (no registrar, or no Stripe product: what the search route checks),
 * and a throw when the registrar does not answer, which core reports as a
 * failed search.
 */
export async function searchDomainsForCore(
  query: string,
): Promise<PluginDomainSearchResult[] | null> {
  if (!sellingConfigured()) return null
  const asked = String(query ?? '').slice(0, MAX_QUERY_LENGTH)
  if (!asked.trim()) return []
  const found = await searchDomains(platformEffects().driver, asked)
  if (found.ok === false) {
    throw new Error(`the registrar did not answer a domain search (${found.code})`)
  }
  return found.offers.map(offerAsCoreResult)
}
