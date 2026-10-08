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
 * `crm/email-check` (AGL-3328): who may ask what the platform knows about
 * an address, and which sending domain's standing they are told. The
 * reader itself is a spy — the cache and the ledger are proved in the admin
 * lib — so the claims here are the gates and the sender.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const HOST = 'site-1'
const OTHER_HOST = 'site-elsewhere'
const ORG = 'org-1'

let mockDecoded: Record<string, unknown> = { uid: 'u-1' }
let mockMember: Record<string, unknown> | null = { role: 'editor', allHosts: true }
let mockPermitted = true
let mockPermissions: Record<string, unknown> = {
  orgId: ORG,
  role: 'editor',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'editor',
}
let mockPlan = 'agency'
const mockRead = jest.fn(async (input: { email: string; from?: string | null }) => ({
  email: input.email,
  checked: true,
  code: 'no_mx',
  message: 'parked.example has no mail server, so pat@parked.example would bounce.',
  gateway: null,
  chip: { label: 'No MX record — cannot receive mail', tone: 'blocked' },
}))

let mockAccountLock: 'banned' | 'locked' | null = null
const mockLockState = jest.fn(async (input: { hostId: string; email: string }) => (input.email ? mockAccountLock : null))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => mockPermissions,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ auth: () => ({ verifyIdToken: async () => mockDecoded }) }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === HOST
      ? { orgId: ORG, org: { $id: ORG, plan: mockPlan } }
      : hostId === OTHER_HOST
        ? { orgId: 'org-2', org: { $id: 'org-2', plan: 'agency' } }
        : null,
  getOrgDoc: async (orgId: string) => (orgId === ORG ? { $id: ORG, plan: mockPlan } : null),
  resolveOrgMembership: async () => ({ member: mockMember }),
  memberHasOrgPermission: async () => mockPermitted,
  hostSendingIdentity: async (hostId: string) => ({
    from: `Shop <hello@${hostId}.example>`,
    refusal: null,
  }),
}))
jest.mock('@aglyn/tenant-data-admin/server/capture-email-check', () => ({
  __esModule: true,
  readAddressDeliverability: (input: { email: string; from?: string | null }) => mockRead(input),
}))

jest.mock('@aglyn/tenant-data-admin/server/account-lock-mail', () => ({
  __esModule: true,
  accountLockStateFor: (input: { hostId: string; email: string }) => mockLockState(input),
}))

import { CRM_EMAIL_CHECK_ROUTE, crmEmailCheckHandler } from './email-check'

async function call(body: unknown, options: { method?: string; token?: string | null } = {}) {
  const { method = 'POST', token = 'token' } = options
  let status = 0
  let answer: any
  const res = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    setHeader: () => undefined,
  } as unknown as PluginApiResponse
  const req = {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
  } as unknown as PluginApiRequest
  await crmEmailCheckHandler(req, res)
  return { status, answer }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDecoded = { uid: 'u-1' }
  mockMember = { role: 'editor', allHosts: true }
  mockPermitted = true
  mockPermissions = {
    orgId: ORG,
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  }
  mockPlan = 'agency'
  mockAccountLock = null
})

describe('crm/email-check', () => {
  it('is registered under the name the client posts to', () => {
    expect(CRM_EMAIL_CHECK_ROUTE).toBe('crm/email-check')
  })

  it('answers what the platform knows, for the sending domain of the mounted site', async () => {
    const { status, answer } = await call({ hostId: HOST, email: ' Pat@Parked.example ' })
    expect(status).toBe(200)
    expect(answer).toMatchObject({ ok: true, checked: true, code: 'no_mx' })
    expect(mockRead).toHaveBeenCalledWith({ email: 'pat@parked.example', from: `Shop <hello@${HOST}.example>` })
  })

  it('refuses a missing token, a missing address, and anything but POST', async () => {
    expect((await call({ hostId: HOST, email: 'pat@x.example' }, { token: null })).status).toBe(401)
    expect((await call({ hostId: HOST })).status).toBe(400)
    expect((await call({ email: 'pat@x.example' })).status).toBe(400)
    expect((await call({ hostId: HOST, email: 'pat@x.example' }, { method: 'GET' })).status).toBe(405)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('needs data.manage on the site, as the contacts read rule does', async () => {
    mockPermitted = false
    expect((await call({ hostId: HOST, email: 'pat@x.example' })).status).toBe(403)
    mockPermitted = true
    mockMember = null
    expect((await call({ hostId: HOST, email: 'pat@x.example' })).status).toBe(403)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('is the suite’s, like the record pages it serves', async () => {
    mockPlan = 'free'
    const { status } = await call({ hostId: HOST, email: 'pat@x.example' })
    expect(status).toBe(403)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('at the organization level reads the named site’s sender only when the site is the org’s', async () => {
    expect((await call({ orgId: ORG, hostId: HOST, email: 'pat@x.example' })).status).toBe(200)
    expect(mockRead).toHaveBeenLastCalledWith({ email: 'pat@x.example', from: `Shop <hello@${HOST}.example>` })
    // Another workspace's site: no sender, so no ledger — only the MX.
    expect((await call({ orgId: ORG, hostId: OTHER_HOST, email: 'pat@x.example' })).status).toBe(200)
    expect(mockRead).toHaveBeenLastCalledWith({ email: 'pat@x.example', from: null })
  })

  it('refuses an organization-level caller who is not org-wide', async () => {
    mockPermissions = { ...mockPermissions, orgWide: false }
    expect((await call({ orgId: ORG, email: 'pat@x.example' })).status).toBe(403)
    expect(mockRead).not.toHaveBeenCalled()
  })

  describe('an address held by a locked account (AGL-3686)', () => {
    it('says banned or locked, read on the mounted site', async () => {
      mockAccountLock = 'banned'
      const { answer } = await call({ hostId: HOST, email: 'Pat@X.example' })
      expect(answer).toMatchObject({ ok: true, accountLock: 'banned' })
      expect(mockLockState).toHaveBeenCalledWith({ hostId: HOST, email: 'pat@x.example' })
      mockAccountLock = 'locked'
      expect((await call({ hostId: HOST, email: 'pat@x.example' })).answer.accountLock).toBe('locked')
    })

    it('says nothing for an address no lock holds', async () => {
      expect((await call({ hostId: HOST, email: 'pat@x.example' })).answer.accountLock).toBeNull()
    })

    it('reads no site at the organization level when the named site is not the org’s', async () => {
      mockAccountLock = 'banned'
      const { answer } = await call({ orgId: ORG, hostId: OTHER_HOST, email: 'pat@x.example' })
      expect(answer.accountLock).toBeNull()
      expect(mockLockState).not.toHaveBeenCalled()
    })

    it('is not read for a caller the route refuses', async () => {
      mockPermitted = false
      await call({ hostId: HOST, email: 'pat@x.example' })
      expect(mockLockState).not.toHaveBeenCalled()
    })
  })
})
