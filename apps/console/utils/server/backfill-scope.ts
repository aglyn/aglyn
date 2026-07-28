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
 * Scope backfill planning (AGL-1040): decides what the staff route
 * `/api/admin/backfill-scope` writes, kept out of the route so it can be
 * unit-tested without a Firestore.
 *
 * The backfill is the gate between the AGL-1037 model and the AGL-1039/
 * 1041/1042 enforcement. Both the rules' `visibleTo.hasAny(...)` and the
 * client's `array-contains-any` **fail closed on a missing field** — a doc
 * with no `visibleTo` matches nothing. Ship enforcement first and every
 * dataset and image in the product disappears at once, so this runs first
 * and the plan below is deliberately a no-op semantically: `['org']` is
 * exactly today's behavior. Nobody loses access, nobody gains it.
 */

import {
  ORG_SCOPE_TOKEN,
  projectMemberScopeTokens,
  type AglynOrgMember,
  type ScopeToken,
} from '@aglyn/aglyn/server'

/** Collections whose docs get an org-wide `visibleTo` stamp. */
export const SCOPED_COLLECTIONS = [
  'datasets',
  'media',
  'mediaFolders',
  // CRM (AGL-1039): the tenant reads these per host too — a campaign sent
  // from one site must not reach another site's audience.
  'contacts',
  'contactSegments',
] as const

export type ScopedCollection = (typeof SCOPED_COLLECTIONS)[number]

/** One planned write; `path` is for the dry-run report, not for Firestore. */
export interface PlannedScopeWrite {
  id: string
  data: { visibleTo: ScopeToken[] } | { scopeTokens: ScopeToken[] }
}

export interface ScopeBackfillPlan {
  writes: PlannedScopeWrite[]
  /** Docs already carrying the field — skipped, so a re-run writes zero. */
  skipped: number
}

/**
 * Whether a doc still needs the org-wide stamp.
 *
 * An **empty array** counts as already-set and is left alone. It means
 * "visible to nobody", which `visibleToHost` honours (AGL-1037); silently
 * rewriting it to `['org']` here would turn a deliberately-hidden — or
 * bug-hidden — resource org-wide, which is the one direction this project
 * must never move a resource without someone asking for it.
 */
export function needsScopeStamp(data: { visibleTo?: unknown }): boolean {
  return !Array.isArray(data.visibleTo)
}

/**
 * Stamps `visibleTo: ['org']` on every doc that lacks it. Idempotent: the
 * second run plans zero writes, which is the acceptance criterion.
 */
export function planScopeStamp(
  docs: ReadonlyArray<{ id: string; data: { visibleTo?: unknown } }>,
): ScopeBackfillPlan {
  const writes: PlannedScopeWrite[] = []
  let skipped = 0
  for (const doc of docs) {
    if (needsScopeStamp(doc.data)) {
      writes.push({ id: doc.id, data: { visibleTo: [ORG_SCOPE_TOKEN] } })
    } else {
      skipped += 1
    }
  }
  return { writes, skipped }
}

/**
 * Recomputes `scopeTokens` for a roster (AGL-1038's projection), planning a
 * write only where the stored value actually differs. Unlike the resource
 * stamp this is a *recompute*, not a fill: a stale array from a partial
 * earlier failure must be corrected, not skipped.
 */
export function planMemberScopeTokens(
  members: ReadonlyArray<Partial<AglynOrgMember> & { $id: string }>,
): ScopeBackfillPlan {
  const writes: PlannedScopeWrite[] = []
  let skipped = 0
  for (const member of members) {
    const next = projectMemberScopeTokens(member)
    if (sameTokens(member.scopeTokens, next)) {
      skipped += 1
    } else {
      writes.push({ id: member.$id, data: { scopeTokens: next } })
    }
  }
  return { writes, skipped }
}

/** Order-insensitive token comparison; the projection's order is incidental. */
function sameTokens(
  current: readonly string[] | undefined,
  next: readonly string[],
): boolean {
  if (!Array.isArray(current) || current.length !== next.length) return false
  const have = new Set(current)
  return next.every((token) => have.has(token))
}

export interface ScopeBackfillTotals {
  orgs: number
  members: { written: number; skipped: number }
  datasets: { written: number; skipped: number }
  media: { written: number; skipped: number }
  mediaFolders: { written: number; skipped: number }
  contacts: { written: number; skipped: number }
  contactSegments: { written: number; skipped: number }
  /**
   * Legacy `hosts/{hostId}/datasets` docs seen (AGL-237's pre-migration
   * fallback). Counted, never touched: those are already site-private by
   * construction, and whether to migrate them into `orgs/{orgId}/datasets`
   * with `visibleTo: ['host:{hostId}']` or leave them is a decision that
   * wants this number in front of it first.
   */
  legacyHostDatasets: number
}

export function emptyTotals(): ScopeBackfillTotals {
  return {
    orgs: 0,
    members: { written: 0, skipped: 0 },
    datasets: { written: 0, skipped: 0 },
    media: { written: 0, skipped: 0 },
    mediaFolders: { written: 0, skipped: 0 },
    contacts: { written: 0, skipped: 0 },
    contactSegments: { written: 0, skipped: 0 },
    legacyHostDatasets: 0,
  }
}

/** Folds one collection's plan into the running totals. */
export function addPlan(
  totals: ScopeBackfillTotals,
  key: 'members' | ScopedCollection,
  plan: ScopeBackfillPlan,
): void {
  totals[key].written += plan.writes.length
  totals[key].skipped += plan.skipped
}
