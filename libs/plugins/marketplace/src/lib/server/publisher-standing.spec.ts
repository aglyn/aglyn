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
 * The answer a publish form cannot work out for itself (AGL-4049): whether this
 * workspace sells as the platform. A member asks about their own workspace;
 * nothing else comes out of it.
 */

const mockMembership: { orgId: string | null } = { orgId: 'org-1' }
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ orgId: mockMembership.orgId, permissions: {} }),
}))

const mockPublisher: { current: Record<string, unknown> | null } = { current: null }
jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => mockPublisher.current,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'member-1' }) }),
      firestore: () => ({}),
    }),
  },
}))

import { publisherStandingHandler } from './publisher-standing'

async function ask(over: Record<string, unknown> = {}) {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  await publisherStandingHandler(
    {
      method: 'GET',
      query: { orgId: 'org-1' },
      headers: { authorization: 'Bearer token' },
      ...over,
    } as any,
    res,
  )
  return res
}

beforeEach(() => {
  mockMembership.orgId = 'org-1'
  mockPublisher.current = { orgId: 'org-1', handle: 'someone' }
})

describe('publisher standing', () => {
  it('says true for the platform org at the waiver', async () => {
    mockPublisher.current = { orgId: 'org-1', handle: 'aglyn', sellsAsPlatform: true }
    expect((await ask()).body).toEqual({ sellsAsPlatform: true })
  })

  it('says false for every other publisher, and for an org that is none', async () => {
    expect((await ask()).body).toEqual({ sellsAsPlatform: false })
    mockPublisher.current = null
    expect((await ask()).body).toEqual({ sellsAsPlatform: false })
  })

  it('answers members only, signed in, by GET, about a named org', async () => {
    expect((await ask({ method: 'POST' })).statusCode).toBe(405)
    expect((await ask({ query: {} })).statusCode).toBe(400)
    expect((await ask({ headers: {} })).statusCode).toBe(401)
    mockMembership.orgId = null
    expect((await ask()).statusCode).toBe(403)
  })
})
