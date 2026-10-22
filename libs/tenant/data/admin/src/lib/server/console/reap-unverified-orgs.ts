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
 * WHICH WORKSPACES BELONG TO NOBODY — the decision, alone (AGL-2585).
 *
 * Signup creates the Firebase account and then provisions a real workspace
 * immediately, seconds before the verification email goes out. That is
 * deliberate — AGL-1115/AGL-1117 chose landing in a workspace over landing in
 * a picker — but nothing in the platform ever looked at the other end of it,
 * so a workspace whose owner never confirmed an address stood forever, and
 * with it the name it took: the org's name IS its address,
 * `acme-inc.aglyn.com`, and a competitor's or a customer's was claimable by
 * anyone holding a throwaway inbox. The AGL-1534 limiter caps the RATE of
 * that (3/hour/uid, 10/hour/IP) and AGL-1536 says plainly that a distributed
 * farm under both caps is invisible to it.
 *
 * ## ⛔ THE ASYMMETRY THAT DECIDES EVERY RULE BELOW
 *
 * Deleting a real customer's workspace is far worse than leaving junk
 * standing. Junk costs documents; a wrong delete costs somebody their
 * business, and `eraseOrg` is not reversible. So this file is written to
 * REFUSE, and every refusal is named: {@link refuseUnverifiedOrgReap} returns
 * a reason on all but one path through it, and the plan reports how many
 * workspaces each reason held back. A run that reaps nothing is the healthy
 * shape, and a run that reaps something has had to pass thirteen separate
 * questions to get there.
 *
 * ## Why the facts are gathered by the caller
 *
 * Pure, like `reap-sending-domains` beside it, and for the same reason: the
 * assertions that matter — that a workspace with a second member, a site, a
 * subscription or a verified owner is NEVER selected — have to be makeable
 * without a Firestore, an auth pool or a clock. The route reads; this
 * decides; the spec walks every branch.
 */

/**
 * How long a workspace whose owner has not confirmed their address is left
 * alone.
 *
 * Seven days, and the number is a floor rather than a target: verification
 * mail lands in a spam folder, people sign up on a Friday, and the cost of
 * waiting is a document nobody reads. It is also comfortably inside
 * the address reservation's twenty-one days, so the ordinary way an
 * address is released is this sweep erasing the workspace that holds it —
 * the reservation expiry is what still ends a squat when this sweep has
 * stopped.
 */
export const UNVERIFIED_ORG_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The subcollections `createOrganization` writes at birth, and the only ones
 * a workspace nobody has used can have.
 *
 * `members` (the owner), `billing` (the deliberately-empty AGL-1152 Stripe
 * document) and `activity` (the one "Created the workspace" line AGL-118
 * stamps). ANY other subcollection is content somebody made, and content
 * somebody made is a person this sweep must not touch — which is why the
 * check is an allow-list. A deny-list would have to be updated by every
 * future feature that adds a subcollection, and the failure of forgetting
 * would be a deletion.
 */
export const ORG_BIRTH_SUBCOLLECTIONS: ReadonlySet<string> = new Set([
  'members',
  'billing',
  'activity',
])

/**
 * Activity rows a never-used workspace may carry.
 *
 * Exactly the creation line. An unverified account cannot mint a session
 * cookie (AGL-479) and every console route refuses it, so a second row means
 * something happened here that this sweep cannot account for.
 */
export const ORG_BIRTH_ACTIVITY_ROWS = 1

/** The auth record behind a workspace's owner, reduced to what decides this. */
export interface OwnerAuthFacts {
  uid: string
  emailVerified: boolean
  /** The GCIP tenant that answered, or null for the project pool. */
  tenantId: string | null
  /** Firebase provider ids on the record (`password`, `google.com`, …). */
  providerIds: readonly string[]
}

/** One `orgs/{orgId}`, reduced to what decides whether it is nobody's. */
export interface UnverifiedOrgFacts {
  orgId: string
  slug: string | null
  createdAtMs: number | null
  ownerUid: string | null
  /** Stamped once by `createOrganization` and mutated by nothing (AGL-2265). */
  createdByUid: string | null
  /** True when anybody — staff or the owner — has already asked to erase it. */
  erasureRequested: boolean
  /**
   * The owner's auth record, or null when no pool could produce one. Null is
   * a REFUSAL, never a licence: an owner nobody can look up is a question,
   * and this sweep does not answer questions by deleting.
   */
  owner: OwnerAuthFacts | null
  /** Member document ids, read with a small limit — two is already too many. */
  memberUids: readonly string[]
  /** Sites in this workspace, read with `limit(1)`. */
  hostCount: number
  /** Subcollection ids present on the org document. */
  subcollections: readonly string[]
  /** Activity rows, read with a small limit. */
  activityCount: number
  /** Any relationship with the billing processor at all. */
  hasBillingRelationship: boolean
}

/** Why one workspace was left standing. Every branch is named. */
export type UnverifiedOrgRefusal =
  /** The org document carries no owner — a shape nothing should produce. */
  | 'no-owner'
  /** No usable creation stamp, so the grace cannot be measured. */
  | 'no-created-at'
  /** Inside the grace. The overwhelmingly common answer. */
  | 'too-new'
  /** No auth pool produced the owner's record, or the lookup failed. */
  | 'owner-unknown'
  /** The owner confirmed their address. The workspace is a person's. */
  | 'owner-verified'
  /** An enterprise SSO pool owns this account; its IdP decides addresses. */
  | 'owner-in-sso-tenant'
  /** Not a plain password account — an OAuth or federated owner. */
  | 'owner-not-password-only'
  /** The workspace changed hands, so the creator is not the owner. */
  | 'ownership-transferred'
  /** Somebody has already decided about this workspace. Leave it to them. */
  | 'erasure-already-requested'
  /** More than the owner is on the roster. */
  | 'has-other-members'
  /** It has a site. */
  | 'has-sites'
  /** It has a subcollection nothing writes at birth. */
  | 'has-content'
  /** It has more activity than its own creation. */
  | 'has-activity'
  /** It has reached the billing processor. */
  | 'has-billing'
  /** Selected, but past this run's ceiling. Tomorrow's work, not a refusal. */
  | 'deferred-by-cap'

export interface UnverifiedOrgReapOptions {
  graceMs?: number
  now?: number
}

/**
 * MAY THIS WORKSPACE BE ERASED? Returns the reason it may not, or null.
 *
 * Thirteen questions, ordered cheapest-and-most-decisive first, and every one
 * of them independently sufficient to stop the deletion. Two properties are
 * deliberate and worth stating because a later edit could take either away
 * without looking like it did:
 *
 *   - **`null` is reachable by exactly one path.** There is no early success.
 *     Adding a question means adding a refusal, not adding a branch.
 *   - **Absent data refuses.** A missing creation stamp, an owner no pool
 *     knows, an owner uid the record does not match: each is a refusal rather
 *     than a default. The failure this ordering exists to make impossible is
 *     a lookup that quietly returned nothing being read as "nothing is here".
 *
 * The narrowing to PASSWORD-ONLY, PROJECT-POOL owners is the sharpest of
 * them, and it is not incidental. The abuse shape is a password signup with
 * an inbox nobody owns; an OAuth account arrives verified, so an unverified
 * one is an anomaly rather than junk, and an enterprise SSO account's address
 * is asserted by an IdP whose verification claim we do not control. Both are
 * left entirely alone.
 */
export function refuseUnverifiedOrgReap(
  facts: UnverifiedOrgFacts,
  options: UnverifiedOrgReapOptions = {},
): UnverifiedOrgRefusal | null {
  const { graceMs = UNVERIFIED_ORG_GRACE_MS, now = Date.now() } = options

  if (!facts.ownerUid) return 'no-owner'
  if (
    facts.createdAtMs === null ||
    !Number.isFinite(facts.createdAtMs)
  ) {
    return 'no-created-at'
  }
  if (now - facts.createdAtMs < graceMs) return 'too-new'

  const owner = facts.owner
  if (!owner) return 'owner-unknown'
  // The record a pool handed back must be the owner this org names. A uid is
  // only unique WITHIN a pool (AGL-2005), so a record for a different uid is
  // a lookup that landed somewhere else, not the answer to this question.
  if (owner.uid !== facts.ownerUid) return 'owner-unknown'
  if (owner.emailVerified) return 'owner-verified'
  if (owner.tenantId !== null) return 'owner-in-sso-tenant'
  if (owner.providerIds.length !== 1 || owner.providerIds[0] !== 'password') {
    return 'owner-not-password-only'
  }

  // Ownership has never moved (AGL-2265 stamps `createdByUid` once). A
  // workspace handed to somebody is a workspace two people know about.
  if (!facts.createdByUid || facts.createdByUid !== facts.ownerUid) {
    return 'ownership-transferred'
  }

  if (facts.erasureRequested) return 'erasure-already-requested'

  if (facts.memberUids.length !== 1 || facts.memberUids[0] !== facts.ownerUid) {
    return 'has-other-members'
  }
  if (facts.hostCount > 0) return 'has-sites'
  if (
    facts.subcollections.some(
      (collection) => !ORG_BIRTH_SUBCOLLECTIONS.has(collection),
    )
  ) {
    return 'has-content'
  }
  if (facts.activityCount > ORG_BIRTH_ACTIVITY_ROWS) return 'has-activity'
  if (facts.hasBillingRelationship) return 'has-billing'

  return null
}

/** A workspace this run would erase. */
export interface UnverifiedOrgCandidate {
  orgId: string
  slug: string | null
  ownerUid: string
  ageDays: number
}

/**
 * A workspace whose owner HAS verified since, and whose address is still
 * being held rather than granted.
 *
 * The other half of the reservation (AGL-2585): the expiry must be cleared
 * once somebody proves the address is theirs, or a real customer's workspace
 * URL would become claimable on day twenty-one.
 */
export interface SlugPromotion {
  orgId: string
  slug: string
}

export interface UnverifiedOrgPlan {
  scanned: number
  toReap: UnverifiedOrgCandidate[]
  toPromote: SlugPromotion[]
  /** How many workspaces each refusal held back, for the preview to read. */
  refusedCounts: Record<string, number>
  /** Selected but over the ceiling; they are tomorrow's work. */
  deferredByCap: number
}

export interface PlanUnverifiedOrgReapOptions extends UnverifiedOrgReapOptions {
  /** The most workspaces one run may erase. */
  maxReaps?: number
}

/**
 * Sort the scanned workspaces into the ones to erase, the addresses to
 * promote to grants, and a tally of every reason the rest were left alone.
 *
 * Promotion is decided independently of the reap: a workspace can be
 * refused for `owner-verified` AND still be holding a pending address, which
 * is the ordinary case and the one that must not be missed.
 */
export function planUnverifiedOrgReap(
  scanned: readonly (UnverifiedOrgFacts & {
    /** Epoch millis the address reservation lapses, or null when granted. */
    slugReservedUntilMs: number | null
  })[],
  options: PlanUnverifiedOrgReapOptions = {},
): UnverifiedOrgPlan {
  const { maxReaps = 50, now = Date.now() } = options
  const toReap: UnverifiedOrgCandidate[] = []
  const toPromote: SlugPromotion[] = []
  const refusedCounts: Record<string, number> = {}
  let deferredByCap = 0

  for (const facts of scanned) {
    // The address a verified owner is still only RENTING. Independent of
    // everything below — an org can be safe from the reaper and still be
    // holding an expiry that would eventually give its URL away.
    if (
      facts.slug &&
      facts.slugReservedUntilMs !== null &&
      facts.owner?.emailVerified === true &&
      facts.owner.uid === facts.ownerUid
    ) {
      toPromote.push({ orgId: facts.orgId, slug: facts.slug })
    }

    const refusal = refuseUnverifiedOrgReap(facts, options)
    if (refusal) {
      refusedCounts[refusal] = (refusedCounts[refusal] ?? 0) + 1
      continue
    }
    if (toReap.length >= maxReaps) {
      deferredByCap += 1
      refusedCounts['deferred-by-cap'] =
        (refusedCounts['deferred-by-cap'] ?? 0) + 1
      continue
    }
    toReap.push({
      orgId: facts.orgId,
      slug: facts.slug,
      ownerUid: facts.ownerUid as string,
      ageDays: Math.floor(
        (now - (facts.createdAtMs as number)) / (24 * 60 * 60 * 1000),
      ),
    })
  }

  return {
    scanned: scanned.length,
    toReap,
    toPromote,
    refusedCounts,
    deferredByCap,
  }
}
