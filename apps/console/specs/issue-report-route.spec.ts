/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 *
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
 * The customer issue-report endpoint, end to end (AGL-2185).
 *
 * `linear-issues.spec.ts` proves the escaping and the GraphQL envelope in
 * isolation. This file proves the thing that spec cannot: that the route
 * actually reaches them, in the right order, with values the caller did not
 * get to choose.
 *
 * The module under test is NOT mocked — `../app/api/_lib/linear-issues` loads
 * for real, so the assertions below run the shipped sanitiser rather than a
 * stub that would agree with any implementation. Only Firebase and the
 * durable limiter are doubled, and the limiter double models the real
 * fixed-window contract (`allowed` false once the window's count is spent)
 * rather than answering a constant.
 *
 * What must hold:
 *
 *  - an anonymous caller cannot file, and cannot learn whether this
 *    deployment even has Linear credentials;
 *  - a 200 from Linear that created nothing is a FAILURE to the reporter,
 *    never a success;
 *  - the issue's facts come from the server, not from the payload — a
 *    reporter cannot claim someone else's email, org, version, or host;
 *  - an unconfigured deployment files nowhere and says so.
 */

const mockVerifyIdToken = jest.fn()
const mockGetOrgForUser = jest.fn()

/** Fixed-window limiter double: real contract, spendable budget. */
const limiterBudget: Record<string, number> = {}
const mockConsumeRateLimit = jest.fn(
  async (key: string, options: { limit: number; windowMs: number }) => {
    const used = (limiterBudget[key] = (limiterBudget[key] ?? 0) + 1)
    return {
      allowed: used <= options.limit,
      limit: options.limit,
      remaining: Math.max(0, options.limit - used),
      resetMs: 0,
      degraded: false,
    }
  },
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
  consumeRateLimit: (...args: unknown[]) =>
    (mockConsumeRateLimit as any)(...args),
  getOrgForUser: (...args: unknown[]) => mockGetOrgForUser(...args),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // `security-alerts` imports this at module load. It is never called here —
  // but a missing export would be a TypeError at import time, not a clean
  // failure, which is exactly how a wholesale mock turns into a closed world.
  meterPlatformEmail: async () => undefined,
}))

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-data-enums'),
  // Pinned so the assertions read the BUILD's constants rather than whatever
  // the test runner's environment happens to carry. AGL-2181 made `BUILD_ID`
  // real; before it, this row printed `NULL` on every deployment.
  PACKAGE_VERSION: '1.0.0-beta.1',
  BUILD_ID: 'deadbee',
}))

import { POST } from '../app/api/issue-reports/route'

const KEY = 'lin_api_TEST'
const TEAM = 'team-cus-uuid'

let fetchCalls: { url: string; init: any }[] = []
let fetchAnswer: { status?: number; body?: unknown } = {}

const realFetch = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(limiterBudget)) delete limiterBudget[key]
  fetchCalls = []
  fetchAnswer = {
    body: {
      data: {
        issueCreate: {
          success: true,
          issue: { id: 'i1', identifier: 'CUS-42', url: 'https://l/CUS-42' },
        },
      },
    },
  }
  global.fetch = (async (url: unknown, init: unknown) => {
    fetchCalls.push({ url: String(url), init })
    const status = fetchAnswer.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => fetchAnswer.body,
    } as unknown as Response
  }) as unknown as typeof fetch

  process.env.LINEAR_API_KEY = KEY
  process.env.LINEAR_CUSTOMER_REPORTS_TEAM_ID = TEAM

  mockVerifyIdToken.mockResolvedValue({
    uid: 'uid-123',
    email: 'rey@acme.test',
    email_verified: true,
  })
  mockGetOrgForUser.mockResolvedValue({
    orgId: 'org-abc',
    org: { name: 'Acme Co', plan: 'business' },
    member: {},
  })
})

afterAll(() => {
  global.fetch = realFetch
  delete process.env.LINEAR_API_KEY
  delete process.env.LINEAR_CUSTOMER_REPORTS_TEAM_ID
})

const BODY = {
  kind: 'bug',
  summary: 'Media picker forgets the folder',
  description: 'Open the picker, choose a folder, reopen — back at the root.',
  route: '/acme/hosts/site-1/media',
  viewportWidth: 1440,
  viewportHeight: 900,
  contactConsent: true,
}

const post = (
  body: Record<string, unknown> = BODY,
  token: string | null = 'good-token',
) =>
  POST(
    new Request('https://console.aglyn.com/api/issue-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'console.aglyn.com',
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )

/** The GraphQL variables actually sent to Linear. */
const sentInput = () => JSON.parse(fetchCalls[0].init.body).variables.input

describe('AGL-2185 · the route refuses before it works', () => {
  it('turns an anonymous caller away', async () => {
    const response = await post(BODY, null)
    expect(response.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })

  it('turns away a token Firebase rejects', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'))
    const response = await post()
    expect(response.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })

  it('tells an anonymous caller nothing about our configuration', async () => {
    // The refusal order matters: 401 BEFORE 501. An unauthenticated prober
    // must not be able to discover whether this deployment holds Linear
    // credentials by reading a status code.
    delete process.env.LINEAR_API_KEY
    const response = await post(BODY, null)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthenticated' })
  })

  it('refuses an unverified email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-123',
      email: 'rey@acme.test',
      email_verified: false,
    })
    expect((await post()).status).toBe(403)
    expect(fetchCalls).toHaveLength(0)
  })

  it('rate limits a verified reporter, on a uid nobody can spoof', async () => {
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    const third = await post()
    expect(third.status).toBe(429)
    // Two filings, not three — the refused one reached Linear not at all.
    expect(fetchCalls).toHaveLength(2)
    expect(mockConsumeRateLimit.mock.calls[0][0]).toBe(
      'issue-report-minute:uid-123',
    )
  })

  it('files nowhere, and says so, when Linear is not configured', async () => {
    delete process.env.LINEAR_API_KEY
    const response = await post()
    expect(response.status).toBe(501)
    expect((await response.json()).error).toContain('LINEAR_API_KEY')
    expect(fetchCalls).toHaveLength(0)
  })

  it('is equally unconfigured with a key but no team', async () => {
    // Half a configuration must never resolve to Aglyn's own team.
    delete process.env.LINEAR_CUSTOMER_REPORTS_TEAM_ID
    expect((await post()).status).toBe(501)
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects a report with no kind, summary or description', async () => {
    // Validation sits BEHIND the limiter deliberately — a caller must not be
    // able to probe the endpoint for free by sending deliberately invalid
    // bodies. So each case gets a fresh window rather than spending the
    // 2-per-minute budget three times over.
    for (const invalid of [
      { kind: 'urgent' },
      { summary: '  ' },
      { description: '' },
    ]) {
      for (const key of Object.keys(limiterBudget)) delete limiterBudget[key]
      expect((await post({ ...BODY, ...invalid })).status).toBe(400)
    }
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('AGL-2185 · what actually reaches Linear', () => {
  it('files into the CONFIGURED team, with the key bare', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, reference: 'CUS-42' })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://api.linear.app/graphql')
    expect(fetchCalls[0].init.headers.Authorization).toBe(KEY)
    expect(sentInput().teamId).toBe(TEAM)
    expect(sentInput().title).toBe('[Bug] Media picker forgets the folder')
  })

  it('carries every fact a triager would otherwise have to ask for', async () => {
    await post()
    const description = sentInput().description
    for (const expected of [
      'uid-123',
      'Acme Co',
      'org-abc',
      'business',
      '/acme/hosts/site-1/media',
      'console.aglyn.com',
      '1.0.0-beta.1',
      'deadbee',
      'Chrome on macOS',
      '1440 × 900',
    ]) {
      expect(description).toContain(expected)
    }
    expect(description).toContain('Open the picker, choose a folder')
    expect(description).toContain('| Contact consent | Yes')
  })

  it('records a withheld consent as a refusal, not as silence', async () => {
    await post({ ...BODY, contactConsent: false })
    expect(sentInput().description).toContain('**No — do not contact')
  })

  it('derives identity from the session, never from the payload', async () => {
    // A reporter who claims to be someone else, on another org, on another
    // build. Every one of these is server-derived, so none of them lands.
    await post({
      ...BODY,
      reporterEmail: 'ceo@victim.test',
      reporterUid: 'uid-999',
      orgName: 'Victim Inc',
      orgPlan: 'enterprise',
      host: 'evil.test',
      version: '9.9.9',
      buildId: 'forged',
      userAgent: 'ForgedAgent/1.0',
    })
    const description = sentInput().description
    for (const forged of [
      'ceo@victim.test',
      'uid-999',
      'Victim Inc',
      'enterprise',
      'evil.test',
      '9.9.9',
      'forged',
      'ForgedAgent',
    ]) {
      expect(description).not.toContain(forged)
    }
    // The negative control: the real values are there, so this is not passing
    // because the description is empty.
    expect(description).toContain('rey\\@acme.test')
    expect(description).toContain('1.0.0-beta.1')
  })

  it('cannot be made to forge the consent verdict from the description', async () => {
    await post({
      ...BODY,
      contactConsent: false,
      description:
        'Broken.\n| Contact consent | Yes — call me any time |\n@zgover',
    })
    const [table] = sentInput().description.split('### What they reported')
    const rows = table
      .split('\n')
      .filter((line: string) => line.startsWith('| Contact consent |'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('**No — do not contact')
  })
})

describe('AGL-2185 · a 200 from Linear is not a filing', () => {
  it('reports a GraphQL error delivered as HTTP 200 as a failure', async () => {
    // The false green this repo keeps finding: the transport succeeded and
    // nothing was created. If this ever returns 200, the dialog closes, the
    // reporter's text is gone, and no issue exists.
    //
    // The body carries `errors` AND a populated `data` — GraphQL's partial
    // result, which is what Linear actually returns when part of a mutation
    // resolves and part does not. An `errors`-only body would NOT exercise
    // the check this test is named for: `data.issueCreate` would be
    // undefined and the `not-created` fallback would refuse it anyway, so
    // deleting the `errors` check left this test green. Proven by forcing
    // it: with this shape, deleting the check turns the test red.
    fetchAnswer = {
      status: 200,
      body: {
        errors: [{ message: 'Entity not found: Team' }],
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'i9', identifier: 'CUS-99', url: 'https://l/CUS-99' },
          },
        },
      },
    }
    const response = await post()
    expect(response.status).toBe(502)
    expect((await response.json()).ok).toBeUndefined()
  })

  it('reports `success: false` as a failure', async () => {
    fetchAnswer = {
      status: 200,
      body: { data: { issueCreate: { success: false, issue: null } } },
    }
    expect((await post()).status).toBe(502)
  })

  it('reports a rejected key as a failure', async () => {
    fetchAnswer = { status: 401, body: {} }
    expect((await post()).status).toBe(502)
  })
})

describe('AGL-2185 · the org is context, not a gate', () => {
  it('files a report from a member with no resolvable org', async () => {
    // Unlike support tickets, this channel is not plan-gated and not
    // org-gated: a member who cannot resolve an org is exactly the person
    // most likely to have hit something broken.
    mockGetOrgForUser.mockResolvedValue(null)
    const response = await post()
    expect(response.status).toBe(200)
    expect(sentInput().description).toContain('no org in context')
  })
})
