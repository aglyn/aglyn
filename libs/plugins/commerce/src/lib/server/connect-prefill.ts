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

import type { BusinessDetailsHost } from '@aglyn/aglyn/app-utils/business-details'
import {
  hostPublicOrigin,
  liveCustomDomain,
  type HostCustomDomainState,
} from '@aglyn/aglyn/app-utils/host-naming'
import { siteContactEmail } from '@aglyn/aglyn/app-utils/host-tokens'

/**
 * WHAT A NEW STRIPE ACCOUNT STARTS WITH (AGL-4245).
 *
 * The owner already typed their business name, email and phone on
 * Setup → Business details, and the site already has a public address. Sent
 * with the account create, Stripe's hosted onboarding shows them filled in,
 * for the owner to confirm or change, instead of asking for each again.
 *
 * Every field is optional and checked here first: a value that is missing or
 * does not look like what Stripe takes is left out, never sent half-formed.
 * The connect route still retries the create without any of it when Stripe
 * refuses a prefill field, so nothing here can stop a store from setting up
 * payments.
 *
 * ONLY THE BUSINESS PROFILE. No country, no address, no `company`,
 * `individual` or `business_type`. An owner who signs in to Stripe's form
 * with an existing Stripe login is offered the business details and payout
 * bank they already have there to reuse (networked onboarding), and anything
 * the platform prefills on the legal entity narrows which of their existing
 * businesses they can pick: a prefilled country limits them to that country
 * and also locks it. That reuse is the easiest setup there is for someone who
 * already has Stripe, so it is never narrowed. The business profile (name,
 * site address, support email and phone) is what customers see, and the
 * owner can still change any of it in Stripe's form.
 *
 * On this account shape `business_profile` stays writable by the platform
 * after the first onboarding link, so the connect route also fills it in on
 * re-entry for an account that has not finished onboarding
 * ({@link missingBusinessProfilePrefill}).
 */

/** The host fields the prefill reads: business details plus the site's public address. */
export type StripePrefillHost = BusinessDetailsHost & HostCustomDomainState

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** The site's public https address: the live custom domain, else its platform address. */
export function prefillSiteUrl(
  host: StripePrefillHost | null | undefined,
  subdomain?: string | null,
): string {
  const origin = hostPublicOrigin({
    cname: liveCustomDomain(host) ?? null,
    subdomain: text(host?.subdomain, 63) || text(subdomain, 63) || null,
  })
  if (!origin) return ''
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:') return ''
    if (!url.hostname.includes('.') || url.hostname.endsWith('.localhost')) return ''
    return url.origin
  } catch {
    return ''
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The `/v1/accounts` prefill parameters for a site, as form fields. Empty
 * when the site has nothing usable; each key appears only with a real value.
 */
export function stripeAccountPrefill(
  host: StripePrefillHost | null | undefined,
  options: { subdomain?: string | null } = {},
): Record<string, string> {
  const params: Record<string, string> = {}
  if (!host && !options.subdomain) return params
  const entity = host?.seo?.entity ?? null

  const name = text(entity?.name, 200) || text(host?.displayName, 200)
  if (name) params['business_profile[name]'] = name

  const url = prefillSiteUrl(host, options.subdomain)
  if (url) params['business_profile[url]'] = url

  const email = siteContactEmail(host ?? null) ?? ''
  if (email && EMAIL.test(email)) params['business_profile[support_email]'] = email

  // A phone Stripe can read has at least seven digits and nothing but the
  // usual punctuation around them; anything else is left for the owner to
  // type in Stripe's form.
  const phone = text(entity?.telephone, 64)
  const digits = phone.replace(/\D/g, '')
  if (phone && /^[+\d\s().-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15) {
    params['business_profile[support_phone]'] = phone
  }

  return params
}

/** The Stripe Account field each prefill parameter fills. */
const PREFILL_FIELDS: Readonly<Record<string, string>> = {
  'business_profile[name]': 'name',
  'business_profile[url]': 'url',
  'business_profile[support_email]': 'support_email',
  'business_profile[support_phone]': 'support_phone',
}

/**
 * The prefill for an account that already exists: only the fields its
 * `business_profile` does not hold yet, so anything the owner already typed
 * into Stripe's form is never overwritten. Empty when there is nothing to add.
 */
export function missingBusinessProfilePrefill(
  prefill: Record<string, string>,
  account: unknown,
): Record<string, string> {
  const profile = (account as any)?.business_profile ?? {}
  const missing: Record<string, string> = {}
  for (const [param, value] of Object.entries(prefill)) {
    const field = PREFILL_FIELDS[param]
    if (!field) continue
    const current = profile?.[field]
    if (typeof current === 'string' && current.trim()) continue
    missing[param] = value
  }
  return missing
}
