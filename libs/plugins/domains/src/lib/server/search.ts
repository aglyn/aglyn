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

import {
  orgSubscriptionState,
  resolvePlanComp,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { readOrgBilling } from '@aglyn/tenant-data-admin'
import {
  MAX_OFFERED_COST_USD,
  domainRetailCents,
  freeFirstYear,
} from '../model/pricing'
import { searchCandidates } from '../model/search-candidates'
import { listRegistrations } from './db'
import type { RegistrarDriver, RegistrarQuote } from './registrar'

/*
 * SEARCH (AGL-3962): the candidates for a query, priced for the person
 * asking. A name is offered only when it is available, not premium, sold a
 * year at a time, and within {@link MAX_OFFERED_COST_USD} to register AND to
 * renew — the renewal is checked as hard as the first year, because an
 * ending sold at $1.99 that renews at $44 is the trap a non-technical buyer
 * falls into, and the result shows both prices side by side either way.
 */

export interface DomainOffer {
  domain: string
  available: boolean
  /** What the first year costs this site, in cents; 0 when included. */
  firstYearCents: number
  /** What it costs before any inclusion, for the struck-through price. */
  listFirstYearCents: number
  renewalCents: number
  freeFirstYear: boolean
}

/** Whether a site's next purchase would have its first year included. */
export interface FreeYearContext {
  interval: 'month' | 'year' | null
  subscriptionLive: boolean
  comped: boolean
  siteUsedFreeDomain: boolean
}

export async function freeYearContext(
  orgId: string,
  org: Record<string, unknown>,
  hostId: string,
): Promise<FreeYearContext> {
  const [billing, forSite] = await Promise.all([
    readOrgBilling(orgId).catch(() => ({})),
    listRegistrations('hostId', hostId).catch(() => []),
  ])
  const interval = (billing as { subscription?: { interval?: unknown } }).subscription
    ?.interval
  return {
    interval: interval === 'year' || interval === 'month' ? interval : null,
    subscriptionLive: orgSubscriptionState(org as never) === 'live',
    comped: resolvePlanComp(org as never) !== null,
    siteUsedFreeDomain: forSite.some(
      (registration) =>
        registration.freeFirstYear &&
        registration.status !== 'declined' &&
        registration.status !== 'refunded',
    ),
  }
}

/** A registrar quote as the offer a site sees, or null when not sold. */
export function offerFor(
  quote: RegistrarQuote,
  context: FreeYearContext,
): DomainOffer | null {
  if (!quote.available) {
    return {
      domain: quote.domain,
      available: false,
      firstYearCents: 0,
      listFirstYearCents: 0,
      renewalCents: 0,
      freeFirstYear: false,
    }
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
  const listFirstYearCents = domainRetailCents(quote.purchaseUsd)
  const included = freeFirstYear({
    ...context,
    firstYearCostUsd: quote.purchaseUsd,
  })
  return {
    domain: quote.domain,
    available: true,
    firstYearCents: included ? 0 : listFirstYearCents,
    listFirstYearCents,
    renewalCents: domainRetailCents(quote.renewalUsd),
    freeFirstYear: included,
  }
}

export async function searchDomains(
  driver: RegistrarDriver,
  query: string,
  context: FreeYearContext,
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
    const offer = offerFor(quote, context)
    if (offer) offers.push(offer)
  }
  return { ok: true, offers }
}
