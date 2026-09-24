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
 * Removing a site member from the console takes their password hash with
 * them (AGL-3308).
 *
 * The hash lives in `siteMemberCredentials`, which no client can reach, so a
 * removal the browser made would strand it. The route deletes the profile and
 * the credential document in ONE batch — asserted as one commit, because two
 * sequential deletes could land the first and fail the second — and admits
 * exactly the roles the rules let delete a profile before it.
 *
 * `node`, like the admin password spec: a server handler with no DOM.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const HOST_ID = 'host-1'
const MEMBER_ID = 'member-1'
const CALLER = 'caller-uid'

let mockDecodedToken: Record<string, unknown> = {}
let mockHostExists = true
const mockHostFields: Record<string, unknown> = {}
/** Each commit's deletes, as one entry per batch. */
const mockCommits: string[][] = []
let mockCommitFails = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    Boolean(decoded['impersonatedBy']),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockHostExists,
              get: (field: string) => mockHostFields[field],
            }),
            collection: (name: string) => ({
              doc: (id: string) => ({ path: `${name}/${id}` }),
            }),
          }),
        }),
        batch: () => {
          const deletes: string[] = []
          return {
            delete: (ref: { path: string }) => {
              deletes.push(ref.path)
            },
            commit: async () => {
              if (mockCommitFails) throw new Error('UNAVAILABLE')
              mockCommits.push(deletes)
            },
          }
        },
      }),
    }),
  },
}))

import { membershipAdminRemoveHandler } from './membership-admin-remove'

function makeRequest(
  body: Record<string, unknown>,
  overrides: Partial<PluginApiRequest> = {},
): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body,
    headers: { authorization: 'Bearer console-id-token' },
    cookies: {},
    socket: {},
    ...overrides,
  } as PluginApiRequest
}

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  }
  return { res, result }
}

const remove = async (
  body: Record<string, unknown> = { hostId: HOST_ID, memberId: MEMBER_ID },
  overrides: Partial<PluginApiRequest> = {},
) => {
  const { res, result } = makeResponse()
  await membershipAdminRemoveHandler(makeRequest(body, overrides), res)
  return result
}

beforeEach(() => {
  mockDecodedToken = { uid: CALLER, email_verified: true }
  mockHostExists = true
  for (const key of Object.keys(mockHostFields)) delete mockHostFields[key]
  mockHostFields['memberRoles'] = { [CALLER]: 'editor' }
  mockCommits.length = 0
  mockCommitFails = false
})

describe('membershipAdminRemoveHandler (AGL-3308)', () => {
  it('deletes the profile and the credential document in one commit', async () => {
    const result = await remove()
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(mockCommits).toEqual([
      ['siteMembers/member-1', 'siteMemberCredentials/member-1'],
    ])
  })

  it('admits every role the rules let delete a profile: admin, editor and author', async () => {
    for (const role of ['admin', 'editor', 'author']) {
      mockCommits.length = 0
      mockHostFields['memberRoles'] = { [CALLER]: role }
      expect([role, (await remove()).status]).toEqual([role, 200])
      expect(mockCommits).toHaveLength(1)
    }
  })

  it('refuses a viewer, a stranger and an unknown site, deleting nothing', async () => {
    mockHostFields['memberRoles'] = { [CALLER]: 'viewer' }
    expect((await remove()).status).toBe(403)
    mockHostFields['memberRoles'] = { someone_else: 'admin' }
    expect((await remove()).status).toBe(403)
    mockHostFields['memberRoles'] = { [CALLER]: 'admin' }
    mockHostExists = false
    expect((await remove()).status).toBe(403)
    expect(mockCommits).toHaveLength(0)
  })

  it('refuses an account that has not verified its address', async () => {
    mockDecodedToken = { uid: CALLER, email_verified: false }
    const result = await remove()
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ reason: 'email-unverified' })
    expect(mockCommits).toHaveLength(0)
  })

  it('admits staff impersonating an unverified site editor', async () => {
    mockDecodedToken = {
      uid: CALLER,
      email_verified: false,
      impersonatedBy: 'staff-uid',
    }
    expect((await remove()).status).toBe(200)
  })

  it('refuses a request with no console token', async () => {
    const result = await remove(undefined, { headers: {} })
    expect(result.status).toBe(401)
    expect(mockCommits).toHaveLength(0)
  })

  it('refuses anything but POST', async () => {
    expect((await remove(undefined, { method: 'GET' })).status).toBe(405)
  })

  it('refuses a missing id, and an id that names a nested path', async () => {
    expect((await remove({ hostId: HOST_ID })).status).toBe(400)
    expect((await remove({ memberId: MEMBER_ID })).status).toBe(400)
    expect(
      (await remove({ hostId: HOST_ID, memberId: 'member-1/nested/doc' })).status,
    ).toBe(400)
    expect(mockCommits).toHaveLength(0)
  })

  it('reports a failed commit, which deleted neither document', async () => {
    mockCommitFails = true
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await remove()
    quiet.mockRestore()
    expect(result.status).toBe(500)
    expect(mockCommits).toHaveLength(0)
  })
})
