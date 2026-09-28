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

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'

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
