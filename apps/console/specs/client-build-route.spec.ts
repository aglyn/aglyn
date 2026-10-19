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
 * AGL-3958 — `/api/admin/client-build`: only staff read and write a client
 * build, search domains for it and send its preview. What the record holds
 * and what the preview sends are pinned against the library in
 * `libs/tenant/data/admin/src/lib/server/client-build.spec.ts`.
 */

const mockVerifyIdToken = jest.fn()
const mockLoad = jest.fn()
const mockSave = jest.fn()
const mockSend = jest.fn()
const mockRateLimit = jest.fn()
const mockSearch = jest.fn()
let mockSearchRegistered = false
let mockSmsAvailable = false

jest.mock('@aglyn/tenant-data-admin', () => {
  class ClientBuildError extends Error {
    readonly status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  }
  return {
    __esModule: true,
    ClientBuildError,
    consumeRateLimit: (...args: unknown[]) => mockRateLimit(...args),
    emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
    isImpersonationSession: () => false,
    loadClientBuild: (...args: unknown[]) => mockLoad(...args),
    saveClientBuild: (...args: unknown[]) => mockSave(...args),
    sendClientBuildPreview: (...args: unknown[]) => mockSend(...args),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      }),
    },
  }
})
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers.entries()),
  }),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-domain-search', () => ({
  __esModule: true,
  domainSearchRegistered: () => mockSearchRegistered,
  searchDomains: (...args: unknown[]) => mockSearch(...args),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-sms-messaging', () => ({
  __esModule: true,
  pluginSmsAvailable: () => mockSmsAvailable,
}))
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
}))

import { ClientBuildError } from '@aglyn/tenant-data-admin'
import { POST } from '../app/api/admin/client-build/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/admin/client-build', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchRegistered = false
  mockSmsAvailable = false
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
  mockRateLimit.mockResolvedValue({ allowed: true })
  mockLoad.mockResolvedValue(null)
  mockSave.mockImplementation(async ({ patch }) => ({ saved: patch }))
  mockSend.mockResolvedValue({ emailed: true, text: 'sent', previewUrl: 'https://h.example', siteAddress: null })
})

describe('the client build route (AGL-3958)', () => {
  it('is staff only, for every action', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner', email_verified: true })
    for (const action of ['get', 'save', 'search-domains', 'send-preview']) {
      expect((await post({ action, query: 'harbor' })).status).toBe(403)
    }
    expect(mockLoad).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockSearch).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reads the record with what the deployment can do for it', async () => {
    mockSearchRegistered = true
    const response = await post({ action: 'get' })
    expect(await response.json()).toEqual({
      record: null,
      capabilities: { domainSearch: true, text: false, email: true },
    })
    expect(mockLoad).toHaveBeenCalledWith('org-1')
  })

  it('saves only the parts the body carries, and never an intent', async () => {
    const response = await post({ action: 'save', domain: { choice: 'free' }, intent: { plan: 'agency' } })
    expect(response.status).toBe(200)
    expect(mockSave).toHaveBeenCalledWith({
      orgId: 'org-1',
      actorUid: 'staff-1',
      patch: { domain: { choice: 'free' } },
    })
  })

  it('answers a refused save with its own status and reason', async () => {
    mockSave.mockRejectedValue(new ClientBuildError('That site is not in this workspace', 400))
    const response = await post({ action: 'save', hostId: 'other' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'That site is not in this workspace' })
  })

  describe('searching domains', () => {
    it('searches through the slot, throttled per staff member', async () => {
      mockSearch.mockResolvedValue({
        status: 'ok',
        results: [{ name: 'harbor.com', available: true, firstYearUsd: 11, renewalUsd: 18 }],
      })
      const response = await post({ action: 'search-domains', query: ' Harbor ' })
      expect(await response.json()).toEqual({
        results: [{ name: 'harbor.com', available: true, firstYearUsd: 11, renewalUsd: 18 }],
      })
      expect(mockSearch).toHaveBeenCalledWith('harbor')
      expect(mockRateLimit).toHaveBeenCalledWith('client-build-domain-search:staff-1', expect.any(Object))
    })

    it('says so when no registrar is set up here, so the screen drops the search', async () => {
      mockSearch.mockResolvedValue({ status: 'unavailable' })
      const response = await post({ action: 'search-domains', query: 'harbor' })
      expect(response.status).toBe(501)
      expect(await response.json()).toMatchObject({ unavailable: true })
    })

    it('refuses a query too short to search, and a burst past the limit', async () => {
      expect((await post({ action: 'search-domains', query: 'h' })).status).toBe(400)
      mockRateLimit.mockResolvedValue({ allowed: false })
      expect((await post({ action: 'search-domains', query: 'harbor' })).status).toBe(429)
      expect(mockSearch).not.toHaveBeenCalled()
    })
  })

  describe('sending the preview', () => {
    it('sends it as the staff member, throttled per workspace', async () => {
      const response = await post({ action: 'send-preview' })
      expect(await response.json()).toMatchObject({ emailed: true, text: 'sent' })
      expect(mockSend).toHaveBeenCalledWith({ orgId: 'org-1', actorUid: 'staff-1' })
      expect(mockRateLimit).toHaveBeenCalledWith('client-build-preview:org-1', expect.any(Object))
    })

    it('refuses past the hourly limit, sending nothing', async () => {
      mockRateLimit.mockResolvedValue({ allowed: false })
      expect((await post({ action: 'send-preview' })).status).toBe(429)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('answers a site with nothing published yet with 409', async () => {
      mockSend.mockRejectedValue(new ClientBuildError('The site has no published page yet', 409))
      expect((await post({ action: 'send-preview' })).status).toBe(409)
    })
  })
})
