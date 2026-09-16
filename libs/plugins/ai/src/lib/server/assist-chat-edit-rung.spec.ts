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
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
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

describe('on the edit rung', () => {
  it('offers one strict tool, caches the edit block, and quotes the canvas as volatile data', async () => {
    armStream([OPENING, text('Darkening the hero.'), ...closing()])
    const response = await POST(post(editBody(FREE_ORG)))
    expect(response.status).toBe(200)
    await response.text()
    const request = providerRequest()
    expect(request.tools).toHaveLength(1)
    expect(request.tools[0]).toMatchObject({ name: 'propose_canvas_edit', strict: true })
    expect(request.max_tokens).toBe(4096)

    const system = request.system as SystemBlock[]
    const editBlock = system.findIndex((block) => block.text.startsWith('Editing this canvas:'))
    const canvasBlock = system.findIndex((block) => block.text.includes('Selected element: "hero"'))
    expect(editBlock).toBeGreaterThan(0)
    expect(system[editBlock].cache_control).toEqual({ type: 'ephemeral' })
    // The catalog rides once, inside the edit block.
    expect(system.filter((block) => block.text.includes(AI_PALETTE_CATALOG.screen))).toEqual([
      system[editBlock],
    ])
    expect(canvasBlock).toBeGreaterThan(editBlock)
    expect(system[canvasBlock].cache_control).toBeUndefined()
    expect(system[canvasBlock].text).toContain('Build faster')
    // GUARD: no canvas content and no tenant inside the cached prefix.
    for (const block of system.slice(0, editBlock + 1)) {
      expect(block.text).not.toContain('Build faster')
      expect(block.text).not.toContain('Freebies')
    }
  })

  it('beside level 2, the besigner screen block names the tool and the edit block follows it', async () => {
    armStream([OPENING, text('Darkening the hero.'), ...closing()])
    await (await POST(post(editBody(ADDON_ORG)))).text()
    const system = providerRequest().system as SystemBlock[]
    expect(system[1].text).toContain('This screen: The Besigner')
    expect(system[1].text).toContain('propose_canvas_edit')
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(system[2].text.startsWith('Editing this canvas:')).toBe(true)
    expect(system[2].cache_control).toEqual({ type: 'ephemeral' })
    expect(system.filter((block) => block.cache_control)).toHaveLength(3)
  })

  it('a tool call comes back as a validated, inert proposal, and nothing is written but the exchange and the meters', async () => {
    armStream([
      OPENING,
      text('I would darken the hero.'),
      ...toolCall(JSON.stringify(DARKEN)),
      ...closing('tool_use'),
    ])
    const events = await readEvents(await POST(post(editBody(FREE_ORG))))
    const answer = events
      .filter((event) => event.type === 'delta')
      .map((event) => String(event.text))
      .join('')
    expect(answer).toBe('I would darken the hero.')
    expect(events.some((event) => event.type === 'error')).toBe(false)
    const done = events.find((event) => event.type === 'done')
    expect(done?.edit).toMatchObject({
      id: 'edit.canvas',
      summary: 'Darken the hero',
      ops: [{ op: 'updateSx', nodeId: 'hero', componentId: 'muiStack', sx: { bgcolor: 'grey.900' } }],
      target: { kind: 'screen', documentId: 'screen-1', versionId: 'v-1', hostId: 'host-1' },
    })

    const paths = [...mockDocs.keys()]
    expect(paths.some((path) => /(^|\/)(hosts|screens|components|layouts)\//.test(path))).toBe(false)
    const signal = paths.find((path) => path.startsWith(`orgs/${FREE_ORG}/assistSignals/`))
    expect(mockDocs.get(signal as string)?.['editOps']).toBe(1)
  })

  it('a proposal naming elements the canvas did not describe shows no card, and says why', async () => {
    const invented = { summary: 'Remove it', ops: [op({ op: 'remove', nodeId: 'not-on-the-canvas' })] }
    armStream([OPENING, text('Removing it.'), ...toolCall(JSON.stringify(invented)), ...closing('tool_use')])
    const events = await readEvents(await POST(post(editBody(FREE_ORG))))
    expect(events.find((event) => event.type === 'done')?.edit).toBeNull()
    expect(String(events.find((event) => event.type === 'error')?.error)).toContain('could not be matched')
  })

  it('a tool call cut off by the output ceiling still meters the turn, and says it was cut short', async () => {
    armStream([
      OPENING,
      text('Adding a band.'),
      ...toolCall('{"summary":"Add a band","ops":[{"op":"insertSub'),
      ...closing('max_tokens'),
    ])
    const events = await readEvents(await POST(post(editBody(FREE_ORG))))
    const done = events.find((event) => event.type === 'done')
    expect(done).toBeDefined()
    expect(done?.edit).toBeNull()
    const errors = events.filter((event) => event.type === 'error').map((event) => String(event.error))
    expect(errors.some((error) => error.includes('cut short'))).toBe(true)
    expect(errors.some((error) => error.includes('could not be matched'))).toBe(false)
    const signal = [...mockDocs.keys()].find((path) => path.startsWith(`orgs/${FREE_ORG}/assistSignals/`))
    expect(mockDocs.get(signal as string)?.['stopReason']).toBe('max_tokens')
  })

  it('a question that stands on its own is still answered from the docs', async () => {
    const response = await POST(post(editBody(FREE_ORG, { question: 'How do I publish my first screen?' })))
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Assist-Served-By')).toBe('docs')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('GUARD: a question about "this" element is not answered with a docs quote on the rung', async () => {
    const question = 'How do I publish this screen?'
    // The control: below the rung, the same question is a docs answer.
    const below = await POST(post(editBody(PRO_ORG, { question })))
    expect(below.headers.get('X-Assist-Served-By')).toBe('docs')
    expect(mockFetch).not.toHaveBeenCalled()

    armStream([OPENING, text('Press Publish.'), ...closing()])
    const onRung = await POST(post(editBody(FREE_ORG, { question })))
    await onRung.text()
    expect(onRung.headers.get('X-Assist-Served-By')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('caches no answer: the same first question reaches the model again', async () => {
    armStream([OPENING, text('Darkening the hero.'), ...closing()])
    await (await POST(post(editBody(FREE_ORG)))).text()
    await (await POST(post(editBody(FREE_ORG)))).text()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockDocs.get(`orgs/${FREE_ORG}/counters/assistAnswerCache`)).toBeUndefined()
  })
})

describe('GUARD: below the rung the canvas never reaches the provider', () => {
  const closed: Array<[string, () => { orgId: string; overrides?: Record<string, unknown> }]> = [
    ['an org without AI generation', () => ({ orgId: PRO_ORG })],
    ['release_ai_generative off', () => (mockFlagsOff.add('release_ai_generative'), { orgId: FREE_ORG })],
    ['a role without ai.generate', () => (mockPermissionsDenied.add('ai.generate'), { orgId: FREE_ORG })],
    ['the ai-generate switch locked', () => (mockLockedFeatures.add('ai-generate'), { orgId: FREE_ORG })],
    [
      'a besigner route with no version to make first',
      () => ({
        orgId: FREE_ORG,
        overrides: { context: { route: '/acme/hosts/host-1/templates/t-1/besigner', hostId: 'host-1', orgSlug: 'acme' } },
      }),
    ],
    [
      'an outline that does not describe the document root',
      () => ({
        orgId: FREE_ORG,
        overrides: { canvas: { nodes: [{ id: 'hero', componentId: 'muiStack', parentId: ROOT }] } },
      }),
    ],
  ]

  it.each(closed)('%s: no tool, no edit block, no canvas', async (_label, arrange) => {
    const { orgId, overrides } = arrange()
    armStream([OPENING, text('Here is how.'), ...closing()])
    const response = await POST(post(editBody(orgId, overrides)))
    expect(response.status).toBe(200)
    const events = await readEvents(response)
    expect(events.find((event) => event.type === 'done')?.edit).toBeNull()
    const request = providerRequest()
    expect(request.tools).toBeUndefined()
    expect(request.max_tokens).toBe(1024)
    const prompt = JSON.stringify(request.system)
    expect(prompt).not.toContain('Editing this canvas')
    expect(prompt).not.toContain('Selected element')
    expect(prompt).not.toContain('Build faster')
    expect(prompt).not.toContain('propose_canvas_edit')
  })

  it('a staff claim previews the rung through a released-off flag and a role without ai.generate', async () => {
    mockFlagsOff.add('release_ai_generative')
    mockPermissionsDenied.add('ai.generate')
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true, staff: true })
    armStream([OPENING, text('Darkening the hero.'), ...closing()])
    await (await POST(post(editBody(FREE_ORG)))).text()
    expect(providerRequest().tools).toHaveLength(1)
  })
})
