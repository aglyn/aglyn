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
 * AGL-3330: `/api/forms/stats` recounts the forms a site member names, and
 * writes nothing the caller sent.
 */

const mockRecounts: Array<{ hostId: string; formId: string }> = []
let mockMemberRoles: Record<string, string> = { 'uid-1': 'viewer' }
let mockDecoded: Record<string, unknown> = { uid: 'uid-1', email_verified: true }

jest.mock('./server/form-stats', () => ({
  FORM_STATS_RECOUNT_MAX: 20,
  recountFormStats: async (options: { hostId: string; formId: string }) => {
    mockRecounts.push({ hostId: options.hostId, formId: options.formId })
    return options.formId === 'gone'
      ? null
      : {
          recounted: { submissions: 2, leads: 0, lastSubmissionAtMs: 5 },
          drift: ['leads'],
          written: true,
        }
  },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token === 'bad') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
          return mockDecoded
        },
      }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: id === 'host-1',
              get: (field: string) => (field === 'memberRoles' ? mockMemberRoles : undefined),
            }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('@aglyn/aglyn/server', () => ({ registerPluginApiRoute: jest.fn() }))

import { formStatsHandler } from './server'

function call(body: unknown, token: string | null = 'good') {
  let status = 0
  let json: any = null
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      json = value
      return res
    },
  }
  return Promise.resolve(formStatsHandler(
    {
      method: 'POST',
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )).then(() => ({ status, json }))
}

beforeEach(() => {
  mockRecounts.length = 0
  mockMemberRoles = { 'uid-1': 'viewer' }
  mockDecoded = { uid: 'uid-1', email_verified: true }
})

describe('POST /api/forms/stats (AGL-3330)', () => {
  it('recounts each named form for a member of the site, whatever their role', async () => {
    const { status, json } = await call({ hostId: 'host-1', formIds: ['f1', 'f1', 'gone'] })
    expect(status).toBe(200)
    expect(mockRecounts).toEqual([
      { hostId: 'host-1', formId: 'f1' },
      { hostId: 'host-1', formId: 'gone' },
    ])
    expect(json.recounts).toEqual({
      f1: { recounted: { submissions: 2, leads: 0, lastSubmissionAtMs: 5 }, drift: ['leads'], written: true },
      gone: null,
    })
  })

  it('refuses a stranger, a missing token, a refused token and an unknown site', async () => {
    mockMemberRoles = {}
    expect((await call({ hostId: 'host-1', formIds: ['f1'] })).status).toBe(403)
    expect((await call({ hostId: 'host-1', formIds: ['f1'] }, null)).status).toBe(401)
    expect((await call({ hostId: 'host-1', formIds: ['f1'] }, 'bad')).status).toBe(401)
    mockMemberRoles = { 'uid-1': 'owner' }
    expect((await call({ hostId: 'nope', formIds: ['f1'] })).status).toBe(404)
    expect(mockRecounts).toEqual([])
  })

  it('refuses an unverified address, and a request with nothing or too much to count', async () => {
    mockDecoded = { uid: 'uid-1', email_verified: false }
    expect((await call({ hostId: 'host-1', formIds: ['f1'] })).status).toBe(403)
    expect((await call({ hostId: 'host-1', formIds: [] })).status).toBe(400)
    const many = Array.from({ length: 21 }, (_, index) => `f${index}`)
    expect((await call({ hostId: 'host-1', formIds: many })).status).toBe(400)
    expect(mockRecounts).toEqual([])
  })
})
