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

import type { OrgPlan } from '../foundation/definitions/org-billing.types'
import { isCustomPricedPlan } from './plan-entitlements'

/**
 * The marketing → console onboarding deep link (AGL-1117).
 *
 * `app.aglyn.com/signup?plan=pro&interval=year`
 *
 * This is a CONTRACT with a site we do not control and cannot deploy in
 * lockstep with. So it is parsed defensively and in one place: the pricing
 * page will eventually be edited by someone who has never read this file, and
 * a typo in a CTA must degrade to ordinary signup rather than break it or —
 * far worse — silently start someone on the wrong plan.
 */
export type OnboardingInterval = 'month' | 'year'

export interface OnboardingPlanIntent {
  plan: OrgPlan
  interval: OnboardingInterval
  /**
   * Whether the link ACTUALLY said an interval, as opposed to `interval`
   * being the safe default below (AGL-1535).
   *
   * Some CTAs carry a plan and deliberately no interval — the /pricing scale
   * strip quotes monthly and annual side by side and commits to neither. The
   * billing page honours that (it only lets a *stated* interval move the
   * toggle, so an annual org is not silently flipped to monthly on arrival),
   * but every hop between the CTA and that page used to re-serialize the
   * intent with `&interval=month` appended — which made the omission
   * unrecoverable one redirect after it was made. Carrying the distinction is
   * what keeps "no interval stated" a thing the last reader can still see.
   */
  intervalStated: boolean
  /**
   * Enterprise is quoted, not bought. The CTA still carries `plan=enterprise`
   * because that is what the visitor clicked, and the console has to route
   * them to contact-sales rather than to a checkout that cannot price it
   * (AGL-1110).
   */
  contactSales: boolean
}

const SELF_SERVE_PLANS: readonly OrgPlan[] = [
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
  'agency',
]

/**
 * Read a plan intent off the URL, or null when there isn't a usable one.
 *
 * Null for `free` on purpose: it is a real plan but not a purchase, so there
 * is nothing to carry into checkout and a new org already starts there.
 * Returning an intent for it would send someone to a billing page to buy
 * what they already have.
 */
export function parseOnboardingPlanIntent(
  params:
    | URLSearchParams
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
): OnboardingPlanIntent | null {
  if (!params) return null
  const read = (key: string): string => {
    const raw =
      params instanceof URLSearchParams ? params.get(key) : params[key]
    // Next gives `string[]` for a repeated param. Take the first rather than
    // joining, so `?plan=pro&plan=free` cannot become the string "pro,free"
    // and fall through to null — the first is what the CTA meant.
    return String((Array.isArray(raw) ? raw[0] : raw) ?? '')
      .trim()
      .toLowerCase()
  }
  const plan = read('plan')
  if (!plan) return null
  if (isCustomPricedPlan(plan as OrgPlan)) {
    return {
      plan: plan as OrgPlan,
      interval: 'month',
      intervalStated: false,
      contactSales: true,
    }
  }
  if (!SELF_SERVE_PLANS.includes(plan as OrgPlan)) return null
  const interval = read('interval')
  const known = interval === 'year' || interval === 'annual' || interval === 'month'
  return {
    plan: plan as OrgPlan,
    // Anything unrecognized falls to monthly, never to yearly: guessing the
    // longer commitment from a malformed link is the expensive direction to
    // be wrong in.
    interval: interval === 'year' || interval === 'annual' ? 'year' : 'month',
    // A junk interval is not a stated one: `?interval=decade` means the link
    // is broken, and the reader should fall back to what it knows about the
    // org rather than be told "monthly" with a straight face.
    intervalStated: known,
    contactSales: false,
  }
}

/**
 * The intent as query params — the one place the wire form is written
 * (AGL-1535).
 *
 * Every hop that re-serializes an intent (the signup landing, the auth-bounce
 * `continue`, the home jump) used to build this string by hand and append
 * `&interval=` unconditionally, which turned the parser's monthly DEFAULT into
 * a statement the next reader could not tell from the real thing.
 */
export function onboardingPlanQuery(intent: OnboardingPlanIntent): string {
  return (
    `plan=${encodeURIComponent(intent.plan)}` +
    (intent.intervalStated ? `&interval=${intent.interval}` : '')
  )
}

/**
 * Where a freshly provisioned workspace should land, given the plan the
 * visitor picked on the marketing site.
 *
 * Deliberately returns a path rather than pushing: signup owns the
 * navigation, and a pure function is the half worth testing.
 */
export function onboardingDestination(
  orgSlug: string,
  intent: OnboardingPlanIntent | null,
): string {
  if (!orgSlug) return '/'
  if (!intent) return `/${orgSlug}`
  // Enterprise is a conversation, not a checkout (AGL-1110).
  if (intent.contactSales) return `/${orgSlug}/support?topic=enterprise`
  return `/${orgSlug}/billing?${onboardingPlanQuery(intent)}`
}
