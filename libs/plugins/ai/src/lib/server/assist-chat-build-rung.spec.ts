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
 * The chat door's build rung (AGL-3616), on the edit rung's harness.
 *
 * On a site, with every generation gate cleared and a deployment that loaded
 * the build kind, the model is offered `propose_build`; a call comes back as
 * an inert `build` on `done` naming the request's own site, and nothing is
 * written but the exchange and the meters — the panel starts the job.
 *
 * (The edit rung's notes follow, kept with the harness they describe.)
 *
 * The chat door's edit rung (AGL-2906).
 *
 * The rung opens only for a request that clears every generation gate on a
 * versioned besigner route with the canvas described. On it the model gets
 * one strict tool, the edit block rides a cached breakpoint and the canvas a
 * volatile block, and a tool call comes back as a validated `edit` on `done`
 * — with nothing written but the exchange and the meters. Every closed rung
 * is forced once and asserted on the PROVIDER REQUEST, because a rung that
 * looks closed in the response while the canvas still reached the provider
 * is the failure that matters.
 *
 * Kept beside `assist-chat.spec.ts`, whose harness this follows, because that
 * suite pins the level-1 and level-2 ladder and answers a different question.
 */

import '../declarations'
export {}

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0
const mockFlagsOff = new Set<string>()
const mockPermissionsDenied = new Set<string>()
const mockLockedFeatures = new Set<string>()

const mockVerifyIdToken = jest.fn()
const mockFetch = jest.fn()

const mockPlanEntitlements = jest.requireActual(
  '@aglyn/aglyn/app-utils/plan-entitlements',
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
    // A site's remembered preferences (AGL-3661), listed whole.
    limit: () => ({
      get: async () => ({
        docs: [...mockDocs.entries()]
          .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
          .map(([path, data]) => ({ id: path.slice(prefix.length + 1), data: () => data })),
      }),
    }),
  })
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      const queued: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: mockDocs.has(ref.path),
          data: () => mockDocs.get(ref.path),
          get: (field: string) => (mockDocs.get(ref.path) ?? {})[field],
        }),
        set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          queued.push(() => {
            mockDocs.set(ref.path, applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)))
          })
        },
      }
      const result = await fn(tx)
      for (const write of queued) write()
      return result
    },
    batch: () => {
      const queued: Array<() => void> = []
      const batch = {
        set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          queued.push(() => {
            mockDocs.set(ref.path, applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)))
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
  resolveBrandingProfile: mockPlanEntitlements.resolveBrandingProfile,
  PLATFORM_BRAND_NAME: jest.requireActual('@aglyn/aglyn/app-utils/platform-brand')
    .PLATFORM_BRAND_NAME,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

const MONTH_OLD_ACCOUNT = { metadata: { creationTime: 'Thu, 13 Aug 2026 00:00:00 GMT' } }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        getUser: async () => MONTH_OLD_ACCOUNT,
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
  authForPool: () => ({ getUser: async () => MONTH_OLD_ACCOUNT }),
  checkRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, resetMs: Date.now() + 60_000 }),
  rateLimitHeaders: () => ({ 'X-RateLimit-Limit': '20' }),
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgForUser: async (uid: string, orgId?: string | null) => {
    const id = orgId ?? ''
    const org = mockDocs.get(`orgs/${id}`)
    return org ? { orgId: id, org, member: { $id: uid } } : null
  },
  isServerReleaseFlagOnForOrg: async (flag: string) => !mockFlagsOff.has(flag),
  lockdownRefusal: async () => null,
  featureLockdownRefusal: async ({ feature }: { feature: string }) =>
    mockLockedFeatures.has(feature)
      ? Response.json({ error: 'locked', reason: 'lockdown' }, { status: 423 })
      : null,
  memberHasPermissionOnHost: async (_org: string, _host: unknown, _member: unknown, permission: string) =>
    !mockPermissionsDenied.has(permission),
  permissionRefusal: (permission: string) =>
    Response.json({ error: `Your role does not include ${permission}`, reason: 'permission' }, { status: 403 }),
}))

const { POST } = require('./assist-chat') as {
  POST: (request: Request) => Promise<Response>
}

/** Free carries AI generation as its taste; Pro does not without the add-on. */
const FREE_ORG = 'org-free'
const PRO_ORG = 'org-pro'
const ADDON_ORG = 'org-addon'
const ROOT = '_@_'
const ROUTE = '/acme/hosts/host-1/screens/screen-1/versions/v-1/besigner'

const CANVAS = {
  selectedId: 'hero',
  nodes: [
    { id: ROOT, componentId: 'div', parentId: null, index: 0, childCount: 1 },
    {
      id: 'hero',
      componentId: 'muiStack',
      parentId: ROOT,
      index: 0,
      childCount: 1,
      name: 'Hero',
      sx: { bgcolor: 'background.paper' },
    },
    {
      id: 'headline',
      componentId: 'muiTypography',
      parentId: 'hero',
      index: 0,
      childCount: 0,
      props: { children: 'Build faster', variant: 'h1' },
    },
  ],
}

/** A diagnostic-free instruction: it does not stand on its own, so it escalates. */
const EDIT_QUESTION = 'Make the hero darker'

const editBody = (orgId: string, overrides: Record<string, unknown> = {}) => ({
  orgId,
  question: EDIT_QUESTION,
  history: [],
  context: { route: ROUTE, hostId: 'host-1', orgSlug: 'acme' },
  canvas: CANVAS,
  ...overrides,
})

function post(body: unknown): Request {
  return new Request('https://app.aglyn.com/api/assist/chat', {
    method: 'POST',
    headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type Frame = Record<string, unknown>

/** Arm the provider fake: every call gets a fresh stream of these events. */
function armStream(events: Frame[]): void {
  mockFetch.mockImplementation(async () => {
    const encoder = new TextEncoder()
    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          }
          controller.close()
        },
      }),
    }
  })
}

const OPENING: Frame = { type: 'message_start', message: { usage: { input_tokens: 900 } } }
const text = (value: string): Frame => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: value },
})
const toolCall = (partialJson: string): Frame[] => [
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'propose_canvas_edit' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: partialJson } },
  { type: 'content_block_stop', index: 1 },
]
const closing = (stopReason = 'end_turn'): Frame[] => [
  { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 120 } },
  { type: 'message_stop' },
]

const op = (fields: Record<string, unknown>) => ({
  op: '',
  nodeId: '',
  parentId: '',
  index: -1,
  props: [],
  sx: [],
  nodes: [],
  name: '',
  seo: [],
  ...fields,
})

const DARKEN = {
  summary: 'Darken the hero',
  ops: [op({ op: 'updateSx', nodeId: 'hero', sx: [{ key: 'bgcolor', value: 'grey.900', breakpoint: '' }] })],
}

async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const body = await response.text()
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)))
}

const providerRequest = (call = 0) => JSON.parse(String(mockFetch.mock.calls[call][1].body))

type SystemBlock = { text: string; cache_control?: unknown }

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  mockFlagsOff.clear()
  mockPermissionsDenied.clear()
  mockLockedFeatures.clear()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.ASSIST_MODEL
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true, staff: false })
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => {
    throw new Error('unarmed network call — this test must not reach the provider')
  })
  global.fetch = mockFetch as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  mockDocs.set(`orgs/${FREE_ORG}`, { name: 'Freebies', plan: 'free' })
  mockDocs.set(`orgs/${PRO_ORG}`, { name: 'Pros', plan: 'pro', billingStatus: 'active' })
  mockDocs.set(`orgs/${ADDON_ORG}`, {
    name: 'Addons',
    plan: 'pro',
    billingStatus: 'active',
    seatAddons: { aiAddon: 1 },
  })
})

afterEach(() => jest.restoreAllMocks())

const SITE_ROUTE = '/acme/hosts/host-1/screens'
const BUILD_QUESTION = 'Create a few new pages, add a booking form and a contact form, and then an about page'
const buildBody = (orgId: string, overrides: Record<string, unknown> = {}) => ({
  orgId,
  question: BUILD_QUESTION,
  history: [],
  context: { route: SITE_ROUTE, hostId: 'host-1', orgSlug: 'acme' },
  ...overrides,
})
const buildCall = (input: Record<string, unknown>): Frame[] => [
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'propose_build' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 1 },
]
const fakeRunner = async () => ({ outputs: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, estCostUsd: 0, model: 'm', stopReason: null })

// Required, not imported: the mocks above must exist before the machine loads.
const { registerAiJobStep } = require('../jobs/ai-jobs') as typeof import('../jobs/ai-jobs')
const { registerAiBuildCapabilities } = require('../jobs/ai-build-capabilities') as typeof import('../jobs/ai-build-capabilities')

describe('on the build rung (AGL-3616)', () => {
  beforeAll(() => {
    registerAiBuildCapabilities()
    registerAiJobStep('page', fakeRunner as never)
    registerAiJobStep('form', fakeRunner as never)
    registerAiJobStep('build', fakeRunner as never)
  })
  afterAll(() => {
    registerAiJobStep('build', null as never)
  })
  beforeEach(() => {
    mockDocs.set('hosts/host-1', { orgId: FREE_ORG, name: 'Groomers' })
  })

  it('offers propose_build, caches its protocol, and lists what a build can make here as volatile data', async () => {
    armStream([OPENING, text('I will plan that.'), ...closing()])
    await (await POST(post(buildBody(FREE_ORG)))).text()
    const request = providerRequest()
    expect(request.tools.map((tool: { name: string }) => tool.name)).toEqual(['propose_build'])
    expect(request.tools[0]).toMatchObject({ strict: true })
    const system = request.system as SystemBlock[]
    const protocol = system.findIndex((block) => block.text.startsWith('Building on this site:'))
    const intents = system.findIndex((block) => block.text.startsWith('A build here can make:'))
    expect(protocol).toBeGreaterThan(0)
    expect(system[protocol].cache_control).toEqual({ type: 'ephemeral' })
    expect(intents).toBeGreaterThan(protocol)
    expect(system[intents].cache_control).toBeUndefined()
    expect(system[intents].text).toContain('a contact form')
  })

  it('tells the build which business it is for, cached per site after the protocol, inventing no contact details (AGL-3661)', async () => {
    mockDocs.set('hosts/host-1', { orgId: FREE_ORG, name: 'Groomers', displayName: 'Paws & Co' })
    mockDocs.set('hosts/host-1/businessProfile/profile', { services: ['Bath and brush'], sources: { services: 'owner' } })
    mockDocs.set('hosts/host-1/aiMemory/length-short', {
      group: 'length',
      text: 'Prefers short, concise copy',
      count: 3,
      lastSeenAtMs: 1,
      source: 'assist-edit',
    })
    armStream([OPENING, text('I will plan that.'), ...closing()])
    await (await POST(post(buildBody(FREE_ORG)))).text()
    const system = providerRequest().system as SystemBlock[]
    const protocol = system.findIndex((block) => block.text.startsWith('Building on this site:'))
    const site = system.findIndex((block) => block.text.startsWith('About this site'))
    expect(site).toBe(protocol + 1)
    expect(system[site].cache_control).toEqual({ type: 'ephemeral' })
    expect(system[site].text).toContain('Business name: Paws & Co')
    expect(system[site].text).toContain('Services: Bath and brush')
    expect(system[site].text).toContain('Prefers short, concise copy')
    expect(system[site].text).toContain('Contact details: none entered yet.')
    expect(system[site].text).toContain('Never invent')
    // Nothing cached after it: the site's block closes the span.
    expect(system.slice(site + 1).every((block) => block.cache_control === undefined)).toBe(true)
  })

  it('a tool call comes back as an inert build on the request’s own site, and nothing is built', async () => {
    armStream([
      OPENING,
      text('I will plan three pages and the two forms.'),
      ...buildCall({ summary: 'Plan pages and forms', brief: BUILD_QUESTION, publish: false, hostId: 'someone-else' }),
      ...closing('tool_use'),
    ])
    const events = await readEvents(await POST(post(buildBody(FREE_ORG))))
    const done = events.find((event) => event.type === 'done')
    expect(done?.build).toMatchObject({ id: 'build', hostId: 'host-1', publish: false, summary: 'Plan pages and forms' })
    expect(String((done?.build as { brief: string }).brief)).toContain(BUILD_QUESTION)
    expect([...mockDocs.keys()].some((path) => /aiJobs|screens|forms/.test(path))).toBe(false)
  })

  it('stays closed off a site, without ai.generate, or with the switch off — and the provider never sees the tool', async () => {
    for (const setUp of [
      () => ({ context: { route: '/acme/settings', hostId: '', orgSlug: 'acme' } }),
      () => (mockPermissionsDenied.add('ai.generate'), {}),
      () => (mockLockedFeatures.add('ai-generate'), {}),
      () => (mockFlagsOff.add('release_ai_generative'), {}),
    ]) {
      mockFetch.mockClear()
      armStream([OPENING, text('Here is how.'), ...closing()])
      const events = await readEvents(await POST(post(buildBody(FREE_ORG, setUp()))))
      // Off the rung the request may be answered from the docs, with no provider call at all.
      if (mockFetch.mock.calls.length) expect(providerRequest().tools).toBeUndefined()
      expect(events.find((event) => event.type === 'done')?.build ?? null).toBeNull()
      mockPermissionsDenied.clear()
      mockLockedFeatures.clear()
      mockFlagsOff.clear()
    }
  })
})
