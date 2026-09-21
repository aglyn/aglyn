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

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { pluginOrgCapacities } from '@aglyn/aglyn/plugin-manager/plugin-org-capacity'

/**
 * What a plan change would leave an org over, as data rather than sentences.
 *
 * Split out of `over-limit-summary.ts` because that file is `'use client'` and
 * opens the client Firestore SDK to fetch its counts, so a server route cannot
 * import it — and the server is where a downgrade is actually decided. The
 * comparison itself is the part that must not exist twice: it has already been
 * wrong once, measuring datasets against the purchase CEILING
 * (`maxDatasetsPerOrg`) while printing the word "includes" beside it, which
 * cleared orgs that a downgrade would strand. One rule, two readers — the
 * summary the customer reads before choosing, and the refusal they get if they
 * choose anyway.
 *
 * This module is deliberately pure: no I/O, no SDK, no `'use client'`.
 */

/**
 * A capacity a plan change can strand.
 *
 * ⛔ **The saved-form catalog is not one of them, and must not be added.**
 * `formsPerHost` is refused at the CREATE and nowhere else. A site holding
 * more forms than its ceiling — through a contract override, or a ceiling
 * lowered under a catalog already built — keeps every one of them, editable,
 * and every one keeps accepting submissions, which are metered revenue on
 * their own band; a catalog ceiling that reached them would refuse money as
 * well as data. There is nothing to release, so there is nothing to warn
 * about and nothing to refuse a downgrade over. The kinds here are the ones
 * where holding past the new plan really does mean capacity the org is no
 * longer entitled to.
 *
 * The ceiling also does not move with the plan, so a downgrade cannot strand
 * a catalog in the first place.
 *
 * A string rather than a closed union since AGL-3080, because the platform no
 * longer knows the whole set: `sites` and `seats` are its own — every
 * workspace has them with no plugin loaded — and every other capacity is
 * declared by the plugin that backs it. Nothing here switches on the value;
 * the two tables below are the only things that resolve one, and both are
 * derived from the same list.
 */
export type OverLimitKind = string

/**
 * The platform's own capacities, and their nouns.
 *
 * `held` names the things counted; `unreadable` names the capacity when there
 * is no count to attach a noun to — "5 team members" is a roster, "team seats
 * could not be checked" is a quota, and they are not the same word. A
 * declared capacity says `one`/`many` instead, and `many` is what it is
 * called in both positions: a plugin that needs the distinction can be given
 * it when one does, rather than every plugin being asked for a word twice.
 */
const CORE_CAPACITIES: ReadonlyArray<{
  kind: OverLimitKind
  order: number
  entitlement: 'hostLimit' | 'managersPerOrg'
  nouns: { held: string; unreadable: string }
}> = [
  {
    kind: 'sites',
    order: 10,
    entitlement: 'hostLimit',
    nouns: { held: 'sites', unreadable: 'sites' },
  },
  {
    kind: 'seats',
    order: 20,
    entitlement: 'managersPerOrg',
    nouns: { held: 'team members', unreadable: 'team seats' },
  },
]

/**
 * Every capacity, platform's then declared, in the order both readers present
 * — so the warning and the refusal list the same capacities in the same
 * sequence. The generator refuses a declared order that collides with core's.
 */
const CAPACITIES = [
  ...CORE_CAPACITIES,
  ...pluginOrgCapacities().map((one) => ({
    kind: one.kind,
    order: one.order,
    entitlement: one.includedEntitlement,
    nouns: { held: one.nouns.many, unreadable: one.nouns.many },
  })),
].sort((a, b) => a.order - b.order)

export const OVER_LIMIT_KINDS: readonly OverLimitKind[] = CAPACITIES.map(
  (one) => one.kind,
)

const NOUNS: Record<OverLimitKind, { held: string; unreadable: string }> =
  Object.fromEntries(CAPACITIES.map((one) => [one.kind, one.nouns]))

export interface OverLimitRow {
  kind: OverLimitKind
  /** What the org holds. `null` when the count could not be read. */
  count: number | null
  /**
   * What the target plan INCLUDES — never `maxDatasetsPerOrg` and friends,
   * which are what the org could reach by BUYING on top.
   */
  included: number
  /** How many must be released to fit. 0 when the count is unreadable. */
  excess: number
}

/**
 * Counts to measure. `undefined` means "not measured, leave it out";
 * `null` means "measured and unanswerable", which is reported as unchecked
 * rather than omitted — the reassuring failure is the dangerous one here.
 */
export interface OverLimitCounts {
  siteCount?: number | null
  managerSeats?: number | null
  /**
   * Counts for the declared capacities, keyed by kind. Named separately from
   * the platform's two because those two have callers that predate this and
   * read better spelled out; a declared capacity has no name core could have
   * chosen in advance.
   */
  declared?: Readonly<Record<string, number | null | undefined>>
}

/**
 * What the org would be over on `targetPlan`, in `OVER_LIMIT_KINDS` order so
 * the warning and the refusal list the same capacities in the same sequence.
 */
export function overLimitRows(
  counts: OverLimitCounts,
  targetPlan: OrgPlan,
): OverLimitRow[] {
  const target = PLAN_ENTITLEMENTS[targetPlan]
  if (!target) return []
  const held = (kind: OverLimitKind): number | null | undefined => {
    if (kind === 'sites') return counts.siteCount
    if (kind === 'seats') return counts.managerSeats
    return counts.declared?.[kind]
  }
  const rows: OverLimitRow[] = []
  for (const capacity of CAPACITIES) {
    const kind = capacity.kind
    const count = held(kind)
    /*
     * A declared capacity whose entitlement field is missing is measured as
     * ZERO included, which reports the org as over by everything it holds.
     * That is the loud failure and the right one: the alternative — treating
     * an unknown field as unlimited — would clear every org silently, which
     * is the reassuring answer this whole module exists to refuse.
     */
    const included = Number(
      (target as unknown as Record<string, unknown>)[capacity.entitlement] ?? 0,
    )
    if (count === undefined) continue
    if (count === null) {
      rows.push({ kind, count: null, included, excess: 0 })
      continue
    }
    if (count > included) {
      rows.push({ kind, count, included, excess: count - included })
    }
  }
  return rows
}

/**
 * One row as the pre-choice summary reads it: what you hold, what the plan
 * includes. No imperative — nothing is being refused at this point, the
 * customer is being told what a choice would cost them.
 */
export function overLimitSummaryLine(
  row: OverLimitRow,
  targetPlan: OrgPlan,
): string {
  const includes = `${targetPlan} includes ${row.included}`
  return row.count == null
    ? `${NOUNS[row.kind].unreadable} — could not be checked (${includes})`
    : `${row.count} ${NOUNS[row.kind].held} (${includes})`
}

/**
 * One row as a REFUSAL reads it: the count, the ceiling, and the number to
 * release. "You cannot do that" is a support ticket; "You have 8 datasets,
 * Starter includes 3, remove 5" is an action the customer can take without
 * asking anybody.
 *
 * Only meaningful for a row with a real count — an unreadable count names no
 * remedy and must never be the reason a plan change is refused.
 */
export function overLimitReleaseInstruction(
  row: OverLimitRow,
  targetPlan: OrgPlan,
): string {
  const plan = targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1)
  return (
    `You have ${row.count} ${NOUNS[row.kind].held}. ` +
    `${plan} includes ${row.included}. ` +
    `Remove ${row.excess} to continue.`
  )
}

/** The rows that name a remedy — an unreadable count is not one of them. */
export function blockingOverLimitRows(rows: OverLimitRow[]): OverLimitRow[] {
  return rows.filter((row) => row.count != null && row.excess > 0)
}
