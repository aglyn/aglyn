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
 * Orphaned plugin-artifact reaping (AGL-942).
 *
 * Nothing else in the platform ever deletes from the isolated artifacts
 * bucket, so stranded bundles accumulate forever. The main source is a
 * republish of the SAME version string with different bytes: the object
 * path is content-addressed (`artifacts/{listingId}/{version}/{sha}.bundle`,
 * `pluginArtifactPath`), so the new build writes a NEW object and the
 * version doc's `sha256` repoints — the previous object is instantly
 * unreachable, because every loader derives the URL from the version doc's
 * hash and no consumer can ask for the old one.
 *
 * A GCS lifecycle rule cannot do this job: it matches on age, class and
 * prefix, and has no view of Firestore. Age-based deletion here would
 * eventually remove bundles that live installs pin by exact sha — the
 * loader would 404 and skip the plugin, unrecoverably (the bucket has no
 * object versioning, and the publisher's build is not reproducible from
 * our side). Orphan-ness is a Firestore fact, so this join is the only
 * safe reaper.
 *
 * The rule is deliberately narrow: **an object survives if ANY
 * `pluginVersions` doc claims its exact `{listingId}/{version}/{sha256}`.**
 * Not "is it the latest version" and not "does an install pin it" —
 * `install-plugin` accepts a `requestedVersion`, so any version doc is
 * installable, and a version doc therefore keeps its bytes alive even with
 * zero current installs.
 *
 * Two categories are reported but NEVER deleted, because both are cases
 * where a human should decide:
 *
 * - **Orphaned listing** — the object is claimed by a version doc whose
 *   parent `communityListings` doc is gone. Firestore does not cascade to
 *   subcollections, and `resolveCommunityPluginVersion` reads the version
 *   doc by path, so existing installs of a hard-deleted listing still load.
 *   Deleting the bytes would break them.
 * - **Unrecognized path** — anything under `artifacts/` that does not match
 *   the canonical shape. The serving route (`/api/plugin-artifacts/...`)
 *   validates the same shape, so these are already unreachable, but they
 *   are also not something this reaper put there.
 */

/** One bucket object, reduced to what the reap decision needs. */
export interface ArtifactObject {
  /** Full object name, e.g. `artifacts/{listingId}/{version}/{sha}.bundle`. */
  name: string
  /** Object creation time; drives the min-age guard. */
  createdAt: Date
  /** Object size in bytes, for the freed-bytes report. */
  size: number
}

export interface ReapPlanOptions {
  /**
   * Objects younger than this are never touched. A publish writes the
   * object BEFORE the version doc that claims it, so a run racing an
   * in-flight publish would otherwise see a legitimate new bundle as an
   * orphan. Days, not minutes, because a failed publish retried later
   * should also settle first.
   */
  minAgeDays: number
  /** Hard cap on deletions per run, so a bug cannot empty the bucket. */
  maxDeletes: number
  /** Evaluation instant (injectable so the plan is testable). */
  now: Date
}

export interface ReapPlan {
  /** Objects examined (everything under the prefix). */
  scanned: number
  /** Claimed by a live version doc — kept. */
  kept: number
  /** Inside the min-age window — kept, will be reconsidered next run. */
  tooNew: number
  /** Object names to delete: no version doc claims them. */
  toDelete: string[]
  /** Bytes the deletions would free. */
  bytesToFree: number
  /** Claimed, but the parent listing doc is gone — reported, never deleted. */
  orphanedListings: string[]
  /** Not the canonical artifact path — reported, never deleted. */
  unrecognized: string[]
  /** Orphans left for the next run because `maxDeletes` was hit. */
  deferredByCap: number
}

const ARTIFACT_PATH =
  /^artifacts\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9._-]{1,32})\/([a-f0-9]{64})\.bundle$/

/** The claim key a `pluginVersions` doc contributes. */
export function artifactClaimKey(
  listingId: string,
  version: string,
  sha256: string,
): string {
  return `${listingId}/${version}/${sha256}`
}

/**
 * Pure reap decision: which objects are unclaimed, given the set of claim
 * keys every `pluginVersions` doc contributes and the set of listing ids
 * whose listing doc still exists.
 *
 * Split out from the IO so the rules that decide a permanent deletion are
 * covered by ordinary unit tests rather than only by running it against a
 * real bucket.
 */
export function planArtifactReap(
  objects: readonly ArtifactObject[],
  claimed: ReadonlySet<string>,
  liveListingIds: ReadonlySet<string>,
  options: ReapPlanOptions,
): ReapPlan {
  const minAgeMs = options.minAgeDays * 24 * 60 * 60 * 1000
  const plan: ReapPlan = {
    scanned: objects.length,
    kept: 0,
    tooNew: 0,
    toDelete: [],
    bytesToFree: 0,
    orphanedListings: [],
    unrecognized: [],
    deferredByCap: 0,
  }

  for (const object of objects) {
    const match = ARTIFACT_PATH.exec(object.name)
    if (!match) {
      plan.unrecognized.push(object.name)
      continue
    }
    const [, listingId, version, sha256] = match

    // Claimed objects are live regardless of age or install count.
    if (claimed.has(artifactClaimKey(listingId, version, sha256))) {
      if (liveListingIds.has(listingId)) plan.kept++
      else plan.orphanedListings.push(object.name)
      continue
    }

    // Unclaimed, but possibly mid-publish.
    if (options.now.getTime() - object.createdAt.getTime() < minAgeMs) {
      plan.tooNew++
      continue
    }

    if (plan.toDelete.length >= options.maxDeletes) {
      plan.deferredByCap++
      continue
    }
    plan.toDelete.push(object.name)
    plan.bytesToFree += object.size
  }

  return plan
}
