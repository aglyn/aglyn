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
 *
 * @jest-environment node
 */

/**
 * The closure notices route (AGL-4038): the workspace's owner hears what
 * deleting it changes, a person hears what closing their own account
 * changes, and nobody else hears either.
 */

import {
  registerClosureNoticeSource,
  type ClosureSubject,
} from '@aglyn/aglyn/plugin-manager/plugin-closure-notices'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

const mockVerifyIdToken = jest.fn()
const mockOrgs: Record<string, Record<string, unknown>> = {
  'org-1': { ownerUid: 'owner-1', name: 'Acme Builders' },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({ exists: Boolean(mockOrgs[id]), get: (field: string) => mockOrgs[id]?.[field] }),
          }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: null,
    headers: Object.fromEntries(request.headers),
  }),
}))

const { GET } = require('./route') as { GET: (request: Request) => Promise<Response> }

const get = (query: string, token: string | null = 'token') =>
  GET(
    new Request(`https://app.aglyn.com/api/closure-notices?${query}`, {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

describe('GET /api/closure-notices', () => {
  const asked: ClosureSubject[] = []
  beforeEach(() => {
    asked.length = 0
    resetPluginServicesForTests()
    registerClosureNoticeSource(
      {
        notices: async (subject) => {
          asked.push(subject)
          return [
            {
              id: 'orders',
              severity: 'warning',
              title: 'One order will be canceled and refunded',
              body: 'It has not shipped.',
              items: [{ id: 'o1', primary: 'Order HW-1', amount: '$10.00' }],
            },
          ]
        },
      },
      { pluginId: 'shop' },
    )
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1', email_verified: true })
  })

  it('tells the owner what deleting the workspace changes', async () => {
    const response = await get('subject=workspace&orgId=org-1')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.json()
    expect(body.notices).toEqual([expect.objectContaining({ pluginId: 'shop', id: 'orders', severity: 'warning' })])
    expect(body.unavailable).toEqual([])
    expect(asked).toEqual([{ kind: 'workspace', orgId: 'org-1' }])
  })

  it('refuses a member who is not the owner, and answers staff', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin-2', email_verified: true })
    expect((await get('subject=workspace&orgId=org-1')).status).toBe(403)
    expect(asked).toEqual([])
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    expect((await get('subject=workspace&orgId=org-1')).status).toBe(200)
  })

  it('asks about the caller’s own account, never one named in the request', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'person-9', email_verified: true })
    const response = await get('subject=account&uid=someone-else')
    expect(response.status).toBe(200)
    expect(asked).toEqual([{ kind: 'account', uid: 'person-9' }])
  })

  it('refuses no credential, an unverified address, an unknown workspace and an unknown subject', async () => {
    expect((await get('subject=account', null)).status).toBe(401)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'owner-1', email_verified: false })
    expect((await get('subject=account')).status).toBe(403)
    expect((await get('subject=workspace&orgId=org-missing')).status).toBe(404)
    expect((await get('subject=everything')).status).toBe(400)
    expect((await get('subject=workspace')).status).toBe(400)
  })
})
