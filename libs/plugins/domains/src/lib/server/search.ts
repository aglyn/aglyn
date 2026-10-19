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

import { MAX_OFFERED_COST_USD, domainRetailCents } from '../model/pricing'
import { searchCandidates } from '../model/search-candidates'
import type { RegistrarDriver, RegistrarQuote } from './registrar'

/*
 * SEARCH (AGL-3962): the candidates for a query, priced. A name is offered only when it is available, not premium, sold a
 * year at a time, and within {@link MAX_OFFERED_COST_USD} to register AND to
 * renew — the renewal is checked as hard as the first year, because an
 * ending sold at $1.99 that renews at $44 is the trap a non-technical buyer
 * falls into, and the result shows both prices side by side either way.
 */

export interface DomainOffer {
  domain: string
  available: boolean
  /** What the first year costs, in cents. */
  firstYearCents: number
  renewalCents: number
}

/** A registrar quote as the offer a site sees, or null when not sold. */
export function offerFor(quote: RegistrarQuote): DomainOffer | null {
  if (!quote.available) {
    return { domain: quote.domain, available: false, firstYearCents: 0, renewalCents: 0 }
  }
  if (
    quote.premium ||
    quote.years !== 1 ||
    !(quote.purchaseUsd > 0) ||
    !(quote.renewalUsd > 0) ||
    quote.purchaseUsd > MAX_OFFERED_COST_USD ||
    quote.renewalUsd > MAX_OFFERED_COST_USD
  ) {
    return null
  }
  return {
    domain: quote.domain,
    available: true,
    firstYearCents: domainRetailCents(quote.purchaseUsd),
    renewalCents: domainRetailCents(quote.renewalUsd),
  }
}

export async function searchDomains(
  driver: RegistrarDriver,
  query: string,
): Promise<{ ok: true; offers: DomainOffer[] } | { ok: false; code: string }> {
  const candidates = searchCandidates(query)
  if (candidates.length === 0) return { ok: true, offers: [] }
  const answer = await driver.search(candidates)
  if (answer.ok === 'no') return { ok: false, code: answer.code }
  const byName = new Map(answer.value.map((quote) => [quote.domain, quote]))
  const offers: DomainOffer[] = []
  for (const name of candidates) {
    const quote = byName.get(name)
    if (!quote) continue
    const offer = offerFor(quote)
    if (offer) offers.push(offer)
  }
  return { ok: true, offers }
}
