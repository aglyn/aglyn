/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * The staff site transfer route (AGL-3381): super staff only, a reason on
 * every move, and a refusal that hands back the plan that refused it.
 */

const mockPlan = jest.fn()
const mockTransfer = jest.fn()
const mockAudit = jest.fn(async () => undefined)
const mockOrgActivity = jest.fn(async () => undefined)
let claims: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => (global as any).__claims() }),
      firestore: () => ({}),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  logHostActivity: async () => undefined,
  logOrgActivity: (...args: unknown[]) => mockOrgActivity(...(args as [])),
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAudit(...(args as [])),
}))
jest.mock('@aglyn/tenant-data-admin/server/transfer-host', () => ({
  __esModule: true,
  // Declared inside the factory: `jest.mock` is hoisted above the file.
  HostTransferRefusedError: class HostTransferRefusedError extends Error {
    plan: unknown
    constructor(plan: any) {
      super(plan.holds.map((hold: any) => hold.message).join(' '))
      this.plan = plan
    }
  },
  planHostTransfer: (...args: unknown[]) => mockPlan(...args),
  transferHost: (...args: unknown[]) => mockTransfer(...args),
}))
jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  revalidateEntireHost: async () => undefined,
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__' },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: request.method === 'POST' ? await request.json() : undefined,
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))
;(global as any).__claims = () => claims

import { GET, POST } from '../app/api/admin/site-transfer/route'

const { HostTransferRefusedError: MockRefused } = jest.requireMock(
  '@aglyn/tenant-data-admin/server/transfer-host',
) as { HostTransferRefusedError: new (plan: unknown) => Error }

const PLAN = {
  hostId: 'h1',
  siteName: 'Harbor',
  fromOrgId: 'from',
  fromOrgName: 'Old Co',
  toOrgId: 'to',
  toOrgName: 'New Co',
  holds: [],
  warnings: [],
  facts: {},
}

const get = () =>
  GET(
    new Request('https://console.test/api/admin/site-transfer?hostId=h1&toOrgId=to', {
      headers: { authorization: 'Bearer t' },
    }),
  )
const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.test/api/admin/site-transfer', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  claims = { uid: 'staff-1', email: 's@example.com', email_verified: true, staff: true, staffRole: 'super' }
  mockPlan.mockReset().mockResolvedValue(PLAN)
  mockTransfer.mockReset().mockResolvedValue(PLAN)
  mockAudit.mockClear()
  mockOrgActivity.mockClear()
})

describe('the staff site transfer route', () => {
  it('is for super staff only', async () => {
    claims = { ...claims, staffRole: 'support' }
    expect((await get()).status).toBe(403)
    expect((await post({ hostId: 'h1', toOrgId: 'to', reason: 'customer asked' })).status).toBe(403)
    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('plans without moving anything', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect((await response.json()).plan.toOrgName).toBe('New Co')
    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('needs a reason, because the audit row carries one', async () => {
    expect((await post({ hostId: 'h1', toOrgId: 'to', reason: 'short' })).status).toBe(400)
    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('hands back the plan that refused it', async () => {
    const held = { ...PLAN, holds: [{ code: 'site-limit', message: 'At its limit.' }] }
    mockTransfer.mockRejectedValue(new MockRefused(held))
    const response = await post({ hostId: 'h1', toOrgId: 'to', reason: 'customer asked' })
    expect(response.status).toBe(409)
    expect((await response.json()).plan.holds[0].code).toBe('site-limit')
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('moves, audits with the reason, and tells both organizations', async () => {
    const response = await post({ hostId: 'h1', toOrgId: 'to', reason: 'customer asked', overrideSiteLimit: true })
    expect(response.status).toBe(200)
    expect(mockTransfer).toHaveBeenCalledWith({ hostId: 'h1', toOrgId: 'to', overrideSiteLimit: true })
    expect(mockAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'host.transfer', reason: 'customer asked', target: 'hosts/h1' }),
    )
    expect(mockOrgActivity.mock.calls.map((call: any[]) => call[0]).sort()).toEqual(['from', 'to'])
  })
})
