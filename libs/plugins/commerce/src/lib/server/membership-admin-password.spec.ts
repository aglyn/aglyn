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
 * Runs on `node`, not the plugins-commerce project default of `jsdom`
 * (AGL-1333). The `route registration` case below imports the commerce
 * server barrel, which reaches `next/cache` through
 * site-page-resolver -> compose-screen-nodes -> get-components ->
 * @aglyn/tenant-data-admin/render-cache (AGL-1302). Loading `next/cache`
 * evaluates `class NextRequest extends Request`, and jsdom implements no
 * Fetch API, so `Request` is undefined there and the whole file dies at
 * import with `Class extends value undefined` before a single assertion
 * runs. jest.setup.js already records the trap: its fetch polyfill is a
 * no-op inside the jsdom sandbox, so "a spec that can run on `node`
 * already has the real ones".
 *
 * These are server handlers with no DOM in them, so `node` is the honest
 * environment regardless. Keep the pragma inside THIS docblock — jest
 * only parses the first comment in the file, so a pragma placed below the
 * license header is silently ignored.
 */

import {
  type PluginApiRequest,
  type PluginApiResponse,
  resolvePluginApiRoute,
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

let mockThrottleAllows = true
const mockMetered: Array<[string, number, string]> = []
jest.mock('@aglyn/tenant-data-admin', () => ({
  isImpersonationSession: () => false,
  // White-Label Phase 3: the handler resolves the owning org's brand for the
  // sender from-name; a bare stub keeps it on the Aglyn defaults here.
  getOrgForHost: async () => ({ org: {} }),
  consumePasswordResetSend: async () =>
    mockThrottleAllows
      ? { allowed: true, retryAfterSeconds: 0, limited: null, degraded: false }
      : {
          allowed: false,
          retryAfterSeconds: 900,
          limited: 'recipient',
          degraded: false,
        },
  passwordResetThrottleMessage: () => 'Too many reset emails',
  // The cost meter (AGL-1438). Recorded so the assertions below can show that
  // a reset counts toward cost and is still never refused by a quota.
  meterHostEmail: async (hostId: string, count = 1, sendClass = 'transactional') => {
    mockMetered.push([hostId, count, sendClass])
  },
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
  mockMetered.length = 0
  mockMemberUpdates.length = 0
  mockMemberExists = true
  mockDecodedToken = { uid: ADMIN_UID, email_verified: true }
  mockManageMembers = false
  mockThrottleAllows = true
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
    // Cost meter (AGL-1438). Counted once, as TRANSACTIONAL — so it lands on
    // the cost meter and never on the meter `emailSendsPerMonth` refuses.
    // This send is how the member gets back into their account; a quota that
    // could drop it would lock them out with no way to be told why.
    expect(mockMetered).toEqual([[HOST_ID, 1, 'transactional']])
  })

  it('429s without sending once the reset throttle is exhausted (AGL-920)', async () => {
    mockThrottleAllows = false
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'sendPasswordReset',
      }),
      res,
    )
    expect(result.status).toBe(429)
    // The whole point is the mail not going out — a 429 after the send would
    // report a refusal the recipient's inbox has already been spared of.
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('does not throttle setPassword, which is not a send amplifier', async () => {
    mockThrottleAllows = false
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: MEMBER_ID,
        action: 'setPassword',
        password: 'correct-horse-battery',
      }),
      res,
    )
    expect(result.status).toBe(200)
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
    // `resolvePluginApiRoute` is imported statically at the top of the file
    // ON PURPOSE (AGL-949): a dynamic import here made plugins-commerce ->
    // aglyn a DYNAMIC edge in the nx graph, and enforce-module-boundaries
    // walks dynamic edges transitively — console -> plugins-commerce ->
    // aglyn meant every static `@aglyn/aglyn` import in the console app was
    // reported as "a static import of a lazy-loaded library". One await in
    // one spec file cost the console 100 lint errors.
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
