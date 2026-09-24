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
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/server'
import {
  hashMemberPassword,
  memberCookieName,
  mintMemberSession,
  readActiveMemberSession,
  verifyMemberPassword,
  verifyPasswordResetToken,
} from './membership'
import { membershipAdminPasswordHandler } from './membership-admin-password'
import { membershipAdminRemoveHandler } from './membership-admin-remove'

const HOST_ID = 'host-1'
const MEMBER_ID = 'member-1'
const ADMIN_UID = 'admin-uid'

const mockHostFields: Record<string, unknown> = {}
const mockMemberFields: Record<string, unknown> = {}
let mockMemberExists = true
/** The member is removed the moment the handler has read them — the race. */
let mockMemberVanishesAfterRead = false
/** Profile updates, as committed. */
const mockMemberUpdates: Array<Record<string, unknown>> = []
/**
 * The member's credential document (AGL-3308): `null` when there is none,
 * which is every member until the migration moves the legacy hash.
 */
let mockCredentialFields: Record<string, unknown> | null = null
/** Credential-document writes, as committed. */
const mockCredentialSets: Array<Record<string, unknown>> = []
let mockDecodedToken: Record<string, unknown> = {}

let mockThrottleAllows = true
const mockMetered: Array<[string, number, string]> = []
jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's own sending identity, which every tenant send now resolves.
   *
   * A VERIFIED one, because these specs are about the mail their subject
   * sends rather than about the identity boundary — a refusing stub would
   * turn each of them into an assertion that no mail was sent, which is not
   * what any of them was written to check. The boundary itself is proved in
   * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
   * `email-audience-coverage.spec.ts`.
   *
   * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
   * address in this file cannot accidentally pass against a platform
   * fallback.
   */
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
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
            collection: (name: string) => ({
              doc: (id: string) =>
                name === 'siteMemberCredentials'
                  ? {
                      kind: 'credential',
                      id,
                      get: async () => ({
                        id,
                        exists: mockCredentialFields !== null,
                        get: (field: string) => mockCredentialFields?.[field],
                      }),
                    }
                  : {
                      kind: 'member',
                      id,
                      get: async () => {
                        const snapshot = {
                          id,
                          exists: mockMemberExists,
                          get: (field: string) => mockMemberFields[field],
                        }
                        if (mockMemberVanishesAfterRead) mockMemberExists = false
                        return snapshot
                      },
                    },
            }),
          }),
        }),
        /*
         * A batch applies its writes only on commit, and a profile update of
         * a member who is gone rejects the whole batch — the Firestore
         * behaviour the password set relies on to write no orphan credential.
         */
        batch: () => {
          const writes: Array<() => void> = []
          let refused = false
          return {
            set: (ref: { kind: string }, data: Record<string, unknown>) => {
              if (ref.kind !== 'credential') throw new Error('unexpected set')
              writes.push(() => {
                mockCredentialSets.push(data)
                mockCredentialFields = { ...(mockCredentialFields ?? {}), ...data }
              })
            },
            update: (ref: { kind: string }, data: Record<string, unknown>) => {
              if (ref.kind !== 'member') throw new Error('unexpected update')
              if (!mockMemberExists) refused = true
              writes.push(() => {
                mockMemberUpdates.push(data)
                for (const [field, value] of Object.entries(data)) {
                  if (value === 'field-deleted') delete mockMemberFields[field]
                  else mockMemberFields[field] = value
                }
              })
            },
            delete: () => {
              throw new Error('unexpected delete')
            },
            commit: async () => {
              if (refused) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
              for (const write of writes) write()
            },
          }
        },
      }),
    }),
    firestore: { FieldValue: { delete: () => 'field-deleted' } },
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
  mockCredentialSets.length = 0
  mockCredentialFields = null
  mockMemberExists = true
  mockMemberVanishesAfterRead = false
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
    expect(mockCredentialSets).toHaveLength(0)
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
    expect(mockCredentialSets).toHaveLength(0)
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
    // On the credential document (AGL-3308), never the profile the console
    // lists — and the legacy copy leaves the profile in the same batch.
    expect(mockCredentialSets).toHaveLength(1)
    const written = mockCredentialSets[0]
    expect(verifyMemberPassword(password, written['passwordScrypt'] as string)).toBe(
      true,
    )
    expect(mockMemberUpdates).toHaveLength(1)
    expect(mockMemberUpdates[0]).toMatchObject({
      passwordScrypt: 'field-deleted',
      passwordResetAt: 'field-deleted',
    })
    expect(mockMemberFields).not.toHaveProperty('passwordScrypt')
    expect(JSON.stringify([written, mockMemberUpdates[0]])).not.toContain(password)
  })

  it('writes no credential for a member removed since the read', async () => {
    // The profile update rejects on a missing member and takes the credential
    // write in its batch with it, so a removal racing a password set cannot
    // leave a hash behind for an account that is gone.
    mockMemberVanishesAfterRead = true
    // The handler logs the refused commit; keep the run quiet.
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
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
    expect(result.status).toBe(500)
    expect(mockCredentialSets).toHaveLength(0)
    quiet.mockRestore()
  })

  it('refuses a member id that names a nested path', async () => {
    const { res, result } = makeResponse()
    await membershipAdminPasswordHandler(
      makeRequest({
        hostId: HOST_ID,
        memberId: 'member-1/nested/doc',
        action: 'setPassword',
        password: 'correct-horse-battery',
      }),
      res,
    )
    expect(result.status).toBe(400)
    expect(mockCredentialSets).toHaveLength(0)
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
    expect(mockCredentialSets).toHaveLength(0)
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
  it('is served by the console, where the drawer and the Inbox post', async () => {
    // The console posts to a literal '/api/membership/admin-password' (and
    // '/api/membership/admin-remove'), and the console's dispatcher loads
    // ONLY the `consoleApi` surface. Registered on the tenant surface, these
    // were a 404 on every console that asked — which the drawer reported as
    // a generic failure.
    // `resolvePluginApiRoute` is imported statically at the top of the file
    // ON PURPOSE (AGL-949): a dynamic import here made plugins-commerce ->
    // aglyn a DYNAMIC edge in the nx graph, and enforce-module-boundaries
    // walks dynamic edges transitively — console -> plugins-commerce ->
    // aglyn meant every static `@aglyn/aglyn` import in the console app was
    // reported as "a static import of a lazy-loaded library". One await in
    // one spec file cost the console 100 lint errors.
    const { registerCommerceApi, registerCommerceConsoleApi } = await import(
      '../server'
    )
    unregisterPluginApiRoute('membership/admin-password')
    unregisterPluginApiRoute('membership/admin-remove')
    // The published site's surface serves neither: they are console routes.
    registerCommerceApi()
    expect(resolvePluginApiRoute('membership/admin-password')).toBeUndefined()
    expect(resolvePluginApiRoute('membership/admin-remove')).toBeUndefined()
    registerCommerceConsoleApi()
    expect(resolvePluginApiRoute('membership/admin-password')).toBe(
      membershipAdminPasswordHandler,
    )
    expect(resolvePluginApiRoute('membership/admin-remove')).toBe(
      membershipAdminRemoveHandler,
    )
  })
})

describe('the credential document is the hash a mailed reset binds to (AGL-3308)', () => {
  it('binds the link to the credential document once the hash has moved', async () => {
    const moved = hashMemberPassword('the moved password')
    mockCredentialFields = { passwordScrypt: moved }
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
    const sent = (sendEmailMock.mock.calls[0] as any[])[0]
    const token = decodeURIComponent(String(sent.text).match(/token=([^\s]+)/)![1])
    expect(verifyPasswordResetToken(HOST_ID, token, moved)).toBe(true)
    // Not to the stale copy still on the profile.
    expect(
      verifyPasswordResetToken(HOST_ID, token, mockMemberFields['passwordScrypt'] as string),
    ).toBe(false)
  })

  it('binds it to the legacy copy for a member the migration has not reached', async () => {
    const legacy = hashMemberPassword('the legacy password')
    mockMemberFields['passwordScrypt'] = legacy
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
    const token = decodeURIComponent(String(sent.text).match(/token=([^\s]+)/)![1])
    expect(verifyPasswordResetToken(HOST_ID, token, legacy)).toBe(true)
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
