/**
 * @jest-environment node
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
 * AGL-3955 — the two doors of a staff-minted bundle link.
 *
 * `/api/admin/bundle-link` is staff only: it mints the link and answers
 * whether this deployment sells domains. `/api/billing/bundle-link` answers
 * the link's domain line to a member who can see Billing, for the workspace
 * they are signed into, never one named only by the URL. What the record
 * holds, how it expires and how it is spent are pinned against the library
 * in `libs/tenant/data/admin/src/lib/server/bundle-links.spec.ts`.
 */

const mockVerifyIdToken = jest.fn()
const mockMint = jest.fn()
const mockRegistrar = jest.fn()
const mockReadDomain = jest.fn()
const mockResolveMembership = jest.fn()
const mockHasPermission = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
  isImpersonationSession: () => false,
  resolveOrgMembership: (...args: unknown[]) => mockResolveMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => mockHasPermission(...args),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
    }),
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/bundle-links', () => {
  class BundleLinkError extends Error {
    readonly status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  }
  return {
    __esModule: true,
    BundleLinkError,
    domainsRegistrarConfigured: () => mockRegistrar(),
    mintBundleLink: (...args: unknown[]) => mockMint(...args),
    readBundleLinkDomain: (...args: unknown[]) => mockReadDomain(...args),
  }
})
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: request.method === 'GET' ? {} : await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers.entries()),
  }),
}))

import { BundleLinkError } from '@aglyn/tenant-data-admin/server/bundle-links'
import { GET as adminGet, POST as adminPost } from '../app/api/admin/bundle-link/route'
import { GET as billingGet } from '../app/api/billing/bundle-link/route'

const auth = { authorization: 'Bearer tok', origin: 'https://app.aglyn.com' }

const mint = (body: Record<string, unknown>, headers: Record<string, string> = auth) =>
  adminPost(
    new Request('https://app.aglyn.com/api/admin/bundle-link', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

const readLine = (query: string, headers: Record<string, string> = auth) =>
  billingGet(
    new Request(`https://app.aglyn.com/api/billing/bundle-link?${query}`, { method: 'GET', headers }),
  )

const STAFF = { uid: 'staff-1', email: 'zed@aglyn.test', email_verified: true, staff: true }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  mockVerifyIdToken.mockResolvedValue(STAFF)
  mockRegistrar.mockReturnValue(true)
  mockMint.mockResolvedValue({
    id: 'link-1',
    url: 'https://app.aglyn.com/acme/billing?plan=starter&addons=siteCare&bundle=link-1',
    expiresAt: 2,
  })
  mockResolveMembership.mockResolvedValue({ orgId: 'org-1', member: { role: 'owner' } })
  mockHasPermission.mockResolvedValue(true)
  mockReadDomain.mockResolvedValue({ available: true, domain: null })
})

afterEach(() => jest.restoreAllMocks())

describe('/api/admin/bundle-link: staff mint the link (AGL-3955)', () => {
  it('staff mint one, with the whole bundle and the console origin', async () => {
    const domain = { name: 'acme.com', firstYearCents: 1125, renewalCents: 1500, hostId: 'h1' }
    const response = await mint({
      plan: 'starter',
      addons: { siteCare: 1 },
      interval: 'year',
      coupon: 'BOOTH25',
      domain,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, id: 'link-1' })
    expect(mockMint).toHaveBeenCalledWith({
      orgId: 'org-1',
      actor: { uid: 'staff-1', email: 'zed@aglyn.test' },
      origin: 'https://app.aglyn.com',
      plan: 'starter',
      addons: { siteCare: 1 },
      interval: 'year',
      coupon: 'BOOTH25',
      domain,
    })
  })

  it('a domain that is not an object is no domain line', async () => {
    await mint({ plan: 'starter', domain: 'acme.com' })
    expect(mockMint).toHaveBeenCalledWith(expect.objectContaining({ domain: null }))
  })

  it('answers whether this deployment sells domains', async () => {
    mockRegistrar.mockReturnValue(false)
    const response = await adminGet(
      new Request('https://app.aglyn.com/api/admin/bundle-link', { method: 'GET', headers: auth }),
    )
    expect(await response.json()).toEqual({ domainsAvailable: false })
  })

  it('nobody else mints one, the workspace owner included', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner', email_verified: true })
    expect((await mint({ plan: 'starter' })).status).toBe(403)
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('refuses a missing credential, an unverified address and a missing workspace', async () => {
    expect((await mint({ plan: 'starter' }, { origin: 'https://app.aglyn.com' })).status).toBe(401)
    mockVerifyIdToken.mockResolvedValueOnce({ ...STAFF, email_verified: false })
    expect((await mint({ plan: 'starter' })).status).toBe(403)
    expect((await mint({ orgId: '' })).status).toBe(400)
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('a refused bundle answers with its own status and reason', async () => {
    mockMint.mockRejectedValue(new BundleLinkError('Site Care is not sold on Free', 400))
    const response = await mint({ plan: 'free', addons: { siteCare: 1 } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Site Care is not sold on Free' })
  })

  it('anything else is ours, and says so without the detail', async () => {
    mockMint.mockRejectedValue(new Error('firestore down'))
    const response = await mint({ plan: 'starter' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'The bundle link could not be made' })
  })
})

describe('/api/billing/bundle-link: the domain line, read from the record (AGL-3955)', () => {
  it('a member who can see Billing reads the line for their own workspace', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner', email_verified: true })
    const line = { name: 'acme.com', firstYearCents: 1125, renewalCents: 1500, host: 'acme', hostId: 'h1' }
    mockReadDomain.mockResolvedValue({ available: true, domain: line })
    const response = await readLine('orgId=org-1&id=link-1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: true, domain: line })
    expect(mockResolveMembership).toHaveBeenCalledWith('owner', 'org-1')
    expect(mockHasPermission).toHaveBeenCalledWith('org-1', { role: 'owner' }, 'billing.view')
    expect(mockReadDomain).toHaveBeenCalledWith('org-1', 'link-1')
  })

  it('reads against the workspace the member belongs to, not the one the URL names', async () => {
    mockResolveMembership.mockResolvedValue({ orgId: 'org-mine', member: { role: 'owner' } })
    await readLine('orgId=org-theirs&id=link-1')
    expect(mockReadDomain).toHaveBeenCalledWith('org-mine', 'link-1')
  })

  it('a member without billing.view, or without a workspace, reads nothing', async () => {
    mockHasPermission.mockResolvedValue(false)
    expect((await readLine('orgId=org-1&id=link-1')).status).toBe(403)
    mockResolveMembership.mockResolvedValue(null)
    expect((await readLine('orgId=org-1&id=link-1')).status).toBe(403)
    expect(mockReadDomain).not.toHaveBeenCalled()
  })

  it('refuses a missing credential and a missing link id', async () => {
    expect((await readLine('orgId=org-1&id=link-1', {})).status).toBe(401)
    expect((await readLine('orgId=org-1')).status).toBe(400)
    expect(mockReadDomain).not.toHaveBeenCalled()
  })
})
