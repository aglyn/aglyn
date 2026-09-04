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
 * You cannot drop capacity you are standing on.
 *
 * Manager seats, extra sites and extra datasets were all checked at CREATE
 * time and nowhere else, so "buy a seat, invite the person, drop the seat,
 * they keep working" cost nothing. `hostLimit` is the worst of the three: it
 * is consulted at exactly one moment in a site's life, the transaction that
 * mints it, and publishing is a client write with no server gate at all.
 *
 * THE ENFORCEMENT POINT IS THE REDUCTION, NOT THE USE. Re-checking at use time
 * would mean ejecting a teammate or locking a dataset, and it would land on
 * customers who merely downgraded rather than on anyone gaming it —
 * `CollaboratorSeatLimitError.retainedOverCap` is the product already having
 * decided not to do that. Refusing the reduction closes the same hole without
 * anyone losing access: the customer releases first, deliberately, or keeps
 * paying. It is also honest about WHEN, because the refusal arrives while they
 * are making the decision rather than silently afterwards.
 *
 * This is `b993d5c54`'s pooled-seat gate one level out. That commit refused a
 * `posRegisters`/`members` reduction below the assigned count for the same
 * reason it is refused rather than auto-released: WHICH thing loses capacity
 * is a business decision, and picking one is the arbitrary answer the gate
 * exists to replace.
 *
 * GRANDFATHERING SURVIVES, and the clamp below is what preserves it. An org
 * that is over a cap for reasons it did not choose — a plan we changed, a
 * migration, a staff entitlement shrink — keeps everything it has, and the
 * gate never demands more than the PURCHASE is carrying. An org holding no
 * add-on can therefore never be refused by it, however far over it is.
 */

import { countManagerSeats, type OrgPlan } from '@aglyn/aglyn/server'
import { firebaseAdmin, listOrgMembers } from '@aglyn/tenant-data-admin'
import {
  blockingOverLimitRows,
  overLimitReleaseInstruction,
  overLimitRows,
  type OverLimitCounts,
  type OverLimitRow,
} from '../over-limit'
import type { AddonKind } from './billing-addons'

/**
 * The add-on kinds this gate covers: org-wide capacity whose limit is checked
 * only when something is CREATED.
 *
 * `posRegisters` and `members` are absent because they are pools with an
 * allocation map, already gated at the same moment by `allocatedSeatTotal`
 * (AGL-2439/2438), and `eventCalendar` is absent because it is a feature
 * switch — turning it off refuses a capability, not a person or their data,
 * which is exactly the class that never needed this.
 */
export type CapacityAddonKind = 'hosts' | 'datasets' | 'managers'

export const CAPACITY_ADDON_KINDS: readonly CapacityAddonKind[] = [
  'hosts',
  'datasets',
  'managers',
]

export function isCapacityAddonKind(
  kind: AddonKind | string,
): kind is CapacityAddonKind {
  return (CAPACITY_ADDON_KINDS as readonly string[]).includes(kind)
}

/**
 * `null` throughout means "could not be counted", never zero. A count nobody
 * could read is the reassuring failure: read as 0 it clears every gate here.
 *
 * The same bag the plan-change comparison takes, aliased rather than restated
 * so one set of counts feeds both gates and the two cannot drift apart on what
 * a field is called or what `null` means in it.
 */
export type CapacityCounts = OverLimitCounts

/**
 * Sites the org holds, counted the way the CREATE-time quota counts them:
 * the larger of the `hosts` aggregation and the `orgs/{id}.hosts` directory
 * map (`claimHostForOrg`). Two counts because each covers what the other
 * misses — the aggregation is authoritative for sites that predate the map,
 * the map for sites a concurrent transaction has just claimed.
 *
 * Every site the org holds counts, published or not. `hostLimit` makes no
 * distinction at the transaction that mints one, so a gate that counted only
 * published sites would refuse against a different population than the quota
 * it protects, and a draft would be a free extra site.
 */
export async function countOrgSites(
  orgId: string,
  org?: Record<string, unknown> | null,
): Promise<number | null> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const aggregated = (
      await firestore.collection('hosts').where('orgId', '==', orgId).count().get()
    ).data().count
    const directory = org?.['hosts']
    const mapped =
      directory && typeof directory === 'object'
        ? Object.values(directory as Record<string, unknown>).filter(Boolean)
            .length
        : 0
    return Math.max(Number(aggregated) || 0, mapped)
  } catch (error) {
    console.warn('[capacity] site count unreadable', { orgId, error })
    return null
  }
}

/** Datasets the org holds — `orgs/{orgId}/datasets`, what `checkDatasetQuota` meters. */
export async function countOrgDatasets(orgId: string): Promise<number | null> {
  try {
    const count = (
      await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .collection('datasets')
        .count()
        .get()
    ).data().count
    return Number(count) || 0
  } catch (error) {
    console.warn('[capacity] dataset count unreadable', { orgId, error })
    return null
  }
}

/**
 * Manager seats HELD, roster plus un-accepted invites — the same total
 * `/api/orgs/members?counts=1` answers, and the same one the invite gate
 * refuses against. An invite that has been sent is holding its seat; leaving
 * invites out would let an org drop a seat that a pending teammate is about to
 * land on.
 */
export async function countOrgManagerSeats(
  orgId: string,
): Promise<number | null> {
  try {
    const members = await listOrgMembers(orgId)
    const pending = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('invites')
      .where('acceptedAt', '==', null)
      .get()
    return (
      countManagerSeats(members as never) +
      countManagerSeats(pending.docs.map((doc) => doc.data() as never))
    )
  } catch (error) {
    console.warn('[capacity] manager seat count unreadable', { orgId, error })
    return null
  }
}

/**
 * The counts a caller asks for, and only those.
 *
 * Read lazily and per kind on purpose. Every one of these is an aggregation or
 * a collection list, and the gate that needs them fires on a REDUCTION — a
 * rare action. Counting all three on every billing page load would put three
 * unrequested reads behind a screen that is opened far more often than it is
 * acted on.
 */
export async function readCapacityCounts(options: {
  orgId: string
  org?: Record<string, unknown> | null
  kinds: readonly CapacityAddonKind[]
}): Promise<CapacityCounts> {
  const { orgId, org, kinds } = options
  const [siteCount, datasetCount, managerSeats] = await Promise.all([
    kinds.includes('hosts') ? countOrgSites(orgId, org) : undefined,
    kinds.includes('datasets') ? countOrgDatasets(orgId) : undefined,
    kinds.includes('managers') ? countOrgManagerSeats(orgId) : undefined,
  ])
  const counts: CapacityCounts = {}
  if (kinds.includes('hosts')) counts.siteCount = siteCount
  if (kinds.includes('datasets')) counts.datasetCount = datasetCount
  if (kinds.includes('managers')) counts.managerSeats = managerSeats
  return counts
}

/**
 * What the plan INCLUDES of a kind, before any purchase — the number the
 * add-on stacks on top of, so the number usage has to clear before any of the
 * purchase is carrying it.
 *
 * Takes the resolved entitlements structurally rather than importing their
 * type, and callers must pass a PURCHASES-FREE resolution: fed the org's real
 * entitlements the bought quantity would raise the bar it is measured against
 * and no reduction would ever be refused.
 */
export function includedCapacity(
  kind: CapacityAddonKind,
  baseline: {
    hostLimit: number
    datasetsPerOrg: number
    managersPerOrg: number
  },
): number {
  switch (kind) {
    case 'hosts':
      return baseline.hostLimit
    case 'datasets':
      return baseline.datasetsPerOrg
    case 'managers':
      return baseline.managersPerOrg
  }
}

/** How much of a kind the org holds, from a counts bag. */
function heldCount(
  kind: CapacityAddonKind,
  counts: CapacityCounts,
): number | null | undefined {
  switch (kind) {
    case 'hosts':
      return counts.siteCount
    case 'datasets':
      return counts.datasetCount
    case 'managers':
      return counts.managerSeats
  }
}

/**
 * Nouns. `held` names the things counted, `addon` names what the money bought
 * — an org holds "team members" and buys "extra team seats", and a refusal
 * that used one word for both would be telling them to delete a seat.
 */
const NOUNS: Record<
  CapacityAddonKind,
  { one: string; many: string; addon: string }
> = {
  hosts: { one: 'site', many: 'sites', addon: 'extra sites' },
  datasets: { one: 'dataset', many: 'datasets', addon: 'extra datasets' },
  managers: {
    one: 'team member',
    many: 'team members',
    addon: 'extra team seats',
  },
}

function noun(kind: CapacityAddonKind, quantity: number): string {
  return quantity === 1 ? NOUNS[kind].one : NOUNS[kind].many
}

export interface CapacityReductionRefusal {
  error: string
  code: 'capacity_in_use'
  /** What the org holds. */
  count: number
  /** What the plan includes before any purchase. */
  included: number
  /** How much of the PURCHASE that usage is standing on. */
  inUse: number
  /** How many things to release before the requested quantity is reachable. */
  release: number
}

/**
 * Refuses a reduction that would drop capacity currently carrying usage, or
 * `null` when the reduction may proceed.
 *
 * `inUse` is `min(count - included, currentQuantity)` and the second half of
 * that `min` is the grandfathering clamp. Usage past what the plan includes is
 * attributed to the PURCHASE first and to history second, so the gate can
 * never demand the release of capacity the org never bought: an org holding no
 * add-on has `inUse === 0` however far over the cap it is, and this returns
 * `null` for it every time.
 *
 * Increases and no-ops can never be refused — `inUse <= currentQuantity`, so
 * `quantity >= currentQuantity` always passes.
 */
export function capacityReductionRefusal(options: {
  kind: CapacityAddonKind
  /** The quantity being requested. */
  quantity: number
  /** The quantity on the subscription right now. */
  currentQuantity: number
  /** What the plan includes of this kind, purchases excluded. */
  included: number
  counts: CapacityCounts
}): CapacityReductionRefusal | null {
  const { kind, quantity, currentQuantity, included, counts } = options
  const count = heldCount(kind, counts)
  // Not measured, or measured and unanswerable. A gate that treated an
  // unreadable count as 0 would wave the reduction through, and one that
  // treated it as infinite would refuse a customer for our outage. Neither is
  // a refusal this can honestly make.
  if (count == null) return null
  if (!Number.isFinite(included)) return null
  const inUse = Math.max(
    0,
    Math.min(count - included, Math.max(0, currentQuantity)),
  )
  if (quantity >= inUse) return null
  const release = count - included - quantity
  return {
    code: 'capacity_in_use',
    count,
    included,
    inUse,
    release,
    error:
      `You have ${count} ${noun(kind, count)}. Your plan includes ` +
      `${included}, so ${inUse} of the ${NOUNS[kind].addon} you bought ` +
      `${inUse === 1 ? 'is' : 'are'} in use. Remove ${release} ` +
      `${noun(kind, release)} first, then reduce to ${quantity}.`,
  }
}

export interface PlanDowngradeRefusal {
  error: string
  code: 'over_target_plan_limits'
  overLimit: OverLimitRow[]
}

/**
 * Refuses a plan change while the org exceeds what the target plan INCLUDES,
 * or `null` when it may proceed.
 *
 * A downgrade is the same act as dropping an add-on, one level up: capacity
 * bought, used, and then released while the use continues. It gets the same
 * answer, from the same comparison the customer was already shown before they
 * chose (`over-limit.ts`) — a refusal that disagreed with the warning
 * preceding it would be worse than either alone.
 *
 * Unreadable counts never refuse. `blockingOverLimitRows` drops them, because
 * a row with no count names no remedy, and "remove an unknown number of
 * things" is the support ticket this whole gate exists to avoid.
 */
export function planDowngradeRefusal(
  counts: OverLimitCounts,
  targetPlan: OrgPlan,
): PlanDowngradeRefusal | null {
  const blocking = blockingOverLimitRows(overLimitRows(counts, targetPlan))
  if (!blocking.length) return null
  return {
    code: 'over_target_plan_limits',
    overLimit: blocking,
    error: blocking
      .map((row) => overLimitReleaseInstruction(row, targetPlan))
      .join(' '),
  }
}
