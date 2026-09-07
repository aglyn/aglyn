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
 * The org's assist hard-cap switch (AGL-2653), and who may throw it.
 *
 * `assistOverage.hardCap` is an entitlement input in both directions: clear
 * it and the org can be invoiced past its band, set it and a workspace's
 * assistant stops at the band. The rules deny it to every client, so this
 * route is the only writer — which makes "only `billing.manage` may write it"
 * the whole security property, and the first thing this suite pins.
 *
 * Every case was forced red once against the code it guards; each says how.
 */

export {}

let mockDocs = new Map<string, Record<string, unknown>>()
let mockMember: { $id: string } | null = { $id: 'user-1' }
let mockVerified = true
let mockStaff = false
let mockPermissions = new Set<string>(['billing.manage'])
/** Every `adminAudit` row the route added. */
let mockAudit: Record<string, unknown>[] = []

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  )
  const adapter = jest.requireActual('@aglyn/aglyn/app-utils/api-adapter')
  return {
    __esModule: true,
    // REAL: the rate the route quotes must be the rate the rollup bills.
    PLAN_PRICING: entitlements.PLAN_PRICING,
    resolveEffectivePlan: entitlements.resolveEffectivePlan,
    pluginRequestFromWeb: adapter.pluginRequestFromWeb,
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email: 'admin@example.com',
          email_verified: mockVerified,
          ...(mockStaff ? { staff: true } : {}),
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
  memberHasOrgPermission: async (
    _orgId: string,
    member: unknown,
    permission: string,
  ) => Boolean(member) && mockPermissions.has(permission),
}))

function mockMerge(
  into: Record<string, unknown>,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...into }
  for (const [key, field] of Object.entries(value)) {
    const existing = merged[key]
    merged[key] =
      field &&
      typeof field === 'object' &&
      !Array.isArray(field) &&
      existing &&
      typeof existing === 'object'
        ? mockMerge(
            existing as Record<string, unknown>,
            field as Record<string, unknown>,
          )
        : field
  }
  return merged
}

function mockMakeDoc(path: string) {
  return {
    path,
    get: async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
    }),
    set: async (
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockDocs.set(
        path,
        options?.merge ? mockMerge(mockDocs.get(path) ?? {}, value) : value,
      )
    },
  }
}
function mockMakeCollection(prefix: string) {
  return {
    doc: (id: string) => mockMakeDoc(`${prefix}/${id}`),
    add: async (value: Record<string, unknown>) => {
      if (prefix === 'adminAudit') mockAudit.push(value)
      return { id: `auto-${mockAudit.length}` }
    },
  }
}

const { POST } = require('./route') as typeof import('./route')

const post = (
  body: Record<string, unknown>,
  token: string | null = 'user-token',
) =>
  new Request('https://app.aglyn.com/api/billing/assist-overage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const org = (plan: string, assistOverage?: Record<string, unknown>) => ({
  plan,
  subscription: { status: 'active' },
  ...(assistOverage ? { assistOverage } : {}),
})

beforeEach(() => {
  mockDocs = new Map()
  mockMember = { $id: 'user-1' }
  mockVerified = true
  mockStaff = false
  mockPermissions = new Set(['billing.manage'])
  mockAudit = []
})

describe('who may throw the switch', () => {
  it('401 without a token, and nothing is read or written', async () => {
    mockDocs.set('orgs/org-1', org('pro'))
    const response = await POST(
      post({ orgId: 'org-1', action: 'setHardCap', hardCap: true }, null),
    )
    expect(response.status).toBe(401)
    expect(mockDocs.get('orgs/org-1')).toEqual(org('pro'))
  })

  it('403 without billing.manage — a member who can see Billing cannot stop the assistant', async () => {
    // FORCED RED by dropping the `memberHasOrgPermission` check: the write
    // landed and the status was 200.
    mockDocs.set('orgs/org-1', org('pro'))
    mockPermissions = new Set(['billing.view'])
    const response = await POST(
      post({ orgId: 'org-1', action: 'setHardCap', hardCap: true }),
    )
    expect(response.status).toBe(403)
    expect(mockDocs.get('orgs/org-1')).toEqual(org('pro'))
    expect(mockAudit).toEqual([])
    // `get` is gated the same way: the switch's state is a billing fact.
    expect((await POST(post({ orgId: 'org-1', action: 'get' }))).status).toBe(403)
  })

  it('403 for a non-member, and for an unverified email', async () => {
    mockDocs.set('orgs/org-1', org('pro'))
    mockMember = null
    expect(
      (await POST(post({ orgId: 'org-1', action: 'setHardCap', hardCap: true })))
        .status,
    ).toBe(403)
    mockMember = { $id: 'user-1' }
    mockVerified = false
    expect(
      (await POST(post({ orgId: 'org-1', action: 'setHardCap', hardCap: true })))
        .status,
    ).toBe(403)
    expect(mockDocs.get('orgs/org-1')).toEqual(org('pro'))
  })

  it('staff may throw it without a membership, and the audit row names them', async () => {
    mockDocs.set('orgs/org-1', org('pro'))
    mockMember = null
    mockStaff = true
    const response = await POST(
      post({ orgId: 'org-1', action: 'setHardCap', hardCap: true }),
    )
    expect(response.status).toBe(200)
    expect(mockAudit).toHaveLength(1)
    expect(mockAudit[0]).toMatchObject({
      actorUid: 'user-1',
      action: 'billing.assistOverage.setHardCap',
      target: 'orgs/org-1',
    })
  })

  it('400 on a missing org or an unknown action; 404 on an org that does not exist', async () => {
    expect((await POST(post({ action: 'get' }))).status).toBe(400)
    expect(
      (await POST(post({ orgId: 'org-1', action: 'clearCap' }))).status,
    ).toBe(400)
    expect((await POST(post({ orgId: 'org-9', action: 'get' }))).status).toBe(404)
  })
})

describe('get — what the card reads', () => {
  it('reports the switch OFF by default, with the band and the rate it sells past at', async () => {
    mockDocs.set('orgs/org-1', org('pro'))
    const payload = await (await POST(post({ orgId: 'org-1', action: 'get' }))).json()
    expect(payload).toEqual({
      hardCap: false,
      bandCredits: 2_750,
      overageRateUsdPer1k: 3,
      sellsOverage: true,
      label: 'Stop AI assist at the included band',
    })
  })

  it('reports it ON once written, and only for the boolean', async () => {
    mockDocs.set('orgs/org-1', org('pro', { hardCap: true }))
    expect(
      (await (await POST(post({ orgId: 'org-1', action: 'get' }))).json()).hardCap,
    ).toBe(true)
    mockDocs.set('orgs/org-1', org('pro', { hardCap: 'true' }))
    expect(
      (await (await POST(post({ orgId: 'org-1', action: 'get' }))).json()).hardCap,
    ).toBe(false)
  })

  it('says a plan with no band, or no rate, sells no overage — so the card offers no switch', async () => {
    mockDocs.set('orgs/org-1', org('free'))
    expect(
      await (await POST(post({ orgId: 'org-1', action: 'get' }))).json(),
    ).toMatchObject({ bandCredits: null, overageRateUsdPer1k: null, sellsOverage: false })
    mockDocs.set('orgs/org-1', org('enterprise'))
    expect(
      await (await POST(post({ orgId: 'org-1', action: 'get' }))).json(),
    ).toMatchObject({ overageRateUsdPer1k: null, sellsOverage: false })
    expect(
      (await (await POST(post({ orgId: 'org-1', action: 'get' }))).json()).bandCredits,
    ).toBeGreaterThan(0)
  })
})

describe('setHardCap — the write', () => {
  it('ON: stores the boolean with who and when, and audits before → after', async () => {
    // FORCED RED by writing `hardCap: Boolean(body.hardCap)` unconditionally
    // — the strict-boolean case below then stored `true` for "false".
    mockDocs.set('orgs/org-1', org('pro'))
    const response = await POST(
      post({ orgId: 'org-1', action: 'setHardCap', hardCap: true }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, hardCap: true })
    expect(mockDocs.get('orgs/org-1')).toMatchObject({
      plan: 'pro',
      assistOverage: {
        hardCap: true,
        hardCapSetAt: '__now__',
        hardCapSetBy: 'user-1',
      },
    })
    expect(mockAudit).toEqual([
      expect.objectContaining({
        actorUid: 'user-1',
        actorEmail: 'admin@example.com',
        action: 'billing.assistOverage.setHardCap',
        target: 'orgs/org-1',
        before: { hardCap: false },
        after: { hardCap: true },
      }),
    ])
  })

  it('OFF: is always available — on any plan, from any state', async () => {
    // An org that wants the sale back on must not have to argue with a
    // precondition; and an org on a plan that sells no overage may still
    // clear a switch it carried over from one that did.
    for (const plan of ['pro', 'agency', 'enterprise', 'free']) {
      mockDocs.set('orgs/org-1', org(plan, { hardCap: true }))
      const response = await POST(
        post({ orgId: 'org-1', action: 'setHardCap', hardCap: false }),
      )
      expect(`${plan}: ${response.status}`).toBe(`${plan}: 200`)
      expect(mockDocs.get('orgs/org-1')).toMatchObject({
        assistOverage: { hardCap: false, hardCapSetBy: 'user-1' },
      })
    }
  })

  it('400 unless hardCap is a boolean — the string "false" must not become true', async () => {
    mockDocs.set('orgs/org-1', org('pro'))
    for (const hardCap of ['false', 'true', 1, 0, null, undefined]) {
      const response = await POST(
        post({ orgId: 'org-1', action: 'setHardCap', hardCap }),
      )
      expect(`${String(hardCap)}: ${response.status}`).toBe(`${String(hardCap)}: 400`)
      await expect(response.json()).resolves.toMatchObject({ code: 'invalid_value' })
    }
    expect(mockDocs.get('orgs/org-1')).toEqual(org('pro'))
    expect(mockAudit).toEqual([])
  })

  it('409 turning it ON where the plan sells no overage — a switch that does nothing reads as protection', async () => {
    // FORCED RED by dropping the `!sellsOverage` refusal: Enterprise stored
    // `hardCap: true` and answered 200.
    mockDocs.set('orgs/org-1', org('enterprise'))
    const enterprise = await POST(
      post({ orgId: 'org-1', action: 'setHardCap', hardCap: true }),
    )
    expect(enterprise.status).toBe(409)
    const walled = await enterprise.json()
    expect(walled).toMatchObject({ code: 'not_sold' })
    expect(mockDocs.get('orgs/org-1')).toEqual(org('enterprise'))

    mockDocs.set('orgs/org-1', org('free'))
    const free = await POST(
      post({ orgId: 'org-1', action: 'setHardCap', hardCap: true }),
    )
    expect(free.status).toBe(409)
    const bandless = await free.json()
    // Two different sentences for two different facts: no band at all, or a
    // band already walled.
    expect(String(bandless.error)).toMatch(/no AI assist credits/i)
    expect(String(walled.error)).toMatch(/already stops AI assist/i)
    expect(mockAudit).toEqual([])
  })

  it('a second write records the previous state as `before`', async () => {
    mockDocs.set('orgs/org-1', org('pro', { hardCap: true }))
    await POST(post({ orgId: 'org-1', action: 'setHardCap', hardCap: false }))
    expect(mockAudit[0]).toMatchObject({
      before: { hardCap: true },
      after: { hardCap: false },
    })
  })
})
