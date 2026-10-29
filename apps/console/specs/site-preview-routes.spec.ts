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
 * The console's two Preview doors (AGL-4086).
 *
 * `/api/hosts/preview` is the switch: a site admin (or staff) puts a site in
 * preview or makes it public, every cached page is dropped both ways, and
 * `site_published` is reported once — the first time a site born in preview
 * goes public, never for a site that was public before.
 *
 * `/api/site-preview/link` mints the enter link for the site's team or staff,
 * on the site's own public origin, with a return path that stays on it. The
 * blob it carries is verified here with the real verifier.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'site-preview-routes-spec-secret'

type Row = Record<string, unknown>

let mockClaims: Row = { uid: 'uid-admin', email_verified: true }
let mockHost: Row | null = null
let mockMember: Row | null = null
const mockUpdates: Row[] = []
const mockRevalidate = jest.fn(async () => ({ reason: 'ok' }))
const mockSitePublished = jest.fn(async () => ({ sent: true }))

function mockSnapshot(id: string, data: Row | null) {
  return {
    id,
    exists: data !== null,
    data: () => data ?? undefined,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockClaims }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => mockSnapshot(id, name === 'hosts' ? mockHost : {}),
            update: async (data: Row) => {
              mockUpdates.push(data)
            },
            collection: () => ({
              doc: (uid: string) => ({ get: async () => mockSnapshot(uid, mockMember) }),
            }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  getLockdownVerdict: async () => null,
  lockdownJsonResponse: () => Response.json({ error: 'locked' }, { status: 423 }),
}))
jest.mock('@aglyn/tenant-data-admin/server/ga4-measurement-protocol', () => ({
  sendGa4SitePublished: (...args: unknown[]) => mockSitePublished(...(args as [])),
}))
jest.mock('../utils/server/tenant-revalidate', () => ({
  revalidateEntireHost: (...args: unknown[]) => mockRevalidate(...(args as [])),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '<delete>' },
}))

import { verifySitePreviewToken } from '@aglyn/tenant-data-admin/server/site-preview-token'

const { POST: previewSwitch } = require('../app/api/hosts/preview/route') as {
  POST: (request: Request) => Promise<Response>
}
const { POST: previewLink } = require('../app/api/site-preview/link/route') as {
  POST: (request: Request) => Promise<Response>
}

const post = (handler: (request: Request) => Promise<Response>, body: Row) =>
  handler(
    new Request('https://app.aglyn.com/api/x', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const SITE = {
  orgId: 'org-1',
  subdomain: 'acme',
  memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor' },
  screens: { home: '/' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdates.length = 0
  mockClaims = { uid: 'uid-admin', email_verified: true }
  mockHost = { ...SITE }
  mockMember = null
})

describe('/api/hosts/preview — the switch (AGL-4086)', () => {
  it('puts a public site in preview, stamps that it has been public, and drops every page', async () => {
    const response = await post(previewSwitch, { hostId: 'host-1', preview: true })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ preview: true, dropped: true })
    expect(mockUpdates).toEqual([{ preview: true, publicSinceMs: expect.any(Number) }])
    expect(mockRevalidate).toHaveBeenCalledWith(expect.anything(), 'host-1')
    expect(mockSitePublished).not.toHaveBeenCalled()
  })

  it('makes a site born in preview public, and reports site_published once', async () => {
    mockHost = { ...SITE, preview: true }
    const response = await post(previewSwitch, { hostId: 'host-1', preview: false })
    await expect(response.json()).resolves.toEqual({ preview: false, dropped: true })
    expect(mockUpdates).toEqual([{ preview: '<delete>', publicSinceMs: expect.any(Number) }])
    expect(mockRevalidate).toHaveBeenCalledTimes(1)
    expect(mockSitePublished).toHaveBeenCalledWith({ hostId: 'host-1', firstPublish: true })
  })

  it('reports nothing for a site that was public before', async () => {
    mockHost = { ...SITE, preview: true, publicSinceMs: 1 }
    await post(previewSwitch, { hostId: 'host-1', preview: false })
    expect(mockUpdates).toEqual([{ preview: '<delete>' }])
    expect(mockSitePublished).not.toHaveBeenCalled()
  })

  it('takes the native toggle’s string form', async () => {
    const response = await post(previewSwitch, { hostId: 'host-1', preview: 'true' })
    await expect(response.json()).resolves.toMatchObject({ preview: true })
  })

  it('refuses anyone who is not a site admin, and writes nothing', async () => {
    mockClaims = { uid: 'uid-editor', email_verified: true }
    const response = await post(previewSwitch, { hostId: 'host-1', preview: true })
    expect(response.status).toBe(403)
    expect(mockUpdates).toEqual([])
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('lets staff flip it', async () => {
    mockClaims = { uid: 'uid-staff', email_verified: true, staff: true }
    const response = await post(previewSwitch, { hostId: 'host-1', preview: true })
    expect(response.status).toBe(200)
  })

  it('writes nothing when nothing would change', async () => {
    mockHost = { ...SITE, preview: true }
    await post(previewSwitch, { hostId: 'host-1', preview: true })
    expect(mockUpdates).toEqual([])
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('refuses a body that does not say which', async () => {
    expect((await post(previewSwitch, { hostId: 'host-1' })).status).toBe(400)
    expect((await post(previewSwitch, { hostId: 'host-1', preview: 'maybe' })).status).toBe(400)
  })
})

describe('/api/site-preview/link — the enter link (AGL-4086)', () => {
  const linkOf = async (body: Row) => {
    const response = await post(previewLink, body)
    return { response, payload: (await response.json()) as { url?: string; error?: string } }
  }

  it('mints a link on the site’s own domain, bound to the site, for its team', async () => {
    mockHost = { ...SITE, cname: 'acme.example' }
    const { response, payload } = await linkOf({ hostId: 'host-1', path: '/menu' })
    expect(response.status).toBe(200)
    const url = new URL(payload.url as string)
    expect(url.origin).toBe('https://acme.example')
    expect(url.pathname).toBe('/api/site-preview/enter')
    expect(url.searchParams.get('return')).toBe('/menu')
    const blob = url.searchParams.get('blob')
    expect(verifySitePreviewToken('enter', blob, 'host-1')).not.toBeNull()
    expect(verifySitePreviewToken('enter', blob, 'host-2')).toBeNull()
  })

  it('keeps the return path on the site', async () => {
    const { payload } = await linkOf({ hostId: 'host-1', path: 'https://evil.example/' })
    expect(new URL(payload.url as string).searchParams.get('return')).toBe('/')
  })

  it('refuses someone who is not on the site’s team', async () => {
    mockClaims = { uid: 'uid-stranger', email_verified: true }
    const { response } = await linkOf({ hostId: 'host-1' })
    expect(response.status).toBe(403)
  })

  it('mints one for staff, by the claim on the verified token', async () => {
    mockClaims = { uid: 'uid-staff', email_verified: true, staff: true }
    const { response, payload } = await linkOf({ hostId: 'host-1' })
    expect(response.status).toBe(200)
    expect(new URL(payload.url as string).origin).toBe('https://acme.aglyn.app')
  })
})
