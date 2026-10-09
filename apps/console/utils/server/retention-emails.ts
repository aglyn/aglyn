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
  RETENTION_BUILD_SITE_EMAIL,
  RETENTION_IDLE_EMAIL,
  RETENTION_NEXT_STEPS_EMAIL,
  RETENTION_PUBLISH_REMINDER_EMAIL,
  RETENTION_VERIFY_REMINDER_EMAIL,
} from '@aglyn/shared-util-email'

/**
 * WHICH GETTING-STARTED EMAIL AN ACCOUNT IS OWED, IF ANY (AGL-3692).
 *
 * Pure: the route reads the facts and this decides. That keeps every rule
 * about timing, deduplication and "stop once they act" in one place a spec
 * can walk without Firestore.
 *
 * ## Once per crossing
 *
 * Every email has a CROSSING key, and an account's sent crossings are kept
 * on `users/{uid}.lifecycleEmails` (key → sent-at ms). A crossing that is
 * recorded never fires again. The idle crossings carry the day the person
 * was last seen, so a quiet spell is mailed at most once at 7 days and once
 * at 14. Coming back and going quiet again is a new crossing.
 *
 * ## Stopping once the person acts
 *
 * Nothing is scheduled ahead. Each hourly run asks the account's state NOW,
 * so the verification reminder stops at verification, the build nudge at the
 * first page of their own, the publish reminder at a publish, and the idle
 * nudge at the next sign-in.
 *
 * ## At most one email per account per run
 *
 * The first rule that applies wins, in the order below. An account that is
 * owed two things gets the second one an hour later at the earliest, and only
 * if it is still owed.
 */

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

/** The `users/{uid}` field recording sent crossings. */
export const LIFECYCLE_EMAILS_FIELD = 'lifecycleEmails'

/**
 * An account seen in the console this recently is mid-session: a nudge now
 * would land while they are doing the thing it nudges them to do.
 */
export const ACTIVE_SESSION_MS = HOUR_MS

/** The furthest back any rule reaches, which bounds the sweep's candidates. */
export const RETENTION_LOOKBACK_MS = 30 * DAY_MS

export interface RetentionFacts {
  nowMs: number
  createdAtMs: number
  /** Last sign-in or token refresh, whichever is later. */
  lastSeenMs: number | null
  emailVerified: boolean
  /** The account answered No to product email (or left that list). */
  declinedProductEmail: boolean
  /** Crossing key → sent-at ms. */
  sent: Readonly<Record<string, number>>
  /** Pages the person made or changed (not the starter pages). */
  ownPages: number
  /** Own pages changed after their last publish, or never published. */
  unpublishedEdits: boolean
  lastEditMs: number | null
  /** Latest publish of a page of their own, or null for none. */
  lastOwnPublishMs: number | null
}

export interface RetentionDecision {
  key: string
  crossing: string
}

function dayStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function fresh(
  facts: RetentionFacts,
  key: string,
  crossing: string,
): RetentionDecision | null {
  return facts.sent[crossing] ? null : { key, crossing }
}

export function planRetentionEmail(
  facts: RetentionFacts,
): RetentionDecision | null {
  const { nowMs } = facts
  const age = nowMs - facts.createdAtMs
  if (!Number.isFinite(age) || age < 0) return null

  // 1. Unconfirmed: account mail, so the product email answer does not
  //    apply. A late run never sends the 1h reminder after the 24h mark.
  if (!facts.emailVerified) {
    if (age >= HOUR_MS && age < DAY_MS) {
      return fresh(facts, RETENTION_VERIFY_REMINDER_EMAIL, 'verify-1h')
    }
    if (age >= DAY_MS && age < 7 * DAY_MS) {
      return fresh(facts, RETENTION_VERIFY_REMINDER_EMAIL, 'verify-24h')
    }
    return null
  }

  // Everything below is a product tip.
  if (facts.declinedProductEmail) return null
  const sinceSeen =
    facts.lastSeenMs === null ? Number.POSITIVE_INFINITY : nowMs - facts.lastSeenMs
  if (sinceSeen < ACTIVE_SESSION_MS) return null

  // 2. First own publish: what to do next, once, while it is news.
  if (
    facts.lastOwnPublishMs !== null &&
    nowMs - facts.lastOwnPublishMs < 7 * DAY_MS &&
    !facts.sent['next-steps']
  ) {
    return { key: RETENTION_NEXT_STEPS_EMAIL, crossing: 'next-steps' }
  }

  // 3. Nothing of their own yet: no workspace, no site, or starter pages.
  if (facts.ownPages === 0) {
    if (age >= DAY_MS && age < 3 * DAY_MS) {
      return fresh(facts, RETENTION_BUILD_SITE_EMAIL, 'build-24h')
    }
    if (age >= 3 * DAY_MS && age < 14 * DAY_MS) {
      return fresh(facts, RETENTION_BUILD_SITE_EMAIL, 'build-3d')
    }
    return null
  }

  // 4. Edited, never published any of it.
  if (
    facts.unpublishedEdits &&
    facts.lastOwnPublishMs === null &&
    facts.lastEditMs !== null &&
    nowMs - facts.lastEditMs >= DAY_MS &&
    nowMs - facts.lastEditMs < RETENTION_LOOKBACK_MS
  ) {
    const decision = fresh(facts, RETENTION_PUBLISH_REMINDER_EMAIL, 'publish')
    if (decision) return decision
  }

  // 5. Worked on the site, then went quiet.
  if (facts.lastSeenMs !== null) {
    const day = dayStamp(facts.lastSeenMs)
    if (sinceSeen >= 7 * DAY_MS && sinceSeen < 14 * DAY_MS) {
      return fresh(facts, RETENTION_IDLE_EMAIL, `idle-7d:${day}`)
    }
    if (sinceSeen >= 14 * DAY_MS && sinceSeen < RETENTION_LOOKBACK_MS) {
      return fresh(facts, RETENTION_IDLE_EMAIL, `idle-14d:${day}`)
    }
  }
  return null
}

/**
 * Whether an auth record is worth reading Firestore for: some rule above
 * could apply to it. Cheap, from the auth record alone.
 */
export function isRetentionCandidate(input: {
  nowMs: number
  createdAtMs: number
  lastSeenMs: number | null
  emailVerified: boolean
}): boolean {
  const age = input.nowMs - input.createdAtMs
  if (!Number.isFinite(age) || age < HOUR_MS) return false
  if (!input.emailVerified) return age < 7 * DAY_MS
  if (age < RETENTION_LOOKBACK_MS) return true
  return (
    input.lastSeenMs !== null &&
    input.nowMs - input.lastSeenMs >= 7 * DAY_MS &&
    input.nowMs - input.lastSeenMs < RETENTION_LOOKBACK_MS
  )
}

/** One page as the sweep reads it from `hosts/{hostId}/screens`. */
export interface RetentionPage {
  createdAtMs: number | null
  updatedAtMs: number | null
  publishedAtMs: number | null
  createdBy: string | null
  deleted: boolean
}

/** Slack between a write and its own timestamps, as activation measures it. */
const SAME_WRITE_MS = 60 * 1000

/**
 * The page facts the planner wants, from a site's pages.
 *
 * A starter page (provisioned with the site) has no `createdBy` and is never
 * touched after creation. A page counts as the person's own when they made
 * it, or changed it a minute or more after it was created. Its publish counts
 * as theirs when it came after that change, or the page is theirs outright.
 */
export function summarizePages(pages: readonly RetentionPage[]): Pick<
  RetentionFacts,
  'ownPages' | 'unpublishedEdits' | 'lastEditMs' | 'lastOwnPublishMs'
> {
  let ownPages = 0
  let unpublishedEdits = false
  let lastEditMs: number | null = null
  let lastOwnPublishMs: number | null = null
  for (const page of pages) {
    if (page.deleted) continue
    const created = page.createdAtMs ?? 0
    const updated = page.updatedAtMs ?? created
    const changed = updated - created >= SAME_WRITE_MS
    const own = Boolean(page.createdBy) || changed
    if (!own) continue
    ownPages += 1
    lastEditMs = Math.max(lastEditMs ?? 0, updated)
    const published = page.publishedAtMs
    if (published === null) {
      unpublishedEdits = true
      continue
    }
    if (updated - published >= SAME_WRITE_MS) unpublishedEdits = true
    if (page.createdBy || published - created >= SAME_WRITE_MS) {
      lastOwnPublishMs = Math.max(lastOwnPublishMs ?? 0, published)
    }
  }
  return { ownPages, unpublishedEdits, lastEditMs, lastOwnPublishMs }
}
