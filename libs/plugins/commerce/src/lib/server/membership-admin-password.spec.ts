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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import {
  memberCookieName,
  mintMemberSession,
  readActiveMemberSession,
  verifyMemberPassword,
} from './membership'
import { membershipAdminPasswordHandler } from './membership-admin-password'

const HOST_ID = 'host-1'
const MEMBER_ID = 'member-1'
const ADMIN_UID = 'admin-uid'

const mockHostFields: Record<string, unknown> = {}
const mockMemberFields: Record<string, unknown> = {}
let mockMemberExists = true
const mockMemberUpdates: Array<Record<string, unknown>> = []
let mockDecodedToken: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => mockDecodedToken,
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) => mockHostFields[field],
              data: () => mockHostFields,
            }),
            collection: () => ({
              doc: () => ({
                get: async () => ({
                  exists: mockMemberExists,
                  get: (field: string) => mockMemberFields[field],
                }),
                update: async (data: Record<string, unknown>) => {
                  mockMemberUpdates.push(data)
                  Object.assign(mockMemberFields, data)
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

let mockManageMembers = false
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    permissions: { manageMembers: mockManageMembers },
  }),
}))

const sendEmailMock = jest.fn(async () => ({ sent: true, id: 'mail-1' }))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
  sendEmail: (...args: unknown[]) => (sendEmailMock as any)(...args),
}))

function makeRequest(body: Record<string, unknown>): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body,
    headers: { authorization: 'Bearer console-id-token' },
    cookies: {},
    socket: {},
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

beforeEach(() => {
  jest.clearAllMocks()
  mockMemberUpdates.length = 0
  mockMemberExists = true
  mockDecodedToken = { uid: ADMIN_UID, email_verified: true }
  mockManageMembers = false
  for (const key of Object.keys(mockHostFields)) delete mockHostFields[key]
  for (const key of Object.keys(mockMemberFields)) delete mockMemberFields[key]
  Object.assign(mockHostFields, {
    subdomain: 'demo',
    displayName: 'Demo Site',
    memberRoles: { [ADMIN_UID]: 'admin' },
  })
  Object.assign(mockMemberFields, {
    email: 'visitor@example.com',
    passwordScrypt: 'salt:hash',
  })
})

describe('membershipAdminPasswordHandler', () => {
  it('refuses a caller who is neither a site admin nor an org manager', async () => {
    mockHostFields['memberRoles'] = { someone_else: 'admin' }
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'setPassword',
        password: 'a-long-enough-password',
      }),
      res,
    )
    expect(result.status).toBe(403)
    expect(mockMemberUpdates).toHaveLength(0)
  })

  it('accepts an org manager who is not on the site roster', async () => {
    mockHostFields['memberRoles'] = {}
    mockManageMembers = true
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'sendPasswordReset',
      }),
      res,
    )
    expect(result.status).toBe(200)
  })

  it('rejects a password below the shared minimum without writing', async () => {
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'setPassword',
        password: 'short',
      }),
      res,
    )
    expect(result.status).toBe(400)
    expect(mockMemberUpdates).toHaveLength(0)
  })

  it('stores a verifiable hash and never the plaintext', async () => {
    const password = 'correct-horse-battery'
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'setPassword',
        password,
      }),
      res,
    )
    expect(result.status).toBe(200)
    expect(mockMemberUpdates).toHaveLength(1)
    const written = mockMemberUpdates[0]
    expect(verifyMemberPassword(password, written['passwordScrypt'] as string)).toBe(
      true,
    )
    expect(JSON.stringify(written)).not.toContain(password)
  })

  it('stamps a session cut-off so existing cookies stop working', async () => {
    const before = Date.now()
    const { res } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'setPassword',
        password: 'correct-horse-battery',
      }),
      res,
    )
    expect(
      Number(mockMemberUpdates[0]['sessionsValidFromMs']),
    ).toBeGreaterThanOrEqual(before)
  })

  it('emails the member that an admin changed their password', async () => {
    const { res } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'setPassword',
        password: 'correct-horse-battery',
      }),
      res,
    )
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const sent = (sendEmailMock.mock.calls[0] as any[])[0]
    expect(sent.to).toBe('visitor@example.com')
    expect(sent.text).not.toContain('correct-horse-battery')
  })

  it('mails a one-hour reset link without touching the password', async () => {
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'sendPasswordReset',
      }),
      res,
    )
    expect(result.status).toBe(200)
    expect(mockMemberUpdates).toHaveLength(0)
    const sent = (sendEmailMock.mock.calls[0] as any[])[0]
    expect(sent.text).toContain('https://demo.aglyn.app/recover?token=')
  })

  it('uses the custom domain for the reset link when the site has one', async () => {
    mockHostFields['cname'] = 'shop.example.com'
    const { res } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'sendPasswordReset',
      }),
      res,
    )
    const sent = (sendEmailMock.mock.calls[0] as any[])[0]
    expect(sent.text).toContain('https://shop.example.com/recover?token=')
  })
})

describe('route registration', () => {
  it('is reachable at membership/admin-password', async () => {
    // The console posts to a literal '/api/membership/admin-password', which
    // only resolves if registerCommerceApi wired this exact path — a typo
    // there is a 404 the UI reports as a generic failure.
    const { resolvePluginApiRoute } = await import('@aglyn/aglyn/server')
    const { registerCommerceApi } = await import('../server')
    registerCommerceApi()
    expect(resolvePluginApiRoute('membership/admin-password')).toBe(
      membershipAdminPasswordHandler,
    )
  })
})

describe('readActiveMemberSession session cut-off', () => {
  const sessionRequest = (): PluginApiRequest =>
    ({
      method: 'GET',
      query: {},
      headers: {},
      cookies: {
        [memberCookieName(HOST_ID)]: mintMemberSession(HOST_ID, MEMBER_ID),
      },
      socket: {},
    }) as PluginApiRequest

  it('keeps a session minted after the cut-off', async () => {
    mockMemberFields['sessionsValidFromMs'] = Date.now() - 60_000
    const session = await readActiveMemberSession(sessionRequest(), HOST_ID)
    expect(session.status).toBe('active')
  })

  it('drops a session minted before the cut-off', async () => {
    const request = sessionRequest()
    // Stamp the cut-off AFTER minting, exactly as an admin password set does.
    mockMemberFields['sessionsValidFromMs'] = Date.now() + 60_000
    const session = await readActiveMemberSession(request, HOST_ID)
    expect(session.status).toBe('anonymous')
  })

  it('leaves members with no cut-off signed in', async () => {
    delete mockMemberFields['sessionsValidFromMs']
    const session = await readActiveMemberSession(sessionRequest(), HOST_ID)
    expect(session.status).toBe('active')
  })
})
