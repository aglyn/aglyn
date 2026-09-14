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

import type { AiJobKind } from './ai-jobs.types'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'

/**
 * PER-USER AI USAGE (AGL-2928): the pure half.
 *
 * The org rollup at `assistUsage/{month}` says what a workspace spent on AI
 * and nothing about who spent it. This module is the shape and the arithmetic
 * of the second rollup — one document per person per month, under the org,
 * keyed by uid — so an agency or a multi-brand workspace can see which of its
 * people, on which site, is generating what. No prose, no PII beyond the uid
 * the document is keyed by.
 *
 * The write lives in the plugin's `usage/ai-usage-by-user.ts`, inside the
 * same batch as the org rollup. Everything here is dependency-free so the
 * plugin's tables and the doors that serve them read one definition of a
 * share, a month key and a retention window.
 */

/** `orgs/{orgId}/{this}/{uid}/{months}/{YYYY-MM}` — the subcollection names. */
export const AI_USAGE_BY_USER_COLLECTION = 'aiUsageByUser'
export const AI_USAGE_BY_USER_MONTHS_COLLECTION = 'months'

/**
 * How many months a person's usage is kept, counted from the month it
 * describes. Thirteen: a full year of month-over-month comparison for a
 * workspace admin, plus the month in progress. A TTL policy on the month
 * document's `expiresAt` enforces it — see `aiUsageByUserExpiry`.
 */
export const AI_USAGE_BY_USER_RETENTION_MONTHS = 13

/**
 * What an AI request was FOR, as the per-user rollup buckets it.
 *
 * `assist` is a console chat turn; `element`, `blog` and `section` are the
 * besigner's three assist modes; the rest are generation job kinds, named
 * exactly as the job document names them so a reader can join the two.
 */
export type AiUsageKind = 'assist' | 'element' | 'blog' | 'section' | AiJobKind

/** One person's month, zero-filled — the shape every reader hands on. */
export interface AiUsageByUserMonth {
  uid: string
  month: string
  /** Credits drawn, each request rounded up as the meter rounds. */
  credits: number
  /**
   * The measured provider spend behind `credits`. Server-side only: no
   * customer surface renders it, and `aiUsageShare` is how it becomes a
   * figure a customer may see.
   */
  estCostUsd: number
  requests: number
  refusals: number
  /** Credits by `AiUsageKind`. */
  byKind: Record<string, number>
  /** Credits by host id, for requests that named a site. */
  byHost: Record<string, number>
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

/** Whether `value` is a `YYYY-MM` month key. */
export function isAiUsageMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY.test(value)
}

/**
 * The month keys a reader may ask for, newest first: the month in progress
 * and the twelve before it — the retention window, so a picker built from
 * this list never names a month the TTL has reaped.
 */
export function aiUsageMonthKeys(
  now: Date = new Date(),
  count: number = AI_USAGE_BY_USER_RETENTION_MONTHS,
): string[] {
  const keys: string[] = []
  for (let back = 0; back < count; back += 1) {
    keys.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
        .toISOString()
        .slice(0, 7),
    )
  }
  return keys
}

/** Whether `month` is inside the window `aiUsageMonthKeys` describes. */
export function aiUsageMonthWithinRetention(
  month: string,
  now: Date = new Date(),
): boolean {
  return isAiUsageMonthKey(month) && aiUsageMonthKeys(now).includes(month)
}

/**
 * When a month document expires: the first instant of the month that is
 * `AI_USAGE_BY_USER_RETENTION_MONTHS` after the one it describes has closed.
 *
 * A `Date`, not a number: the TTL policy keys on a Firestore Timestamp and
 * silently governs nothing when the field is a number. Deterministic per
 * month, so every increment into the document re-stamps the same value and
 * the policy never moves under a month that is still being written.
 */
export function aiUsageByUserExpiry(month: string): Date {
  if (!isAiUsageMonthKey(month)) {
    throw new Error(`not a month key: ${month}`)
  }
  const [year, monthOfYear] = month.split('-').map(Number)
  return new Date(
    Date.UTC(year, monthOfYear + AI_USAGE_BY_USER_RETENTION_MONTHS, 1),
  )
}

/**
 * The kind an assist request was, read off the route it arrived on — for the
 * meters that carry a route and no kind of their own. The three besigner
 * modes name themselves in the path; everything else is a chat turn.
 */
export function aiUsageKindFromRoute(route: string | null | undefined): AiUsageKind {
  const tail = String(route ?? '').split('/').filter(Boolean).pop() ?? ''
  if (tail === 'element' || tail === 'blog' || tail === 'section') return tail
  return 'assist'
}

/**
 * One person's share of the workspace's spend for the month, in `[0, 1]`.
 *
 * Measured on the dollar figures, never on credits: the org meter rounds the
 * month's spend up ONCE, while a person's credits round each request up, so
 * a roster's credits can sum to a little more than the pool they drew from.
 * The ratio of measured spends has no such drift. Clamped, because a month
 * document written a moment after the org rollup is still a fraction, not a
 * percentage over one hundred — and rounded to a basis point, which is finer
 * than any surface renders and coarser than floating-point noise.
 */
export function aiUsageShare(
  userEstCostUsd: number,
  orgEstCostUsd: number,
): number {
  const user = Number(userEstCostUsd)
  const org = Number(orgEstCostUsd)
  if (!Number.isFinite(user) || user <= 0) return 0
  if (!Number.isFinite(org) || org <= 0) return 0
  return Math.min(1, Math.round((user / org) * 10_000) / 10_000)
}

const finite = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const creditMap = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(
    (raw ?? {}) as Record<string, unknown>,
  )) {
    const credits = Math.floor(finite(value))
    if (credits > 0) out[key] = credits
  }
  return out
}

/**
 * A month document as a complete record. Absent and malformed fields read as
 * zero; a `credits` the writer never set is derived from the spend, so a
 * document written before the field existed still ranks.
 */
export function aiUsageByUserMonthFrom(
  raw: Record<string, unknown> | null | undefined,
  uid: string,
  month: string,
): AiUsageByUserMonth {
  const estCostUsd = finite(raw?.['estCostUsd'])
  const stored = Math.floor(finite(raw?.['credits']))
  return {
    uid,
    month,
    credits: stored > 0 ? stored : assistCreditsFromUsd(estCostUsd),
    estCostUsd,
    requests: Math.floor(finite(raw?.['requests'])),
    refusals: Math.floor(finite(raw?.['refusals'])),
    byKind: creditMap(raw?.['byKind']),
    byHost: creditMap(raw?.['byHost']),
  }
}

/** The kinds a person drew the most credits on, dearest first. */
export function topAiUsageKinds(
  byKind: Record<string, number>,
  limit = 3,
): Array<{ kind: string; credits: number }> {
  return Object.entries(byKind)
    .map(([kind, credits]) => ({ kind, credits }))
    .sort((a, b) => b.credits - a.credits || a.kind.localeCompare(b.kind))
    .slice(0, limit)
}

/** Two month documents for one person, summed — the roster column's figure. */
export function sumAiUsageCredits(months: readonly AiUsageByUserMonth[]): number {
  return months.reduce((sum, entry) => sum + entry.credits, 0)
}
