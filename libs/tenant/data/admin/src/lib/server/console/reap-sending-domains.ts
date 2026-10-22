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
 * WHICH SENDING DOMAINS HAVE OUTLIVED THEIR OWNER — the decision, alone.
 *
 * Pure, so the one assertion that matters can be made without a provider, a
 * zone or a Firestore: that a shared pool member is NEVER selected.
 *
 * ## The shape of the leak this collects
 *
 * A dedicated sending domain is three resources — a plan-capped domain object
 * at the mail provider, three records in our own DNS zone, and our Firestore
 * state — and a site can stop existing in more ways than one. Until the
 * erasure path learned to release them, every workspace erasure spent a slot
 * forever and left a working DKIM key in the zone under a label a future site
 * could claim. Even the path that DID release them could fail: a provider
 * refusal leaves `teardownSendingDomain` reporting `provider-release` and
 * saying the work is left for the next pass. This is the next pass.
 *
 * ## The claim is the unit, not the record
 *
 * `sendingLabels/{label}` is a root document that survives both
 * `recursiveDelete(hosts/{hostId})` and `recursiveDelete(orgs/{orgId})`, which
 * makes it the only surviving handle on an erased site's domain — the org's
 * `sendingDomains` record, where the provider's id lives, does not survive its
 * workspace. So the sweep walks claims and asks whether each one's owner is
 * still there.
 *
 * ## ⛔ THE POOL
 *
 * `shared1.mail.aglyn.app` … `shared4` are verified, live, and belong to NO
 * host — every site without a domain of its own sends transactional mail on
 * one, assigned by hash rather than by a stored pointer. "Nothing points at
 * this" is a perfect description of a pool member, so an orphan reaper is
 * exactly the program that deletes them. Two independent things stop it:
 *
 *   1. A pool member has no `sendingLabels` document at all — pool labels are
 *      reserved against tenants and `ensureHostSendingDomain` is the only
 *      writer of that collection — so the scan cannot reach one.
 *   2. Every candidate is put to {@link sendingDomainTeardownRefusal} anyway,
 *      and a `shared-pool` answer is reported and never reaped.
 *
 * The second exists because the first is a property of where the sweep starts
 * looking, and a future change to the scan would take it away silently.
 */

import {
  platformSendingDomainFor,
  sendingDomainTeardownRefusal,
} from '@aglyn/shared-util-email'

/** One `sendingLabels/{label}` document, reduced to what the decision needs. */
export interface SendingDomainClaim {
  label: string
  hostId: string | null
  orgId: string | null
  domain: string | null
  claimedAtMs: number | null
  /** Stamped by an erasure whose vendor teardown could not be completed. */
  orphanedAtMs: number | null
  teardownDetail: string | null
  teardownAttempts: number
}

/** What is still standing of the site and workspace a claim names. */
export interface ClaimOwnership {
  hostExists: boolean
  /** The label that host currently pins. Null when it pins none. */
  hostLabel: string | null
  orgExists: boolean
}

/** Why a claim's domain is being torn down. */
export type ReapReason =
  /** An erasure released the site and could not finish the vendor work. */
  | 'erased'
  /** `hosts/{hostId}` is gone and left this behind. */
  | 'host-gone'
  /** The workspace is gone, so nothing can be sending as this. */
  | 'org-gone'
  /** The host lives but pins a different label — a restart that half-ran. */
  | 'label-reassigned'

export interface SendingDomainReapCandidate {
  label: string
  domain: string
  hostId: string | null
  orgId: string | null
  reason: ReapReason
  /** Attempts already made and failed, so a stuck debt is visible as a number. */
  attempts: number
}

export interface SendingDomainReapPlan {
  scanned: number
  toReap: SendingDomainReapCandidate[]
  /** Claims whose site is alive and pinning them. Left completely alone. */
  live: number
  /** Orphaned, but not yet old enough to be sure. */
  tooNew: number
  /**
   * ⛔ Pool members that reached the planner. ALWAYS EMPTY. A name here means
   * something has given a reserved label a claim document, and the operator
   * needs to know before anything else in this report.
   */
  poolProtected: string[]
  /** A customer's own verified domain. Never ours to remove. */
  foreign: number
  /** A claim naming no usable domain — reported, never acted on. */
  unusable: string[]
  /** Orphans this run will not reach, because of `maxReaps`. */
  deferredByCap: number
}

export interface SendingDomainReapOptions {
  /**
   * How long an orphan must have been claimed before it may be reaped.
   *
   * The guard against racing provisioning, which writes the claim BEFORE it
   * points the host at it: for that instant a live claim looks exactly like a
   * label-reassigned orphan. Hours rather than minutes because a claim that
   * failed midway is retried by a sweep on its own schedule and should be
   * allowed to settle first.
   *
   * It does not gate `erased`. That reason is not inferred from an absence —
   * an erasure wrote it down — so waiting would hold a provider slot for a day
   * to re-answer a question already answered.
   */
  minAgeHours: number
  /** Hard cap per run, so a bug cannot release every domain in one pass. */
  maxReaps: number
  /** Evaluation instant, injectable so the plan is testable. */
  now: number
}

/**
 * Decide what this run tears down.
 *
 * Never throws, and never selects on the strength of one signal: a claim is an
 * orphan because the thing that owned it is provably gone, not because a query
 * did not return it.
 */
export function planSendingDomainReap(
  claims: readonly (SendingDomainClaim & { owner: ClaimOwnership })[],
  options: SendingDomainReapOptions,
): SendingDomainReapPlan {
  const plan: SendingDomainReapPlan = {
    scanned: 0,
    toReap: [],
    live: 0,
    tooNew: 0,
    poolProtected: [],
    foreign: 0,
    unusable: [],
    deferredByCap: 0,
  }
  const minAgeMs = Math.max(0, options.minAgeHours) * 60 * 60 * 1000

  for (const claim of claims ?? []) {
    plan.scanned += 1
    const label = String(claim?.label ?? '').trim()

    /*
     * Re-derived from the label first, and only then taken from the stored
     * field. The label is what this deployment pinned; the stored domain is a
     * denormalised copy that can predate an apex change or a reserved-label
     * entry, and a teardown addressed at a stale copy writes to a name the
     * current rules would never have issued.
     */
    const domain = platformSendingDomainFor(label) || String(claim?.domain ?? '')
    if (!label || !domain) {
      plan.unusable.push(label || '(no label)')
      continue
    }

    /*==========================================
     * ⛔ THE POOL IS NEVER A CANDIDATE.
     *=========================================*/
    const refusal = sendingDomainTeardownRefusal(domain, label)
    if (refusal === 'shared-pool') {
      plan.poolProtected.push(domain)
      continue
    }
    if (refusal === 'not-our-zone') {
      plan.foreign += 1
      continue
    }

    const reason = orphanReason(claim)
    if (!reason) {
      plan.live += 1
      continue
    }

    /*
     * An orphan nobody can be released ON BEHALF OF.
     *
     * `releaseHostSendingDomain` addresses `hosts/{hostId}` and matches the
     * claim's own host id before deleting it, so a claim carrying none cannot
     * be settled by the ordinary path — and an empty document id is not a
     * request Firestore will even accept. Reported for a person rather than
     * half-acted-on.
     */
    if (!String(claim?.hostId ?? '').trim()) {
      plan.unusable.push(label)
      continue
    }

    /*
     * The age guard, on everything the sweep INFERRED. A claim with no
     * `claimedAtMs` is treated as old: the only writer of these documents has
     * always stamped it, so an absent one is a hand-written or pre-dating
     * document rather than a fresh one, and treating it as new would make it
     * permanently unreapable.
     */
    if (reason !== 'erased') {
      const claimedAtMs = Number(claim?.claimedAtMs) || 0
      if (claimedAtMs && options.now - claimedAtMs < minAgeMs) {
        plan.tooNew += 1
        continue
      }
    }

    if (plan.toReap.length >= Math.max(0, options.maxReaps)) {
      plan.deferredByCap += 1
      continue
    }

    plan.toReap.push({
      label,
      domain,
      hostId: claim.hostId ?? null,
      orgId: claim.orgId ?? null,
      reason,
      attempts: Number(claim?.teardownAttempts) || 0,
    })
  }

  return plan
}

/**
 * Why this claim's owner is gone, or null while it is still there.
 *
 * A claim naming no host is deliberately NOT an orphan unless an erasure said
 * so. `releaseHostSendingDomain` matches on the host id before deleting the
 * claim, so a claim without one cannot be released by the ordinary path
 * either — it is a broken record for a person to look at, and a reaper that
 * treated "I cannot tell who owns this" as "nobody owns this" would be
 * deleting on the strength of missing data.
 */
function orphanReason(
  claim: SendingDomainClaim & { owner: ClaimOwnership },
): ReapReason | null {
  if (Number(claim?.orphanedAtMs) > 0) return 'erased'
  const hostId = String(claim?.hostId ?? '').trim()
  if (!hostId) return null
  if (!claim.owner?.hostExists) return 'host-gone'
  if (String(claim.owner?.hostLabel ?? '') !== String(claim.label ?? '')) {
    return 'label-reassigned'
  }
  if (String(claim?.orgId ?? '').trim() && !claim.owner?.orgExists) {
    return 'org-gone'
  }
  return null
}
