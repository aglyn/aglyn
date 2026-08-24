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
 * Has an SSO domain stopped proving it belongs to the org routing it, and is
 * that conclusion safe to act on? (AGL-1210)
 *
 * PURE, and in its own file with NO imports at all — not `dns`, not
 * `firebase-admin`. `sso-provisioning.ts` re-exports everything here, so the
 * public surface is unchanged, but the decision can be required by a test on
 * either side of the app/lib boundary without dragging in the admin SDK. The
 * console route's spec does exactly that: it fakes the I/O and runs the REAL
 * decision, which is the only arrangement where "the route obeys the rule"
 * means anything.
 *
 * The reasoning for the policy itself lives in `sso-provisioning.ts`, next to
 * the probe it interprets. In one line: a DNS lookup cannot distinguish "the
 * record is gone" from "nobody answered", so the third state below is what
 * stops a resolver blip from being read as every customer deleting their TXT
 * record at the same instant.
 */

/**
 * What a re-verification lookup actually established.
 *
 * The third state is the whole point. A resolver that did not answer has told
 * us nothing, and "nothing" must not be counted as "gone".
 */
export type DomainProbeStatus =
  /** The record is there and matches this org's token. */
  | 'proven'
  /** We got an ANSWER, and the token is not in it. Conclusive. */
  | 'missing'
  /** Nobody answered. Not evidence of anything, in either direction. */
  | 'unreachable'

export interface DomainProbe {
  status: DomainProbeStatus
  /** What the lookup saw — the difference between "gone" and "changed". */
  records: string[]
}

/**
 * Consecutive conclusive failures before a domain is REPORTED as drifted.
 *
 * Three, against a weekly sweep, is a three-week signal. Exported so the
 * threshold is one named number rather than a literal buried in a loop, and so
 * a test can state the boundary it is checking.
 */
export const SSO_DRIFT_FAILURES_BEFORE_REPORT = 3

/**
 * And the wall-clock floor the same run must clear, independent of the count.
 *
 * Belt AND braces, because the two guard different mistakes. The count alone
 * can be run up in three minutes by a staff member re-running the sweep by
 * hand, or by a scheduler firing more often than anyone intended — and "we
 * checked three times" reads as diligence while meaning nothing. The age alone
 * would report a domain that failed once a month ago and has answered every
 * time since. A report needs both.
 */
export const SSO_DRIFT_MIN_AGE_MS = 14 * 24 * 60 * 60_000

/** The drift bookkeeping carried on a claim between sweeps. */
export interface DomainDriftState {
  /** Conclusive failures in a row. Reset by any single `proven`. */
  consecutiveFailures: number
  /** When the current run of failures began. Null when there is no run. */
  firstFailureAtMs: number | null
}

export type DomainDriftAction =
  /** Proven. Any failure run ends here. */
  | 'clear'
  /** Unreachable. Change nothing at all — this is not evidence. */
  | 'hold'
  /** Conclusive failure, but not yet enough of them for long enough. */
  | 'count'
  /** Enough, for long enough. Tell people. Still revoke nothing. */
  | 'report'

export interface DomainDriftVerdict {
  action: DomainDriftAction
  /** The run length AFTER this probe. Unchanged on `hold`. */
  consecutiveFailures: number
  /** Start of the run after this probe, for the next sweep to carry. */
  firstFailureAtMs: number | null
}

/**
 * Should this probe change anything, and has the domain drifted?
 *
 * `hold` is the load-bearing arm. An `unreachable` probe neither increments
 * the count nor resets it — an outage must not manufacture evidence, and must
 * not launder away evidence already gathered either. The run simply pauses,
 * and the next conclusive answer continues it.
 *
 * Note what this function CANNOT return: there is no `revoke`. Detection is
 * the whole of its vocabulary, and revocation stays a human act.
 */
export function assessDomainDrift(
  probe: DomainProbe,
  prior: DomainDriftState,
  nowMs: number,
  failuresBeforeReport: number = SSO_DRIFT_FAILURES_BEFORE_REPORT,
  minAgeMs: number = SSO_DRIFT_MIN_AGE_MS,
): DomainDriftVerdict {
  // Read defensively: these come straight off a Firestore document, and with
  // `strictNullChecks` off the compiler will not mention that they might be
  // undefined, NaN, or a value written before this feature existed.
  const priorCount = Number(prior?.consecutiveFailures) || 0
  const priorFirst =
    Number.isFinite(prior?.firstFailureAtMs) && prior.firstFailureAtMs > 0
      ? prior.firstFailureAtMs
      : null

  if (probe.status === 'unreachable') {
    return {
      action: 'hold',
      consecutiveFailures: priorCount,
      firstFailureAtMs: priorFirst,
    }
  }
  if (probe.status === 'proven') {
    return { action: 'clear', consecutiveFailures: 0, firstFailureAtMs: null }
  }

  const consecutiveFailures = priorCount + 1
  const firstFailureAtMs = priorFirst ?? nowMs
  const oldEnough = nowMs - firstFailureAtMs >= minAgeMs
  return {
    action:
      consecutiveFailures >= failuresBeforeReport && oldEnough
        ? 'report'
        : 'count',
    consecutiveFailures,
    firstFailureAtMs,
  }
}
