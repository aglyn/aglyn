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
 * What a re-verification sweep decides about ONE version (AGL-1086).
 *
 * Kept apart from the route so the interesting judgement — which outcomes
 * are worth waking a human for — is testable without Firestore or a
 * megabyte of artifact. The route does the I/O; this decides what it means.
 */

/** Outcome for a single version, in the order a reader cares about them. */
export type ReverifyOutcome =
  | 'regressed'
  | 'fixed'
  | 'unchanged'
  | 'still-failing'
  | 'unverifiable'

export interface ReverifyBefore {
  /** The stored verdict's answer, or undefined when there was none. */
  ok?: boolean
  verifierVersion?: number
}

/**
 * A version's outcome.
 *
 * `regressed` is the one the sweep exists to produce: bytes that passed the
 * old checker and fail the new one. A version with NO prior verdict cannot
 * regress — nobody was ever told it was clean — so a first-time failure is
 * `still-failing`, which reads as "this was always broken, nobody looked",
 * not as "the new checker broke it".
 */
export function reverifyOutcome(
  before: ReverifyBefore | null | undefined,
  after: { ok: boolean } | null,
): ReverifyOutcome {
  if (!after) return 'unverifiable'
  const had = typeof before?.ok === 'boolean'
  if (!had) return after.ok ? 'unchanged' : 'still-failing'
  if (before?.ok && !after.ok) return 'regressed'
  if (!before?.ok && after.ok) return 'fixed'
  return after.ok ? 'unchanged' : 'still-failing'
}

/** A listing state that puts the code in front of customers. */
const LIVE_STATES = new Set(['listed', 'verified'])

/**
 * Whether a regression deserves a staff notification.
 *
 * Only when the bytes are actually reachable: a regression on a rejected or
 * in-review version is a note for whoever picks it up, while a regression on
 * a LIVE version with installs is somebody running code we told them was
 * checked. Deliberately never revokes — the verifier is a lint, and a lint
 * that can stop a plugin in every workspace is a kill switch with no human
 * in it.
 */
export function regressionNeedsStaff(entry: {
  outcome: ReverifyOutcome
  reviewStatus: string
  activeInstalls: number
}): boolean {
  return (
    entry.outcome === 'regressed' &&
    LIVE_STATES.has(entry.reviewStatus) &&
    entry.activeInstalls > 0
  )
}

export interface ReverifyEntry {
  listingId: string
  listingName: string
  version: string
  outcome: ReverifyOutcome
  reviewStatus: string
  activeInstalls: number
  /** Error-level messages from the NEW verdict, for the report. */
  problems: string[]
}

export interface ReverifySummary {
  scanned: number
  regressed: number
  fixed: number
  stillFailing: number
  unchanged: number
  unverifiable: number
  /** Every entry a reader must act on, worst first. */
  notable: ReverifyEntry[]
  needsStaff: ReverifyEntry[]
}

/** Rolls per-version outcomes into the report the CLI and the cron print. */
export function summariseReverify(entries: ReverifyEntry[]): ReverifySummary {
  const count = (outcome: ReverifyOutcome) =>
    entries.filter((entry) => entry.outcome === outcome).length
  const rank: Record<ReverifyOutcome, number> = {
    regressed: 0,
    'still-failing': 1,
    unverifiable: 2,
    fixed: 3,
    unchanged: 4,
  }
  return {
    scanned: entries.length,
    regressed: count('regressed'),
    fixed: count('fixed'),
    stillFailing: count('still-failing'),
    unchanged: count('unchanged'),
    unverifiable: count('unverifiable'),
    notable: entries
      .filter((entry) => entry.outcome !== 'unchanged')
      .sort((a, b) => rank[a.outcome] - rank[b.outcome]),
    needsStaff: entries.filter(regressionNeedsStaff),
  }
}
