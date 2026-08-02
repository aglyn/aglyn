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
 * What support each plan actually commits to (AGL-1103).
 *
 * Support was one binary gate — `plan !== 'free'` — so a Starter org and an
 * Enterprise org got the identical queue, the identical silence, and no stated
 * target either could hold us to. The plans imply tiers; nothing implemented
 * them.
 *
 * These numbers are a COMMERCIAL COMMITMENT, not an engineering choice. They
 * are set deliberately long: a published target is easy to tighten and painful
 * to loosen, and the only thing worse than a slow promise is a fast one that
 * gets missed. Changing them changes what customers are owed, so they live
 * here alone and nowhere else.
 */

import type { OrgPlan } from '../foundation'

/** Ordered weakest → strongest; the queue sorts on this. */
export type SupportTier =
  | 'community'
  | 'standard'
  | 'business'
  | 'priority'
  | 'dedicated'

/**
 * A first-response window.
 *
 * The unit is explicit per tier rather than normalised, because the two are
 * genuinely different promises and collapsing them hides that. "3 business
 * days" spans a weekend; "48 hours" does not. Enterprise is quoted in clock
 * hours precisely because it is the tier that does not stop on Friday.
 */
export interface ResponseWindow {
  min: number
  max: number
  unit: 'business-days' | 'hours'
}

export interface SupportCommitment {
  tier: SupportTier
  /** Shown to customers. */
  label: string
  /** `null` means no ticket commitment — the forum is the channel. */
  firstResponse: ResponseWindow | null
  /** A named human, not a queue. Enterprise only. */
  namedManager: boolean
  /**
   * Access to the community forum.
   *
   * True on every tier including Community, and that is the whole meaning of
   * "forum only": a tier with no ticket commitment whose forum was also shut
   * would have no support channel at all, which is not a tier — it is nothing
   * wearing a tier's name.
   */
  forum: boolean
}

/**
 * Every plan's commitment.
 *
 * `Record<OrgPlan, …>` on purpose: a new plan fails to compile here rather
 * than silently inheriting whatever the lookup's fallback happens to be, which
 * for support means either promising something we never agreed or promising
 * nothing to someone who paid.
 */
export const SUPPORT_BY_PLAN: Record<OrgPlan, SupportCommitment> = {
  free: {
    tier: 'community',
    label: 'Community',
    firstResponse: null,
    namedManager: false,
    forum: true,
  },
  starter: {
    tier: 'community',
    label: 'Community',
    // Forum only, same as Free: ticket support starts at Pro. Starter pays
    // for product, not for our time.
    firstResponse: null,
    namedManager: false,
    forum: true,
  },
  pro: {
    tier: 'standard',
    label: 'Standard',
    firstResponse: { min: 7, max: 14, unit: 'business-days' },
    namedManager: false,
    forum: true,
  },
  business: {
    tier: 'business',
    label: 'Business',
    firstResponse: { min: 4, max: 6, unit: 'business-days' },
    namedManager: false,
    forum: true,
  },
  scale: {
    tier: 'business',
    label: 'Business',
    firstResponse: { min: 4, max: 6, unit: 'business-days' },
    namedManager: false,
    forum: true,
  },
  advanced: {
    tier: 'business',
    label: 'Business',
    firstResponse: { min: 4, max: 6, unit: 'business-days' },
    namedManager: false,
    forum: true,
  },
  agency: {
    tier: 'priority',
    label: 'Priority',
    firstResponse: { min: 1, max: 3, unit: 'business-days' },
    namedManager: false,
    forum: true,
  },
  enterprise: {
    tier: 'dedicated',
    label: 'Dedicated',
    // Quoted in CLOCK hours, and that is the point of the tier: 24–48 hours
    // runs through a weekend, where "1–3 business days" does not. Read as
    // business hours it would be 3–6 business days — SLOWER than Agency
    // above, inverting the ladder. `ladderIsMonotonic` below asserts it is
    // not, so this cannot silently regress.
    firstResponse: { min: 24, max: 48, unit: 'hours' },
    namedManager: true,
    forum: true,
  },
}

/** Strength order, weakest first — the index IS the rank. */
export const SUPPORT_TIER_ORDER: SupportTier[] = [
  'community',
  'standard',
  'business',
  'priority',
  'dedicated',
]

/** Higher is stronger. Used to order the staff queue. */
export function supportTierRank(tier: SupportTier): number {
  return SUPPORT_TIER_ORDER.indexOf(tier)
}

export function supportForPlan(plan: OrgPlan | undefined | null): SupportCommitment {
  // An unknown or missing plan gets the community tier, never a paid one:
  // failing open here would hand an unpaid org a response target.
  return SUPPORT_BY_PLAN[plan as OrgPlan] ?? SUPPORT_BY_PLAN.free
}

/** "7–14 business days" · "24–48 hours" · "1 business day". */
export function describeResponseWindow(window: ResponseWindow | null): string | null {
  if (!window) return null
  const unit =
    window.unit === 'hours'
      ? 'hours'
      : window.max === 1
        ? 'business day'
        : 'business days'
  const range = window.min === window.max ? `${window.max}` : `${window.min}–${window.max}`
  return `${range} ${unit}`
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/**
 * Advance past `count` business days, skipping Saturday and Sunday.
 *
 * Deliberately does NOT know about public holidays. A half-right holiday
 * calendar is worse than none — it would quietly shorten the deadline in
 * whichever country it did not cover, and support is answered from more than
 * one. The stated window is long enough to absorb them; when that stops being
 * true this needs a real calendar, not a patch.
 */
export function addBusinessDays(fromMs: number, count: number): number {
  let cursor = fromMs
  let remaining = count
  while (remaining > 0) {
    cursor += DAY_MS
    const day = new Date(cursor).getUTCDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return cursor
}

/**
 * When a first response is owed at the latest, or `null` if nothing is owed.
 *
 * Always the MAX of the window. The range is what we tell customers; the
 * commitment is its upper bound, and that is the only number a breach can be
 * measured against.
 */
export function responseDueAt(
  commitment: SupportCommitment,
  openedAtMs: number,
): number | null {
  const window = commitment.firstResponse
  if (!window) return null
  return window.unit === 'hours'
    ? openedAtMs + window.max * HOUR_MS
    : addBusinessDays(openedAtMs, window.max)
}

/**
 * Is the ladder still strictly better as plans get stronger?
 *
 * Exported so a test can assert it, because the failure is silent and the
 * units differ across tiers: quoting Enterprise in business hours rather than
 * clock hours makes it slower than Agency while every individual number still
 * looks reasonable on its own. Compares worst cases as elapsed wall-clock from
 * a Monday, which is the only basis on which the two units are comparable.
 */
export function ladderIsMonotonic(mondayMs: number): boolean {
  const seen = new Map<SupportTier, number>()
  for (const commitment of Object.values(SUPPORT_BY_PLAN)) {
    const due = responseDueAt(commitment, mondayMs)
    if (due === null) continue
    const elapsed = due - mondayMs
    const previous = seen.get(commitment.tier)
    // Plans sharing a tier must quote the same window.
    if (previous !== undefined && previous !== elapsed) return false
    seen.set(commitment.tier, elapsed)
  }
  const ranked = SUPPORT_TIER_ORDER.filter((tier) => seen.has(tier)).map((tier) =>
    seen.get(tier) as number,
  )
  return ranked.every((value, index) => index === 0 || value < ranked[index - 1])
}
