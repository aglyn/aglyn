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
 * The assist credit odometer — and the boundary our provider bill must not
 * cross.
 *
 * The document this route reads carries `estCostUsd`: what the month's assist
 * turns cost US at the serving model's list rates. The route's whole job is to
 * answer in credits instead, so the leak assertion below is the reason this
 * file exists rather than a nicety.
 */

export {}

let mockDocs = new Map<string, Record<string, unknown>>()
let mockMember: { $id: string } | null = { $id: 'user-1' }
let mockVerified = true

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      query: Object.fromEntries(url.searchParams.entries()),
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email_verified: mockVerified,
        }),
      }),
      firestore: () => ({
        collection: (name: string) => mockMakeCollection(name),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () => (mockMember ? { member: mockMember } : null),
}))

function mockMakeDoc(path: string) {
  return {
    path,
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
    get: async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
  }
}
function mockMakeCollection(prefix: string) {
  return { doc: (id: string) => mockMakeDoc(`${prefix}/${id}`) }
}

const { GET } = require('./route') as typeof import('./route')

const MONTH = new Date().toISOString().slice(0, 7)

const get = (orgId = 'org-1', token: string | null = 'user-token') =>
  new Request(
    `https://app.aglyn.com/api/billing/assist-credits?orgId=${orgId}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  )

beforeEach(() => {
  mockDocs = new Map()
  mockMember = { $id: 'user-1' }
  mockVerified = true
})

describe('the assist credit odometer', () => {
  it('answers in CREDITS and ships no dollar figure at all', async () => {
    mockDocs.set('orgs/org-1', { plan: 'business' })
    mockDocs.set(`orgs/org-1/assistUsage/${MONTH}`, { estCostUsd: 4.5 })
    const response = await GET(get())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.credits).toEqual({
      used: 4_500,
      limit: 18_000,
      remaining: 13_500,
    })
    const wire = JSON.stringify(payload)
    for (const leak of ['estCostUsd', 'costUsd', 'Usd', '4.5']) {
      expect(wire).not.toContain(leak)
    }
  })

  it('reports NO band for a plan that sells none, rather than 0 of 0', async () => {
    // Free carries `assistCreditsPerMonth: 0`, which means "this plan sells no
    // assist band" — not "a band of zero". Converting the operator backstop
    // into credits here would name a band the workspace never bought.
    mockDocs.set('orgs/org-1', { plan: 'free' })
    mockDocs.set(`orgs/org-1/assistUsage/${MONTH}`, { estCostUsd: 4.5 })
    const payload = await (await GET(get())).json()
    expect(payload.credits).toBeNull()
  })

  it('reads ZERO drawn for an org that has not used the assistant', async () => {
    // The negative control for the first test: without it, a build that
    // hardcoded 4,500 would pass both.
    mockDocs.set('orgs/org-1', { plan: 'business' })
    const payload = await (await GET(get())).json()
    expect(payload.credits).toEqual({
      used: 0,
      limit: 18_000,
      remaining: 18_000,
    })
  })

  it('honours a CONTRACTED band over the plan fallback', async () => {
    mockDocs.set('orgs/org-1', {
      plan: 'enterprise',
      entitlements: { assistCreditsPerMonth: 900_000 },
    })
    mockDocs.set(`orgs/org-1/assistUsage/${MONTH}`, { estCostUsd: 100 })
    const payload = await (await GET(get())).json()
    expect(payload.credits).toMatchObject({ limit: 900_000, used: 100_000 })
  })

  it('refuses the request before it reads anything', async () => {
    mockDocs.set('orgs/org-1', { plan: 'business' })
    expect(
      (await GET(new Request('https://app.aglyn.com/x', { method: 'POST' })))
        .status,
    ).toBe(405)
    expect((await GET(get('org-1', null))).status).toBe(401)
    expect((await GET(get(''))).status).toBe(400)
    mockMember = null
    expect((await GET(get())).status).toBe(403)
    mockMember = { $id: 'user-1' }
    mockVerified = false
    expect((await GET(get())).status).toBe(403)
    mockVerified = true
    mockDocs.delete('orgs/org-1')
    expect((await GET(get())).status).toBe(404)
  })
})
