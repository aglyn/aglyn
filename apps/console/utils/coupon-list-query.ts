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

import { rateCouponAgainstFullUse } from '@aglyn/aglyn/app-utils/full-use-cost'
// By its own module, not a barrel: this file is read by the page (client) and
// the route (server), and route specs stub the server barrel partially.
import {
  PLAN_LABELS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn/foundation'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  type StaffCompleteListColumns,
  staffCompleteListSorts,
} from './staff-complete-list-sort'

/*
 * THE STAFF COUPONS LIST (AGL-3321) — an exception to "every clause on the
 * Firestore query", because a coupon is not a Firestore document.
 *
 * Coupons live in Stripe. Stripe lists coupons and promotion codes by
 * creation date and cursor, filters promotion codes by code, coupon and
 * active state, and offers no search over coupons at all — nothing that
 * narrows by a coupon's name, duration, validity or redemption count. So
 * `/api/admin/coupons` reads EVERY coupon and every promotion code, paging
 * Stripe to the end, and answers the Filters panel and the search over that
 * complete read (`answerStaffCompleteList`). Past `COUPON_READ_BOUND` coupons
 * or `PROMOTION_CODE_READ_BOUND` codes it refuses the request with 413
 * rather than answer from the first part of them — the pre-AGL-3321 route
 * read the first hundred of each and said nothing about the rest.
 *
 * Because every row is in hand, the fields offer what plain matching can
 * answer — a mid-word `contains` and `doesNotContain` on the name — which a
 * Firestore-served list could not.
 */

/** Stripe's page size for a list call, which is also its maximum. */
export const STRIPE_LIST_PAGE = 100

/** The most coupons the list reads before it refuses rather than truncates. */
export const COUPON_READ_BOUND = 1_000

/** The most promotion codes the list reads before it refuses. */
export const PROMOTION_CODE_READ_BOUND = 2_000

/**
 * The longest coupon name Stripe accepts. A longer one is refused outright
 * ("must be at most 40 characters"), so the form stops there and the route
 * answers 400 before asking Stripe.
 */
export const COUPON_NAME_MAX = 40

/** A Stripe coupon's durations, as the create form and the filter offer them. */
export const COUPON_DURATIONS = [
  { value: 'once', label: 'Once' },
  { value: 'repeating', label: 'Repeating' },
  { value: 'forever', label: 'Forever' },
] as const

/** One promotion code as the console shows it. */
export interface CouponCodeRow {
  id: string
  code: string
  active: boolean
  timesRedeemed: number
  maxRedemptions?: number | null
}

/** One coupon as the route serializes it. */
export interface CouponRow {
  id: string
  name: string | null
  percentOff: number | null
  amountOffUsd: number | null
  currency?: string | null
  duration: string | null
  durationInMonths: number | null
  maxRedemptions: number | null
  timesRedeemed: number
  redeemBy: string | null
  valid: boolean
  created?: string | null
  codes: CouponCodeRow[]
  /**
   * What the discount reaches (AGL-4159): absent or null for the whole
   * subscription, otherwise the Stripe products it is limited to and the
   * self-serve plans whose base price those products are.
   */
  appliesTo?: CouponAppliesTo | null
}

/**
 * A coupon limited to plans' base prices (AGL-4159), as Stripe enforces it:
 * `applies_to.products`. `plans` is read back from the deployment's own plan
 * prices (`STRIPE_PRICE_<PLAN>[_YEARLY]` → price → product), never from a
 * stored list, so it names what the coupon really reaches today.
 */
export interface CouponAppliesTo {
  products: string[]
  plans: OrgPlan[]
}

/**
 * The plans a coupon can be limited to: the self-serve plans that are sold
 * at a price, in ladder order (Starter, Pro). Read off `SELF_SERVE_PLANS`, so
 * a retired plan is never offered and a new one is offered without an edit.
 */
export const COUPON_PLAN_CHOICES: readonly OrgPlan[] = SELF_SERVE_PLANS.filter(
  (plan) => PLAN_PRICING[plan]?.basePriceMonthlyUsd > 0,
)

/**
 * What a new coupon applies to (AGL-4159). `subscription` is every line of
 * the bill, the behavior every coupon had before; `base_price` is only the
 * base price of the plan, or plans, it names, so add-ons, usage past the
 * plan's limits and a move to another plan bill in full.
 */
export type CouponAppliesToChoice = 'subscription' | 'base_price'

export const COUPON_APPLIES_TO_CHOICES: readonly CouponAppliesToChoice[] = [
  'subscription',
  'base_price',
]

/** "Starter", "Starter and Pro", "Starter, Pro and Max". */
export function couponPlanList(plans: readonly OrgPlan[]): string {
  const labels = plans.map((plan) => PLAN_LABELS[plan] ?? plan)
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * The plans a coupon's discount is limited to, or null for one that reaches
 * the whole subscription. An empty list is a coupon limited to products no
 * plan sold today is priced on.
 */
export function couponAppliesToPlans(
  row: Pick<CouponRow, 'appliesTo'>,
): OrgPlan[] | null {
  return row.appliesTo ? row.appliesTo.plans : null
}

/** The Applies to column: "Whole subscription", "Base price, Starter", … */
export function couponAppliesToLabel(row: Pick<CouponRow, 'appliesTo'>): string {
  const plans = couponAppliesToPlans(row)
  if (plans == null) return 'Whole subscription'
  if (!plans.length) return 'Products no plan uses'
  if (COUPON_PLAN_CHOICES.every((plan) => plans.includes(plan))) {
    return 'Base price, any plan'
  }
  return `Base price, ${couponPlanList(plans)}`
}

/** A coupon row as the list matches and renders it: the fields the panel reads. */
export type CouponListRow = CouponRow & {
  $id: string
  status: 'valid' | 'expired'
  codeText: string[]
}

/** The derived fields a coupon is filtered and searched by. */
export function couponListRow(coupon: CouponRow): CouponListRow {
  return {
    ...coupon,
    $id: coupon.id,
    status: coupon.valid ? 'valid' : 'expired',
    codeText: coupon.codes.map((code) => code.code),
  }
}

const PICKED = ['equals', 'doesNotEqual', 'isAnyOf'] as const

/** What the Existing coupons panel filters by, matched over every coupon. */
export const COUPON_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    operators: ['contains', 'doesNotContain', 'equals', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'],
  },
  { column: 'duration', kind: 'exact', path: 'duration', operators: PICKED },
  { column: 'status', kind: 'exact', path: 'status', operators: PICKED },
  { column: 'timesRedeemed', kind: 'number', path: 'timesRedeemed', presence: 'always' },
]

export const COUPON_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Coupon',
  duration: 'Duration',
  status: 'Status',
  timesRedeemed: 'Redeemed',
}

export const COUPON_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  duration: COUPON_DURATIONS.map(({ value, label }) => ({ value, label })),
  status: [
    { value: 'valid', label: 'Valid' },
    { value: 'expired', label: 'Expired' },
  ],
}

/** The search: a coupon's name, its Stripe id, or any of its promotion codes. */
export const COUPON_SEARCH_PATHS: readonly string[] = ['name', 'id', 'codeText']

/**
 * A coupon's full-use verdict (AGL-3473): the worst plan and billing
 * combination it could be redeemed on. The page's Full-use cost column and
 * its sort both read it.
 */
export function couponFullUse(
  row: Pick<CouponRow, 'percentOff' | 'amountOffUsd' | 'duration' | 'durationInMonths'> &
    Partial<Pick<CouponRow, 'appliesTo'>>,
) {
  return rateCouponAgainstFullUse(
    row.percentOff != null
      ? { percentOff: row.percentOff }
      : row.amountOffUsd != null
        ? { amountOffUsd: row.amountOffUsd }
        : {},
    { duration: row.duration, durationInMonths: row.durationInMonths },
    // A coupon limited to one plan is redeemed on that plan only (AGL-4159).
    couponAppliesToPlans(row),
  )
}

/*
 * THE HEADER SORTS (AGL-3680, strategy 4s): every column, ordered by the
 * route over the complete read and then paged — see
 * `utils/staff-complete-list-sort.ts`. Each compares what the column SHOWS.
 * With none asked the list stays in Stripe's order, newest first.
 */
export const COUPON_SORT_COLUMNS: StaffCompleteListColumns<CouponListRow> = {
  name: { label: 'Coupon', value: (row) => row.name ?? row.id },
  // Percent-off and amount-off coupons are different units: each kind
  // together, by size within it ("amount 10" before "amount 25").
  discount: {
    label: 'Discount',
    value: (row) =>
      row.percentOff != null
        ? `percent ${row.percentOff}`
        : row.amountOffUsd != null
          ? `amount ${row.amountOffUsd}`
          : null,
  },
  duration: {
    label: 'Duration',
    value: (row) =>
      row.duration === 'repeating' ? `repeating ${row.durationInMonths ?? ''}` : row.duration,
  },
  // What the discount reaches (AGL-4159), as the column words it.
  appliesTo: { label: 'Applies to', value: (row) => couponAppliesToLabel(row) },
  // How far the worst charge covers its full-use cost: the riskiest first ascending.
  fullUse: { label: 'Full-use cost', value: (row) => couponFullUse(row).worst.coverage },
  codes: {
    label: 'Codes',
    value: (row) => [...row.codeText].sort().join(' ') || null,
  },
  timesRedeemed: { label: 'Redeemed', value: (row) => row.timesRedeemed },
  status: { label: 'Status', value: (row) => row.status },
}

export const COUPON_COLUMN_SORTS = staffCompleteListSorts(COUPON_SORT_COLUMNS)
