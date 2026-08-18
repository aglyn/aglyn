/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * Aglyn Assist chat route (AGL-1860): every gate in the ladder is forced
 * RED once — flag off → 404, feature lockdown → 423, free daily cap → 429
 * with NO model call, entitled monthly guard → 429 — and the green path is
 * verified end to end: SSE deltas re-emitted, the free tier's page context
 * DROPPED from the prompt, the entitled tier's injected, and the exchange +
 * meters recorded with real token numbers.
 *
 * `global.fetch` is replaced for the whole file; a test that does not
 * explicitly arm the Anthropic fake FAILS if the route reaches the network.
 * Entitlement checks run the REAL `checkEntitlement` over the real plan
 * table — a free org denies because the table says so, not because a stub
 * said so.
 */

export {}

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0
let mockFlagOn = true
let mockFeatureLockdown: Response | null = null
let mockLockdownResponse: Response | null = null
let mockRateAllowed = true

const mockVerifyIdToken = jest.fn()
const mockFetch = jest.fn()

const mockPlanEntitlements = jest.requireActual(
  '../../../../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
)

function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') base[key] = Number(base[key] ?? 0) + inc
    else base[key] = value
  }
  return base
}

function mockMakeFirestore() {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, Boolean(options?.merge)))
    },
    update: async (data: Record<string, unknown>) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, true))
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
  })
  return {
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const queued: Array<() => void> = []
      const batch = {
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(() => {
            mockDocs.set(
              ref.path,
              applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
            )
          })
          return batch
        },
        commit: async () => {
          for (const write of queued) write()
        },
      }
      return batch
    },
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: mockPlanEntitlements.checkEntitlement,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: {
      FieldValue: {
        increment: (n: number) => ({ __inc: n }),
        serverTimestamp: () => '__now__',
      },
    },
  },
  checkRateLimit: () => ({
    allowed: mockRateAllowed,
    limit: 20,
    remaining: mockRateAllowed ? 19 : 0,
    resetMs: Date.now() + 60_000,
  }),
  rateLimitHeaders: () => ({ 'X-RateLimit-Limit': '20' }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgForUser: async (uid: string, orgId?: string | null) => {
    const id = orgId ?? 'org-free'
    const org = mockDocs.get(`orgs/${id}`)
    return org ? { orgId: id, org, member: { $id: uid } } : null
  },
  isServerReleaseFlagOnForOrg: async () => mockFlagOn,
  lockdownRefusal: async () => mockLockdownResponse,
  featureLockdownRefusal: async () => mockFeatureLockdown,
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

const FREE_ORG = 'org-free'
const PRO_ORG = 'org-pro'
const TODAY = new Date().toISOString().slice(0, 10)
const MONTH = new Date().toISOString().slice(0, 7)

function seedOrgs(): void {
  mockDocs.set(`orgs/${FREE_ORG}`, { name: 'Freebies', plan: 'free' })
  mockDocs.set(`orgs/${PRO_ORG}`, {
    name: 'Pros',
    plan: 'pro',
    billingStatus: 'active',
  })
}

function post(body: unknown, token = 'user-token'): Request {
  return new Request('https://app.aglyn.com/api/assist/chat', {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const QUESTION_BODY = (orgId: string) => ({
  orgId,
  question: 'How do I publish my first screen?',
  history: [],
  context: { route: '/acme/screens', hostId: 'host-1', orgSlug: 'acme' },
})

/** Arm the Anthropic fake with a canned SSE stream. */
function armUpstream(stopReason = 'end_turn', withText = true): void {
  const encoder = new TextEncoder()
  const events = [
    {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 900,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 50,
        },
      },
    },
    ...(withText
      ? [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Open the screen, ' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'then press Publish.' } },
        ]
      : []),
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: 42 },
    },
    { type: 'message_stop' },
  ]
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        }
        controller.close()
      },
    }),
  })
}

/** Parse the route's SSE body back into events. */
async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)))
}

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  mockFlagOn = true
  mockFeatureLockdown = null
  mockLockdownResponse = null
  mockRateAllowed = true
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.ASSIST_MODEL
  delete process.env.ASSIST_FREE_DAILY_LIMIT
  delete process.env.ASSIST_ENTITLED_MONTHLY_LIMIT
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'user-1',
    email_verified: true,
    staff: false,
  })
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => {
    throw new Error('unarmed network call — this test must not reach Anthropic')
  })
  global.fetch = mockFetch as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the gate ladder — every guard forced red once', () => {
  it('501 without ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(501)
  })

  it('401 without a bearer token', async () => {
    const response = await POST(post(QUESTION_BODY(FREE_ORG), ''))
    expect(response.status).toBe(401)
  })

  it('400 without a question', async () => {
    seedOrgs()
    const response = await POST(post({ orgId: FREE_ORG, question: '' }))
    expect(response.status).toBe(400)
  })

  it('403 for a non-member org', async () => {
    seedOrgs()
    const response = await POST(post(QUESTION_BODY('org-else')))
    expect(response.status).toBe(403)
  })

  it('404 when the release flag is off — the feature does not exist', async () => {
    seedOrgs()
    mockFlagOn = false
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('staff pass a released-off flag (preview)', async () => {
    seedOrgs()
    mockFlagOn = false
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    armUpstream()
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(200)
  })

  it('423 when the ai-assist feature lockdown is active', async () => {
    seedOrgs()
    mockFeatureLockdown = Response.json(
      { error: 'locked', feature: 'ai-assist' },
      { status: 423 },
    )
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(423)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('429 when the per-user rate limit trips', async () => {
    seedOrgs()
    mockRateAllowed = false
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ reason: 'rate' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('429 quota for a free org at the daily cap — NO tokens spent', async () => {
    seedOrgs()
    mockDocs.set(`orgs/${FREE_ORG}/counters/assistMessagesDaily`, {
      [TODAY]: 10,
    })
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(429)
    const payload = await response.json()
    expect(payload.reason).toBe('quota')
    expect(payload.quota).toMatchObject({ period: 'day', limit: 10 })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('429 quota for an entitled org at the monthly runaway guard', async () => {
    seedOrgs()
    mockDocs.set(`orgs/${PRO_ORG}/assistUsage/${MONTH}`, { messages: 1000 })
    const response = await POST(post(QUESTION_BODY(PRO_ORG)))
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ reason: 'quota' })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

/**
 * AGL-1934: the org that gets METERED must be one the caller both belongs to
 * AND named.
 *
 * Membership answers only the first half, and it cannot catch the reported
 * bug — there the caller IS a member of the org being billed. The client's
 * org scope falls back to a remembered selection and then to the user's first
 * org, so questions asked from the workspace picker arrived naming a
 * workspace nobody had opened, and every one of the user's own orgs passes a
 * membership check. The second half is asserted here.
 *
 * Every case seeds a real, member, unlocked, under-quota org and changes only
 * the `context` — the page the question was asked from. The assertion is
 * always that no tokens were spent AND no meter moved, not merely that the
 * caller saw a 4xx: a refusal that still bumped `assistMessagesDaily` would
 * leave the billing defect exactly where it was.
 */
describe('metering is refused for an org the request did not name (AGL-1934)', () => {
  /** Everything the caller sent, minus the page they sent it from. */
  const askFrom = (context: unknown) => ({
    ...QUESTION_BODY(FREE_ORG),
    context,
  })

  /** No counter, usage rollup or exchange doc was written for the org. */
  const meteredPaths = () =>
    [...mockDocs.keys()].filter(
      (path) => path.startsWith(`orgs/${FREE_ORG}/`),
    )

  it('403s a question asked from the workspace picker', async () => {
    seedOrgs()
    const response = await POST(post(askFrom({ route: '/', hostId: '', orgSlug: '' })))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ reason: 'scope' })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(meteredPaths()).toEqual([])
  })

  it('403s a request that sends no page context at all', async () => {
    // The panel always sends one. A caller that does not cannot be attributed
    // — and "cannot be attributed" must not resolve to "bill whoever the body
    // says", which is precisely how the picker bug worked.
    seedOrgs()
    const response = await POST(post(askFrom(null)))
    expect(response.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(meteredPaths()).toEqual([])
  })

  it('403s from /manage/* on the apex, where no workspace is in scope', async () => {
    seedOrgs()
    const response = await POST(
      post(askFrom({ route: '/manage/user', hostId: '', orgSlug: '' })),
    )
    expect(response.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('403s from /admin/* even on a workspace subdomain', async () => {
    // The staff console is org-less on ANY hostname — it is the platform's
    // own view, not a workspace's (`urlNamesOrg`'s admin short-circuit). A
    // subdomain does not rescue it.
    seedOrgs()
    const response = await POST(
      post(askFrom({ route: '/admin/orgs', hostId: '', orgSlug: 'acme' })),
    )
    expect(response.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('403s when the page named a DIFFERENT workspace than the body', async () => {
    seedOrgs()
    mockDocs.set(`orgs/${FREE_ORG}`, { name: 'Freebies', plan: 'free', slug: 'acme' })
    const response = await POST(
      post(askFrom({ route: '/other-org/screens', hostId: '', orgSlug: '' })),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ reason: 'scope' })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(meteredPaths()).toEqual([])
  })

  it('403s when the SUBDOMAIN names a different workspace', async () => {
    seedOrgs()
    mockDocs.set(`orgs/${FREE_ORG}`, { name: 'Freebies', plan: 'free', slug: 'acme' })
    const response = await POST(
      post(askFrom({ route: '/manage/user', hostId: '', orgSlug: 'other-org' })),
    )
    expect(response.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('serves an org whose doc carries no slug — contradiction only', async () => {
    // The deliberate NON-suppression, settled the same way in AGL-1916.
    // `slug` is absent on plenty of org docs, and an org that cannot state
    // its own slug must not have every message refused. Only a slug that
    // actively DISAGREES suppresses. If this ever flips to 403, the gate has
    // become an outage.
    seedOrgs()
    armUpstream()
    const response = await POST(
      post(askFrom({ route: '/whatever-slug/screens', hostId: '', orgSlug: '' })),
    )
    expect(response.status).toBe(200)
    await response.text()
  })

  it('serves /manage/* on the workspace SUBDOMAIN, which does name it', async () => {
    // `business1.aglyn.com/manage/user` legitimately names a workspace even
    // though the path does not. Refusing it would be the false negative.
    seedOrgs()
    mockDocs.set(`orgs/${FREE_ORG}`, { name: 'Freebies', plan: 'free', slug: 'acme' })
    armUpstream()
    const response = await POST(
      post(askFrom({ route: '/manage/user', hostId: '', orgSlug: 'acme' })),
    )
    expect(response.status).toBe(200)
    await response.text()
  })

  it('still meters the org route the panel actually runs on', async () => {
    // The paired positive, asserted on the METER rather than the status: the
    // fix must not be "stop billing anyone".
    seedOrgs()
    mockDocs.set(`orgs/${FREE_ORG}`, { name: 'Freebies', plan: 'free', slug: 'acme' })
    armUpstream()
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(200)
    await response.text()
    expect(
      mockDocs.get(`orgs/${FREE_ORG}/counters/assistMessagesDaily`),
    ).toMatchObject({ [TODAY]: 1 })
    expect(mockDocs.get(`orgs/${FREE_ORG}/assistUsage/${MONTH}`)).toMatchObject({
      messages: 1,
    })
  })
})

describe('the green path', () => {
  it('streams deltas, records the exchange + meters (free tier)', async () => {
    seedOrgs()
    armUpstream()
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')

    const events = await readEvents(response)
    const deltas = events.filter((event) => event.type === 'delta')
    expect(deltas.map((event) => event.text).join('')).toBe(
      'Open the screen, then press Publish.',
    )
    const done = events.find((event) => event.type === 'done')
    expect(done).toBeTruthy()
    expect(done?.exchangeId).toBeTruthy()
    expect(done?.usage).toMatchObject({ inputTokens: 900, outputTokens: 42 })

    const exchange = mockDocs.get(
      `orgs/${FREE_ORG}/assistExchanges/${done?.exchangeId}`,
    )
    expect(exchange).toMatchObject({
      tier: 'free',
      answer: 'Open the screen, then press Publish.',
      inputTokens: 900,
      outputTokens: 42,
      feedback: null,
    })
    expect(
      mockDocs.get(`orgs/${FREE_ORG}/counters/assistMessagesDaily`),
    ).toMatchObject({ [TODAY]: 1 })
    expect(mockDocs.get(`orgs/${FREE_ORG}/assistUsage/${MONTH}`)).toMatchObject(
      { messages: 1, inputTokens: 900, outputTokens: 42 },
    )
  })

  it('free tier: page context is DROPPED from the prompt (level 1 cap)', async () => {
    seedOrgs()
    armUpstream()
    await POST(post(QUESTION_BODY(FREE_ORG)))
    const request = JSON.parse(String(mockFetch.mock.calls[0][1].body))
    const system = (request.system as Array<{ text: string }>)
      .map((block) => block.text)
      .join('\n')
    expect(system).not.toContain('Current console context')
  })

  it('entitled tier: page context IS injected (level 2)', async () => {
    seedOrgs()
    armUpstream()
    const response = await POST(post(QUESTION_BODY(PRO_ORG)))
    expect(response.status).toBe(200)
    await response.text()
    const request = JSON.parse(String(mockFetch.mock.calls[0][1].body))
    const system = (request.system as Array<{ text: string }>)
      .map((block) => block.text)
      .join('\n')
    expect(system).toContain('Current console context')
    expect(system).toContain('/acme/screens')
    const exchangePath = [...mockDocs.keys()].find((path) =>
      path.startsWith(`orgs/${PRO_ORG}/assistExchanges/`),
    )
    expect(mockDocs.get(exchangePath ?? '')).toMatchObject({ tier: 'entitled' })
  })

  it('the static system block carries the prompt-cache breakpoint', async () => {
    seedOrgs()
    armUpstream()
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    await response.text()
    const request = JSON.parse(String(mockFetch.mock.calls[0][1].body))
    expect(request.stream).toBe(true)
    expect(request.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(request.model).toBe('claude-sonnet-5')
  })

  it('sends thinking DISABLED and low effort — the defaults are not free', async () => {
    // On Sonnet 5 an omitted `thinking` runs ADAPTIVE at `high` effort, and
    // max_tokens caps thinking + answer together: leaving these off buys
    // output-priced silence and a truncated answer. Asserted because the
    // failure is invisible — the request still succeeds.
    seedOrgs()
    armUpstream()
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    await response.text()
    const request = JSON.parse(String(mockFetch.mock.calls[0][1].body))
    expect(request.thinking).toEqual({ type: 'disabled' })
    expect(request.output_config).toEqual({ effort: 'low' })
    expect(request.max_tokens).toBe(1024)
  })

  it('never opens the conversation on an assistant turn', async () => {
    // The client sends a trailing window of its thread; a window boundary
    // lands mid-exchange half the time, and the API 400s a history that
    // starts assistant-side. That would break the panel at exactly the
    // point a user has had a real conversation with it.
    seedOrgs()
    armUpstream()
    const response = await POST(
      post({
        ...QUESTION_BODY(FREE_ORG),
        history: [
          { role: 'assistant', text: 'the tail of an earlier answer' },
          { role: 'user', text: 'and then?' },
          { role: 'assistant', text: 'and then this' },
        ],
      }),
    )
    await response.text()
    const request = JSON.parse(String(mockFetch.mock.calls[0][1].body))
    expect(request.messages[0].role).toBe('user')
    expect(request.messages[0].content).toBe('and then?')
    expect(request.messages[request.messages.length - 1].content).toBe(
      'How do I publish my first screen?',
    )
  })

  it('a refusal reaches the user as words, not as silence', async () => {
    // stop_reason: 'refusal' is an HTTP 200 with an empty answer. Without
    // this the spinner stops and nothing appears — reads as a dead feature.
    seedOrgs()
    armUpstream('refusal', false)
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    const events = await readEvents(response)
    const failure = events.find((event) => event.type === 'error')
    expect(String(failure?.error)).toMatch(/could not answer/i)
    const done = events.find((event) => event.type === 'done')
    const exchange = mockDocs.get(
      `orgs/${FREE_ORG}/assistExchanges/${done?.exchangeId}`,
    )
    // Still recorded: the tokens were spent, and the refusal RATE is the
    // signal that the prompt or the corpus needs work.
    expect(exchange).toMatchObject({ stopReason: 'refusal', answer: '' })
  })

  it('a truncated answer says so instead of just stopping', async () => {
    seedOrgs()
    armUpstream('max_tokens')
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    const events = await readEvents(response)
    expect(
      String(events.find((event) => event.type === 'error')?.error),
    ).toMatch(/cut short/i)
  })

  it('502 when the upstream refuses', async () => {
    seedOrgs()
    mockFetch.mockResolvedValue({
      ok: false,
      status: 529,
      body: null,
      json: async () => ({ error: { message: 'Overloaded' } }),
    })
    const response = await POST(post(QUESTION_BODY(FREE_ORG)))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Overloaded' })
  })
})
