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

import type { MarketplaceArtifactType } from '../model/marketplace'

/**
 * Per-version install counters (AGL-1036).
 *
 * The listing already carries `installCount` (cumulative) and `activeInstalls`
 * (live pins), but neither answers the question a publisher asks before
 * changing anything: **who is still on the old version?** A listing-level
 * number cannot, and a re-pin does not even move it — the pin already existed,
 * so nothing increments while the install quietly changes version underneath.
 *
 * This module is the one writer of the per-version pair, deliberately: the
 * listing-level counters drifted apart precisely because five install routes
 * each incremented their own, and the per-version pair has twice the surface —
 * every version change is TWO writes, a decrement of what was left and an
 * increment of what was taken.
 */

/**
 * Where a version's counters live, which differs by artifact type.
 *
 * Plugins keep their versions in `pluginVersions` (publish internals, review
 * state, bundle pointers); everything else keeps content snapshots in
 * `versions`. Both are server-only, which is why the counters are read back
 * out through the listing-versions route rather than by the client.
 */
export function versionCollectionFor(
  artifactType: MarketplaceArtifactType | string | null | undefined,
): 'pluginVersions' | 'versions' {
  return artifactType === 'plugin' ? 'pluginVersions' : 'versions'
}

/** One version's pair of counters, as the version doc stores them. */
export interface VersionInstallTally {
  version: string
  installCount: number
  activeInstalls: number
}

/** The listing-level pair, which counts the same two things (AGL-1418). */
export interface ListingInstallTally {
  installCount?: number | null
  activeInstalls?: number | null
}

export interface ReconciledInstallTallies {
  /** Per-version counters, reconciled against the listing totals. */
  versions: VersionInstallTally[]
  /** The totals the page should print, and that the versions sum to. */
  installCount: number
  activeInstalls: number
  /**
   * Installs the totals include but no version claims. Non-zero means the
   * per-version split is INCOMPLETE, and a caller must say so rather than
   * print a breakdown that does not add up.
   */
  untrackedInstallCount: number
  untrackedActiveInstalls: number
}

const asCount = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/**
 * Reconciles one counter across the two levels that both claim to hold it.
 *
 * The listing total is not authoritative and neither is the per-version sum —
 * each has a failure mode the other does not (see `reconcileInstallTallies`).
 * So the total is the larger of the two, and the shortfall is either
 * attributed or NAMED, never silently absorbed.
 */
function reconcileCounter(
  tracked: number[],
  stored: number,
): { values: number[]; total: number; untracked: number } {
  const sum = tracked.reduce((running, value) => running + value, 0)
  const total = Math.max(sum, stored)
  const values = [...tracked]
  let untracked = total - sum
  // The ONE case where attribution is provable rather than guessed: with a
  // single version there is nowhere else an install could be. Every other
  // shape keeps the remainder as a remainder — a split that reads as fact and
  // is actually a guess is the defect this function exists to remove.
  if (untracked > 0 && values.length === 1) {
    values[0] += untracked
    untracked = 0
  }
  return { values, total, untracked }
}

/**
 * Makes the listing-level and per-version counters agree (AGL-1418).
 *
 * The marketplace keeps the same two quantities twice: once on the listing and
 * once per version. They are written by different code under different trigger
 * conditions, each swallowing its own failures, and nothing ever checked that
 * they agree — so the listing page printed `7 installs · 2 active` beside
 * `3 installs · 1 on this version` for a listing with ONE version and two live
 * pins. Three numbers, one quantity, and a publisher with no way to tell which
 * to believe.
 *
 * Neither level is trustworthy on its own:
 *
 * * The per-version pair only exists from AGL-1036 onwards and was never
 *   backfilled, so it under-counts every listing older than that.
 * * The listing-level pair is not incremented at all by the copied-artifact
 *   install routes, so it under-counts every component, theme, layout, email
 *   template and dataset schema.
 *
 * Both fail in the same direction — downwards — which is why the total is the
 * larger of the two rather than an average or a preference.
 *
 * `activeInstalls` is clamped to `installCount` at both levels. That is not a
 * guess: every writer increments the pair together, so "more live than ever
 * landed" is unrepresentable in a healthy database and printing it would
 * advertise the corruption rather than the count.
 *
 * Pure, and deliberately: it decides what to SAY, and the caller decides
 * whether to repair anything.
 */
export function reconcileInstallTallies(
  versions: VersionInstallTally[],
  listing: ListingInstallTally,
): ReconciledInstallTallies {
  const installs = reconcileCounter(
    versions.map((entry) => asCount(entry.installCount)),
    asCount(listing?.installCount),
  )
  const active = reconcileCounter(
    versions.map((entry) => asCount(entry.activeInstalls)),
    asCount(listing?.activeInstalls),
  )
  const activeValues = active.values.map((value, index) =>
    Math.min(value, installs.values[index] ?? 0),
  )
  const activeTotal = Math.min(active.total, installs.total)
  const activeSum = activeValues.reduce((running, value) => running + value, 0)
  return {
    versions: versions.map((entry, index) => ({
      ...entry,
      installCount: installs.values[index] ?? 0,
      activeInstalls: activeValues[index] ?? 0,
    })),
    installCount: installs.total,
    activeInstalls: activeTotal,
    untrackedInstallCount: installs.untracked,
    untrackedActiveInstalls: Math.max(0, activeTotal - activeSum),
  }
}

export interface VersionMoveInput {
  firestore: FirebaseFirestore.Firestore
  listingRef: FirebaseFirestore.DocumentReference
  artifactType: MarketplaceArtifactType | string | null | undefined
  /** The version this install was on, if any. Null for a first install. */
  from?: string | number | null
  /** The version it is on now. Null for an uninstall. */
  to?: string | number | null
}

const asId = (value: string | number | null | undefined): string | null =>
  value == null || value === '' ? null : String(value)

/**
 * Moves one install from one version's tally to another's.
 *
 * Rules, all of which exist because a wrong count is worse than no count:
 *
 * * `activeInstalls` is clamped at zero, so a repeat uninstall — which the
 *   plugin route already tolerates at listing level — cannot go negative.
 * * `installCount` only rises, and only on the version being taken: it records
 *   that an install once landed there, which stays true after they leave.
 * * A version whose document is gone is skipped rather than created. Writing
 *   `increment()` blind would resurrect a deleted version as a counters-only
 *   stub, and in `pluginVersions` that stub would surface through
 *   `newestApprovedVersion` as a version with no publish date and no review.
 * * `from === to` is a no-op. Re-installing the same version is not a new
 *   install of it, and counting it would inflate every re-install.
 *
 * Never on the critical path: a counter that cannot be written must not fail
 * an install the user asked for.
 */
export async function recordVersionMove(input: VersionMoveInput): Promise<void> {
  const from = asId(input.from)
  const to = asId(input.to)
  if (from === to) return
  const collection = input.listingRef.collection(
    versionCollectionFor(input.artifactType),
  )
  const bump = async (versionId: string, activeDelta: 1 | -1) => {
    const ref = collection.doc(versionId)
    await input.firestore
      .runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        if (!snapshot.exists) return
        const active = Number(snapshot.get('activeInstalls') ?? 0)
        tx.update(ref, {
          activeInstalls: Math.max(0, active + activeDelta),
          ...(activeDelta > 0
            ? { installCount: Number(snapshot.get('installCount') ?? 0) + 1 }
            : {}),
        })
      })
      .catch(() => undefined)
  }
  if (from) await bump(from, -1)
  if (to) await bump(to, 1)
}
