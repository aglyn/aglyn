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
 * AGL-1210 — periodic re-verification, and the two assertions it lives or
 * dies by:
 *
 *   1. A TRANSIENT DNS FAILURE MUST NOT REVOKE. A resolver blip that read as
 *      "the record is gone" would, on an automated sweep, log out every
 *      enterprise on the platform at once — a worse outage than the risk being
 *      mitigated.
 *   2. A GENUINE CHANGE MUST BE DETECTED. A domain that changed hands and
 *      dropped our token has to become visible, or the whole job is theatre.
 *
 * Those are different mechanisms and get different tests. (1) is
 * `probeChallengeTxt` returning a third state plus `assessDomainDrift`'s
 * `hold` arm; (2) is the `missing` path counting up to `report`.
 *
 * ## The double models BOTH resolver legs, deliberately
 *
 * `probeChallengeTxt` asks the pinned public resolvers first and falls back to
 * the runtime's own. A double where a single flag answers for both cannot tell
 * "pinned resolvers unreachable, fallback answered" from "nobody answered" —
 * and those two are exactly the states the feature turns on. So the pinned leg
 * and the fallback leg are set independently here, and a fallback left unset
 * inherits the pinned leg's behaviour so the ordinary cases stay readable.
 */

/** The pinned-resolver leg (`new Resolver()` + `setServers`). */
let pinnedAnswer: string[][] = []
let pinnedError: (Error & { code?: string }) | null = null
/** The runtime fallback leg (`dns.promises.resolveTxt`). Undefined = inherit. */
let fallbackAnswer: string[][] | undefined
let fallbackError: (Error & { code?: string }) | null | undefined

const setServers = jest.fn()
const pinnedHosts: string[] = []
const fallbackHosts: string[] = []

jest.mock('dns', () => ({
  promises: {
    resolveTxt: jest.fn(async (host: string) => {
      fallbackHosts.push(host)
      const error = fallbackError === undefined ? pinnedError : fallbackError
      if (error) throw error
      return fallbackAnswer === undefined ? pinnedAnswer : fallbackAnswer
    }),
  },
  Resolver: jest.fn().mockImplementation(() => ({
    setServers,
    resolveTxt: (
      host: string,
      callback: (error: Error | null, records?: string[][]) => void,
    ) => {
      pinnedHosts.push(host)
      return pinnedError ? callback(pinnedError) : callback(null, pinnedAnswer)
    },
  })),
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ auth: () => ({}), firestore: () => ({}) }) },
}))

import {
  assessDomainDrift,
  challengeValue,
  probeChallengeTxt,
  SSO_CHALLENGE_PREFIX,
  SSO_DRIFT_FAILURES_BEFORE_REPORT,
  SSO_DRIFT_MIN_AGE_MS,
  type DomainDriftState,
  type DomainProbe,
} from './sso-provisioning'

const TOKEN = 'a-token-issued-to-this-org-and-domain'
const DAY = 24 * 60 * 60_000
/**
 * A REAL epoch to measure from, not 0.
 *
 * `firstFailureAtMs` is read straight off a Firestore document, and the
 * implementation treats a non-positive value as "no run recorded" — which is
 * correct, because 1970 is not a sweep time. Basing the arithmetic here on 0
 * would have been the test disagreeing with production about what a timestamp
 * is, rather than checking anything.
 */
const T0 = Date.UTC(2026, 7, 1)

/** A DNS error carrying a code, the way Node raises them. */
const dnsError = (code: string) => {
  const error = new Error(code) as Error & { code?: string }
  error.code = code
  return error
}

beforeEach(() => {
  pinnedAnswer = []
  pinnedError = null
  fallbackAnswer = undefined
  fallbackError = undefined
  setServers.mockClear()
  pinnedHosts.length = 0
  fallbackHosts.length = 0
})

describe('probeChallengeTxt — silence is not absence', () => {
  it('reads a matching record as PROVEN, from the challenge subdomain', async () => {
    pinnedAnswer = [[challengeValue(TOKEN)]]
    const probe = await probeChallengeTxt('acme.com', TOKEN)
    expect(probe.status).toBe('proven')
    // The positive control that makes every negative below a true negative:
    // the lookup really did go to the challenge host on the pinned servers.
    expect(pinnedHosts).toEqual([`${SSO_CHALLENGE_PREFIX}.acme.com`])
    expect(setServers).toHaveBeenCalledWith(['1.1.1.1', '8.8.8.8'])
  })

  it('reads an ANSWER without our token as MISSING — this is the real change', async () => {
    // The domain changed hands: the zone answers, and it is somebody else's.
    pinnedAnswer = [['v=spf1 include:_spf.newowner.example ~all']]
    const probe = await probeChallengeTxt('acme.com', TOKEN)
    expect(probe.status).toBe('missing')
    expect(probe.records).toEqual(['v=spf1 include:_spf.newowner.example ~all'])
  })

  it('reads NXDOMAIN as MISSING — a name with no record is an answer', async () => {
    pinnedError = dnsError('NXDOMAIN')
    expect((await probeChallengeTxt('acme.com', TOKEN)).status).toBe('missing')
    // Conclusive on the pinned leg: the fallback is never consulted, because
    // there is nothing left to ask.
    expect(fallbackHosts).toEqual([])
  })

  it.each(['ENOTFOUND', 'ENODATA'])(
    'reads %s as MISSING too',
    async (code) => {
      pinnedError = dnsError(code)
      expect((await probeChallengeTxt('acme.com', TOKEN)).status).toBe('missing')
    },
  )

  it('reads a DEAD RESOLVER as UNREACHABLE, never as missing', async () => {
    // The blip. ESERVFAIL/ETIMEOUT from the pinned servers AND from the
    // runtime fallback — nobody answered, so nothing was established.
    pinnedError = dnsError('ESERVFAIL')
    fallbackError = dnsError('ETIMEOUT')
    const probe = await probeChallengeTxt('acme.com', TOKEN)
    expect(probe.status).toBe('unreachable')
    // And it really did try both legs before saying so.
    expect(pinnedHosts).toHaveLength(1)
    expect(fallbackHosts).toHaveLength(1)
  })

  it('still PROVES via the fallback when only the pinned servers are down', async () => {
    // The case a single-flag double cannot express, and the reason the
    // fallback exists at all: our pinned resolvers are unreachable, the
    // runtime's own resolver answers, and the record is there.
    pinnedError = dnsError('ECONNREFUSED')
    fallbackError = null
    fallbackAnswer = [[challengeValue(TOKEN)]]
    expect((await probeChallengeTxt('acme.com', TOKEN)).status).toBe('proven')
  })

  it('is conclusive when the fallback returns a real NXDOMAIN', async () => {
    pinnedError = dnsError('ESERVFAIL')
    fallbackError = dnsError('ENOTFOUND')
    expect((await probeChallengeTxt('acme.com', TOKEN)).status).toBe('missing')
  })

  it('joins chunked TXT strings before comparing', async () => {
    // A >255-byte record arrives split. Comparing chunk-wise would never match.
    const value = challengeValue(TOKEN)
    pinnedAnswer = [[value.slice(0, 10), value.slice(10)]]
    expect((await probeChallengeTxt('acme.com', TOKEN)).status).toBe('proven')
  })

  it('does not accept a record that merely CONTAINS the token', async () => {
    pinnedAnswer = [[`${challengeValue(TOKEN)}-and-more`]]
    expect((await probeChallengeTxt('acme.com', TOKEN)).status).toBe('missing')
  })
})

describe('assessDomainDrift — a transient failure must not revoke', () => {
  const fresh: DomainDriftState = {
    consecutiveFailures: 0,
    firstFailureAtMs: null,
  }
  const probe = (status: DomainProbe['status']): DomainProbe => ({
    status,
    records: [],
  })

  it('HOLDS on unreachable: no count, no clock, no report', () => {
    const verdict = assessDomainDrift(probe('unreachable'), fresh, T0)
    expect(verdict.action).toBe('hold')
    expect(verdict.consecutiveFailures).toBe(0)
    expect(verdict.firstFailureAtMs).toBeNull()
  })

  it('NEVER reports on unreachable, however long the outage runs', () => {
    /*==========================================
     * THE ASSERTION THE WHOLE FEATURE EXISTS FOR.
     *
     * A resolver outage lasting a year, swept weekly, must still not produce
     * a single `report`. If this ever goes green while the implementation
     * counts unreachable probes, a bad afternoon at Cloudflare becomes a
     * platform-wide enterprise lockout.
     *=========================================*/
    let state = fresh
    let now = T0
    for (let week = 0; week < 52; week += 1) {
      now += 7 * DAY
      const verdict = assessDomainDrift(probe('unreachable'), state, now)
      expect(verdict.action).toBe('hold')
      state = {
        consecutiveFailures: verdict.consecutiveFailures,
        firstFailureAtMs: verdict.firstFailureAtMs,
      }
    }
    expect(state.consecutiveFailures).toBe(0)
  })

  it('does not LAUNDER AWAY evidence already gathered, either', () => {
    // An outage in the middle of a real failure run must not reset the count
    // — that would let a domain drift indefinitely behind intermittent DNS.
    const gathered: DomainDriftState = {
      consecutiveFailures: 2,
      firstFailureAtMs: T0,
    }
    const verdict = assessDomainDrift(probe('unreachable'), gathered, T0 + 3 * DAY)
    expect(verdict.action).toBe('hold')
    expect(verdict.consecutiveFailures).toBe(2)
    expect(verdict.firstFailureAtMs).toBe(T0)
  })

  it('CLEARS a failure run the moment the record answers again', () => {
    const verdict = assessDomainDrift(
      probe('proven'),
      { consecutiveFailures: 2, firstFailureAtMs: T0 },
      T0 + 3 * DAY,
    )
    expect(verdict.action).toBe('clear')
    expect(verdict.consecutiveFailures).toBe(0)
    expect(verdict.firstFailureAtMs).toBeNull()
  })
})

describe('assessDomainDrift — a real change must be detected', () => {
  const probeMissing: DomainProbe = { status: 'missing', records: [] }

  it('counts, and only reports once BOTH the run and the clock are satisfied', () => {
    let state: DomainDriftState = {
      consecutiveFailures: 0,
      firstFailureAtMs: null,
    }
    const actions: string[] = []
    let now = T0
    // Weekly sweep against a domain that genuinely dropped our record.
    for (let week = 0; week < 4; week += 1) {
      const verdict = assessDomainDrift(probeMissing, state, now)
      actions.push(verdict.action)
      state = {
        consecutiveFailures: verdict.consecutiveFailures,
        firstFailureAtMs: verdict.firstFailureAtMs,
      }
      now += 7 * DAY
    }
    // Three failures reached at week 2, but only 14 days old at week 2 —
    // which is the boundary, so it reports there.
    expect(actions).toEqual(['count', 'count', 'report', 'report'])
    expect(state.consecutiveFailures).toBe(4)
  })

  it('needs the COUNT, not just the age', () => {
    // One failure, a very long time ago, is not a drifted domain.
    const verdict = assessDomainDrift(
      probeMissing,
      { consecutiveFailures: 0, firstFailureAtMs: null },
      T0 + 365 * DAY,
    )
    expect(verdict.action).toBe('count')
  })

  it('needs the AGE, not just the count — a re-run flurry cannot fast-track it', () => {
    /*==========================================
     * Staff pressing the manual trigger three times in a minute must not
     * manufacture a report. "We checked three times" reads as diligence while
     * meaning nothing if all three were in the same minute.
     *=========================================*/
    let state: DomainDriftState = {
      consecutiveFailures: 0,
      firstFailureAtMs: null,
    }
    for (let run = 0; run < 6; run += 1) {
      const verdict = assessDomainDrift(probeMissing, state, T0 + run * 1_000)
      expect(verdict.action).toBe('count')
      state = {
        consecutiveFailures: verdict.consecutiveFailures,
        firstFailureAtMs: verdict.firstFailureAtMs,
      }
    }
    expect(state.consecutiveFailures).toBe(6)
  })

  it('reports exactly AT the age boundary and not one millisecond before', () => {
    const atThreshold = {
      consecutiveFailures: SSO_DRIFT_FAILURES_BEFORE_REPORT - 1,
      firstFailureAtMs: T0,
    }
    expect(
      assessDomainDrift(probeMissing, atThreshold, T0 + SSO_DRIFT_MIN_AGE_MS - 1)
        .action,
    ).toBe('count')
    expect(
      assessDomainDrift(probeMissing, atThreshold, T0 + SSO_DRIFT_MIN_AGE_MS)
        .action,
    ).toBe('report')
  })

  it('an intermittent record RESETS the run — drift means sustained, not flaky', () => {
    let state: DomainDriftState = {
      consecutiveFailures: 2,
      firstFailureAtMs: T0,
    }
    const cleared = assessDomainDrift({ status: 'proven', records: [] }, state, T0 + 30 * DAY)
    state = {
      consecutiveFailures: cleared.consecutiveFailures,
      firstFailureAtMs: cleared.firstFailureAtMs,
    }
    // Next failure starts a brand-new clock, so it cannot inherit the old
    // one's age and report immediately.
    const next = assessDomainDrift({ status: 'missing', records: [] }, state, T0 + 31 * DAY)
    expect(next.action).toBe('count')
    expect(next.consecutiveFailures).toBe(1)
    expect(next.firstFailureAtMs).toBe(T0 + 31 * DAY)
  })

  it('tolerates a claim that has never been swept (absent bookkeeping)', () => {
    // `strictNullChecks` is off and these fields are read straight off a
    // Firestore doc, so undefined/NaN arrive here in practice.
    const verdict = assessDomainDrift(probeMissing, {} as DomainDriftState, T0 + DAY)
    expect(verdict.action).toBe('count')
    expect(verdict.consecutiveFailures).toBe(1)
    expect(verdict.firstFailureAtMs).toBe(T0 + DAY)
  })
})
