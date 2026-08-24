/**
 * @jest-environment node
 */

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
 * AGL-1210 — drives the REAL sweep handler with only DNS and Firestore faked.
 *
 * `assessDomainDrift` is unit-tested next to its implementation, but a correct
 * decision nothing calls is the failure mode this repo keeps rediscovering. So
 * the decision here is the REAL one (`jest.requireActual`), and what is being
 * checked is what the ROUTE does with it:
 *
 *   1. A transient DNS failure writes NOTHING and tells NOBODY. Not a revoke,
 *      not a `verified: false`, not even a "last probed" stamp — a resolver
 *      blip must leave the platform byte-identical to how it found it.
 *   2. A sustained genuine change is detected, persisted, and announced to the
 *      org's own admins and to staff — with the routing still untouched.
 *
 * The negative in (1) is the one that matters. It is asserted as "the claim
 * document was never written to at all", because an assertion that merely
 * checked `verified` was still true would pass for an implementation that
 * revoked the domain by some other field.
 */

/**
 * A MODULE, not a script. Without a top-level `export` this file has no
 * module scope of its own, and its `mock*` consts land in the same global
 * namespace as every other console spec — where `mockAuditAdd` and
 * `mockClaimSet` already exist. `tsc` catches that as a redeclaration; jest
 * does not, because it runs each suite in its own context. So the collision
 * is invisible until the typecheck runs, which is exactly when nobody is
 * looking for it.
 */
export {}

const mockNotifyOrgAdmins = jest.fn(
  async (_orgId: string, _payload: unknown) => undefined,
)
const mockNotifyStaff = jest.fn(async (_payload: unknown) => undefined)
const mockEmailOrgAdmins = jest.fn(async (_input: unknown) => ({
  sent: true,
  id: 'msg-1',
}))
const mockEmailStaffAlert = jest.fn(async (_input: unknown) => ({
  sent: true,
  id: 'msg-2',
}))
const mockAuditAdd = jest.fn(async (_entry: unknown) => undefined)
/** Every write aimed at a claim document, in order. */
const mockClaimSet = jest.fn(
  async (_data: unknown, _options?: unknown) => undefined,
)
const mockProbe = jest.fn()

const DAY = 24 * 60 * 60_000

interface ClaimSeed {
  exists?: boolean
  verified?: boolean
  token?: string
  attestedBy?: string
  driftFailures?: number
  driftFirstFailureAtMs?: number
}

let mockRoutingSeed: Array<{ domain: string; orgId: string; active: boolean }> = []
let mockClaimSeed: ClaimSeed = {}

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL decision — pure, and the thing the route's behaviour has to
  // follow. Mocking it would make every assertion below a test of the mock.
  const real = jest.requireActual(
    '../../../../../../libs/tenant/data/admin/src/lib/server/sso-drift-logic',
  )
  return {
    __esModule: true,
    assessDomainDrift: real.assessDomainDrift,
    SSO_DRIFT_FAILURES_BEFORE_REPORT: real.SSO_DRIFT_FAILURES_BEFORE_REPORT,
    SSO_DRIFT_MIN_AGE_MS: real.SSO_DRIFT_MIN_AGE_MS,
    SSO_CHALLENGE_PREFIX: '_aglyn-challenge',
    challengeValue: (token: string) => `aglyn-domain-verification=${token}`,
    isStaffAttestedClaim: (value: unknown) =>
      typeof value === 'string' && value.trim().length > 0,
    probeChallengeTxt: (domain: string, token: string) =>
      mockProbe(domain, token),
    notifyOrgAdmins: (orgId: string, payload: unknown) =>
      mockNotifyOrgAdmins(orgId, payload),
    notifyStaff: (payload: unknown) => mockNotifyStaff(payload),
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => {
            if (name === 'adminAudit') return { add: mockAuditAdd }
            if (name === 'ssoDomains') {
              return {
                get: async () => ({
                  docs: mockRoutingSeed.map((row) => ({
                    id: row.domain,
                    get: (field: string) =>
                      field === 'active' ? row.active : row.orgId,
                  })),
                }),
              }
            }
            // orgs/{id}/ssoDomains/{domain}
            return {
              doc: () => ({
                collection: () => ({
                  doc: () => ({
                    get: async () => ({
                      exists: mockClaimSeed.exists !== false,
                      get: (field: string) =>
                        ({
                          token: mockClaimSeed.token ?? 'tok',
                          verified: mockClaimSeed.verified ?? true,
                          attestedBy: mockClaimSeed.attestedBy,
                          driftFailures: mockClaimSeed.driftFailures,
                          driftFirstFailureAtMs: mockClaimSeed.driftFirstFailureAtMs,
                        })[field],
                    }),
                    set: mockClaimSet,
                  }),
                }),
              }),
            }
          },
        }),
      }),
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    body: undefined,
  }),
}))

jest.mock('../../../../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: jest.fn(async () => undefined),
}))

jest.mock('../../_lib/usage-alert-email', () => ({
  __esModule: true,
  consoleOrigin: () => 'https://app.aglyn.com',
  emailFailureReason: (result: { reason?: string }) => result.reason ?? null,
  emailOrgAdmins: (input: unknown) => mockEmailOrgAdmins(input),
  emailStaffAlert: (input: unknown) => mockEmailStaffAlert(input),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '<server-timestamp>',
    delete: () => '<delete>',
  },
}))

const SECRET = 'cron-secret-for-tests'

const call = async (method: 'GET' | 'POST') => {
  const { GET, POST } = await import('./route')
  const request = new Request(
    'https://app.aglyn.com/api/admin/reverify-sso-domains',
    { method, headers: { 'x-cron-secret': SECRET } },
  )
  const response = await (method === 'GET' ? GET(request) : POST(request))
  return { response, body: await response.json() }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  mockRoutingSeed = [{ domain: 'acme.com', orgId: 'org-1', active: true }]
  mockClaimSeed = {}
})

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new Request('https://app.aglyn.com/api/admin/reverify-sso-domains'),
    )
    expect(response.status).toBe(401)
  })
})

describe('a transient DNS failure must NOT revoke', () => {
  beforeEach(() => {
    mockProbe.mockResolvedValue({ status: 'unreachable', records: [] })
  })

  it('writes NOTHING to the claim — not even a probe timestamp', async () => {
    const { body } = await call('POST')
    /*==========================================
     * THE ASSERTION THE FEATURE EXISTS FOR.
     *
     * Not "verified is still true" — that would pass for an implementation
     * that un-routed the domain by some other field. The claim document must
     * not be written AT ALL, because there is nothing to record: the sweep
     * established nothing.
     *=========================================*/
    expect(mockClaimSet).not.toHaveBeenCalled()
    expect(body.unreachable).toBe(1)
    expect(body.drifted).toEqual([])
    expect(body.revokes).toBe(false)
  })

  it('tells nobody — no org email, no staff page, no audit row', async () => {
    await call('POST')
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled()
    expect(mockEmailOrgAdmins).not.toHaveBeenCalled()
    expect(mockNotifyStaff).not.toHaveBeenCalled()
    expect(mockEmailStaffAlert).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('reports the sweep as INCONCLUSIVE rather than as a clean bill of health', async () => {
    // A swallowed answer rendered as a measured zero is worse than an error,
    // because nothing looks wrong. `0 drifted` from a sweep that learned
    // nothing must not read the same as `0 drifted` from a healthy one.
    const { body } = await call('POST')
    expect(body.inconclusive).toBe(true)
    expect(body.proven).toBe(0)
  })

  it('does not become conclusive just because the outage is long-running', async () => {
    // Two weeks of failures already banked, and DNS still unreachable. The
    // banked evidence is neither advanced nor discarded, and nothing fires.
    mockClaimSeed = { driftFailures: 2, driftFirstFailureAtMs: Date.now() - 20 * DAY }
    const { body } = await call('POST')
    expect(mockClaimSet).not.toHaveBeenCalled()
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled()
    expect(body.drifted).toEqual([])
  })
})

describe('a genuinely changed record must be detected', () => {
  beforeEach(() => {
    // The zone answers, and it is somebody else's record now.
    mockProbe.mockResolvedValue({
      status: 'missing',
      records: ['v=spf1 include:_spf.newowner.example ~all'],
    })
  })

  it('only COUNTS on the first conclusive failure — it does not cry wolf', async () => {
    const { body } = await call('POST')
    expect(body.counting).toBe(1)
    expect(body.drifted).toEqual([])
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled()
    // It does persist the count, or the run could never reach three.
    expect(mockClaimSet).toHaveBeenCalledTimes(1)
    expect(mockClaimSet.mock.calls[0][0]).toMatchObject({
      driftFailures: 1,
      driftStatus: 'ok',
    })
  })

  it('REPORTS once the run is long enough, and says so to the org and to staff', async () => {
    mockClaimSeed = { driftFailures: 2, driftFirstFailureAtMs: Date.now() - 20 * DAY }
    const { body } = await call('POST')

    expect(body.drifted).toHaveLength(1)
    expect(body.drifted[0]).toMatchObject({
      orgId: 'org-1',
      domain: 'acme.com',
      consecutiveFailures: 3,
    })
    expect(body.inconclusive).toBe(false)

    // The org's own admins, before their sign-in breaks.
    expect(mockNotifyOrgAdmins).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ type: 'system.ssoDomainUnverified' }),
    )
    const email = mockEmailOrgAdmins.mock.calls[0][0] as {
      orgId: string
      text: string
    }
    expect(email.orgId).toBe('org-1')
    // The mail must lead with "nothing is broken", or a customer pages their
    // own on-call over a DNS record they could fix on Monday.
    expect(email.text).toMatch(/still working/i)
    expect(email.text).toContain('acme.com')
    // Staff too, and the audit row.
    expect(mockNotifyStaff).toHaveBeenCalled()
    expect(mockEmailStaffAlert).toHaveBeenCalled()
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
    expect(mockAuditAdd.mock.calls[0][0]).toMatchObject({
      action: 'sso.domain.driftDetected',
      after: expect.objectContaining({ revoked: false }),
    })
    // And the response still says, in words, that nothing was revoked.
    expect(body.revokes).toBe(false)
  })

  it('NEVER writes `verified` — the field that would un-route the domain', async () => {
    /*==========================================
     * `publishSsoDomains` re-reads `verified` and skips a claim that is
     * false. A sweep that wrote it would silently un-route the domain on the
     * platform's next publish — an automated lockout by the back door, which
     * is exactly what this design refuses to build.
     *=========================================*/
    mockClaimSeed = { driftFailures: 2, driftFirstFailureAtMs: Date.now() - 20 * DAY }
    await call('POST')
    expect(mockClaimSet).toHaveBeenCalled()
    for (const [payload] of mockClaimSet.mock.calls) {
      expect(Object.keys(payload as object)).not.toContain('verified')
      expect(Object.keys(payload as object)).not.toContain('active')
    }
  })

  it('clears the run when the record comes back', async () => {
    mockProbe.mockResolvedValue({ status: 'proven', records: [] })
    mockClaimSeed = { driftFailures: 2, driftFirstFailureAtMs: Date.now() - 20 * DAY }
    const { body } = await call('POST')
    expect(body.proven).toBe(1)
    expect(body.drifted).toEqual([])
    expect(mockClaimSet.mock.calls[0][0]).toMatchObject({
      driftFailures: 0,
      driftStatus: 'ok',
    })
  })

  it('a GET is a DRY RUN — it reports the drift and persists nothing', async () => {
    mockClaimSeed = { driftFailures: 2, driftFirstFailureAtMs: Date.now() - 20 * DAY }
    const { body } = await call('GET')
    expect(body.dryRun).toBe(true)
    expect(body.drifted).toHaveLength(1)
    expect(mockClaimSet).not.toHaveBeenCalled()
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled()
  })
})

describe('what it declines to probe', () => {
  it('skips a staff-attested domain rather than failing it every week', async () => {
    // AGL-1887: attested domains never had a challenge record, so probing one
    // would manufacture a weekly failure forever — which is how a board gets
    // ignored.
    mockClaimSeed = { verified: false, attestedBy: 'staff-uid-7' }
    const { body } = await call('POST')
    expect(mockProbe).not.toHaveBeenCalled()
    expect(body.skipped).toBe(1)
    expect(body.inconclusive).toBe(false)
  })

  it('skips a deactivated routing doc — it governs no sign-in', async () => {
    mockRoutingSeed = [{ domain: 'old.com', orgId: 'org-1', active: false }]
    const { body } = await call('POST')
    expect(mockProbe).not.toHaveBeenCalled()
    expect(body.checked).toBe(0)
    // Nothing was probed, so this is idle rather than blind. It must read
    // green, the way an idle cron does.
    expect(body.inconclusive).toBe(false)
  })

  it('reports a routing doc with no claim behind it, and acts on nothing', async () => {
    mockClaimSeed = { exists: false }
    const { body } = await call('POST')
    expect(body.orphans).toHaveLength(1)
    expect(mockProbe).not.toHaveBeenCalled()
    expect(mockClaimSet).not.toHaveBeenCalled()
  })
})
