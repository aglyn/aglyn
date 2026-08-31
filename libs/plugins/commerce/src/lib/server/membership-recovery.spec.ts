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
  hashMemberPassword,
  mintPasswordResetToken,
  passwordResetTokenMemberId,
  verifyMemberPassword,
  verifyPasswordResetToken,
} from './membership'
import { RECOVER_MIN_MEMBER_AGE_MS } from '@aglyn/tenant-data-admin'
import { membershipRecoverHandler } from './membership-recover'
import { membershipResetHandler } from './membership-reset'

// One configurable member + host pair behind chainable stubs, following
// membership-login.spec.ts: the handlers only touch the host doc, the
// email lookup, and the member doc get/set.
const mockHostFields: Record<string, unknown> = {}
const mockMemberFields: Record<string, unknown> = {}
let mockHostExists = true
let mockMemberExists = true
const memberSetCalls: Array<Record<string, unknown>> = []

/**
 * AGL-1966 abuse-control seams.
 *
 * The two throttles are mocked to a default "allow" and driven per test.
 * `membership-recover-throttle.spec.ts` exercises the real caps against a
 * Firestore stand-in; what this file is responsible for is the HANDLER's
 * half — which control runs before which, and which refusal is visible.
 */
const mockConsumeAttempt = jest.fn(async () => ({
  allowed: true,
  retryAfterSeconds: 0,
  limited: null as string | null,
  degraded: false,
  contended: false,
}))
const mockConsumeSend = jest.fn(async () => ({
  allowed: true,
  retryAfterSeconds: 0,
  limited: null as string | null,
  degraded: false,
  contended: false,
}))
const mockIsEmailSuppressed = jest.fn(async () => false)
const mockMeterHostEmail = jest.fn(async () => undefined)

jest.mock('@aglyn/tenant-data-admin', () => ({
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
  // A `jest.mock` factory is a CLOSED WORLD: anything the module under test
  // imports and this object omits arrives as `undefined`. That is not a
  // hypothetical here — `meterHostEmail` was missing from this factory, so
  // every send in this file threw on the metering line into the handler's
  // silent-success catch, and the suite stayed green while asserting nothing
  // about it. `RECOVER_MIN_MEMBER_AGE_MS` would fail the same way but worse:
  // `Date.now() - createdAtMs < undefined` is always false, so the
  // register-then-recover guard would be disabled in every test here and the
  // tests for it would pass by never running it.
  //
  // So the real policy module is spread in rather than restated. Only the
  // things that need a seam are overridden below it.
  ...jest.requireActual(
    '@aglyn/tenant-data-admin/server/membership-recover-throttle',
  ),
  consumeMembershipRecoverAttempt: (...args: unknown[]) =>
    (mockConsumeAttempt as (...a: unknown[]) => unknown)(...args),
  consumeMembershipRecoverSend: (...args: unknown[]) =>
    (mockConsumeSend as (...a: unknown[]) => unknown)(...args),
  isEmailSuppressed: (...args: unknown[]) =>
    (mockIsEmailSuppressed as (...a: unknown[]) => unknown)(...args),
  meterHostEmail: (...args: unknown[]) =>
    (mockMeterHostEmail as (...a: unknown[]) => unknown)(...args),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockHostExists,
              get: (field: string) => mockHostFields[field],
            }),
            collection: () => ({
              where: () => ({
                limit: () => ({
                  get: async () => ({
                    docs: mockMemberExists
                      ? [
                          {
                            id: 'member-1',
                            get: (field: string) => mockMemberFields[field],
                          },
                        ]
                      : [],
                  }),
                }),
              }),
              doc: (memberId: string) => ({
                get: async () => ({
                  exists: mockMemberExists && memberId === 'member-1',
                  get: (field: string) => mockMemberFields[field],
                }),
                set: async (data: Record<string, unknown>) => {
                  memberSetCalls.push(data)
                  // Reflect the write so a reused token sees the NEW hash.
                  if (typeof data['passwordScrypt'] === 'string') {
                    mockMemberFields['passwordScrypt'] =
                      data['passwordScrypt']
                  }
                },
              }),
            }),
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'server-time' } },
  },
  // White-Label Phase 3: the recover handler resolves the owning org's brand
  // for the sender from-name; a bare stub keeps it on the Aglyn defaults here.
  getOrgForHost: async () => ({ org: {} }),
}))

const PASSWORD = 'correct horse battery'
const HOST_ID = 'host-1'

function makeRequest(
  ip: string,
  body: Record<string, unknown>,
): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body,
    // Distinct IPs per test keep the module-level rate limiter quiet.
    headers: { 'x-forwarded-for': ip },
    cookies: {},
    socket: {},
  }
}

function makeResponse() {
  const result = { status: 0, body: undefined as any, headers: {} as any }
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
    setHeader(name, value) {
      result.headers[name] = value
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

const fetchMock = jest.fn(async () => ({ ok: true }) as Response)

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.RESEND_API_KEY = 'resend-test-key'
  process.env.USAGE_EMAIL_FROM = 'Aglyn <noreply@aglyn.app>'
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
  mockHostExists = true
  mockMemberExists = true
  mockHostFields['subdomain'] = 'shop'
  delete mockHostFields['cname']
  mockHostFields['displayName'] = 'Northwind'
  mockMemberFields['passwordScrypt'] = hashMemberPassword(PASSWORD)
  delete mockMemberFields['suspended']
  // Old enough to be a real member, not a register-then-recover row.
  mockMemberFields['createdAt'] = timestamp(Date.now() - 24 * 60 * 60 * 1000)
  memberSetCalls.length = 0
  mockConsumeAttempt.mockClear()
  mockConsumeSend.mockClear()
  mockIsEmailSuppressed.mockClear()
  mockMeterHostEmail.mockClear()
  mockConsumeAttempt.mockImplementation(async () => ALLOWED)
  mockConsumeSend.mockImplementation(async () => ALLOWED)
  mockIsEmailSuppressed.mockImplementation(async () => false)
})

const ALLOWED = {
  allowed: true,
  retryAfterSeconds: 0,
  limited: null as string | null,
  degraded: false,
  contended: false,
}

function refused(limited: string, retryAfterSeconds = 900) {
  return { allowed: false, retryAfterSeconds, limited, degraded: false, contended: false }
}

/** Minimal Firestore `Timestamp` stand-in: the handler only calls `toMillis`. */
function timestamp(atMs: number) {
  return { toMillis: () => atMs }
}

describe('password-reset token (AGL-552)', () => {
  const hash = hashMemberPassword(PASSWORD)

  it('round-trips: minted tokens verify against the same hash', () => {
    const token = mintPasswordResetToken(HOST_ID, 'member-1', hash)
    expect(passwordResetTokenMemberId(HOST_ID, token)).toBe('member-1')
    expect(verifyPasswordResetToken(HOST_ID, token, hash)).toBe(true)
  })

  it('rejects expired tokens', () => {
    const token = mintPasswordResetToken(HOST_ID, 'member-1', hash)
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 2 * 60 * 60 * 1000)
    expect(passwordResetTokenMemberId(HOST_ID, token)).toBeNull()
    expect(verifyPasswordResetToken(HOST_ID, token, hash)).toBe(false)
  })

  it('rejects tampered signatures', () => {
    const token = mintPasswordResetToken(HOST_ID, 'member-1', hash)
    const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    expect(verifyPasswordResetToken(HOST_ID, flipped, hash)).toBe(false)
  })

  it('rejects tokens minted for another host', () => {
    const token = mintPasswordResetToken('host-2', 'member-1', hash)
    expect(passwordResetTokenMemberId(HOST_ID, token)).toBeNull()
    expect(verifyPasswordResetToken(HOST_ID, token, hash)).toBe(false)
  })

  it('stops verifying once the password hash changes (single-use)', () => {
    const token = mintPasswordResetToken(HOST_ID, 'member-1', hash)
    const rotated = hashMemberPassword('brand new password')
    expect(verifyPasswordResetToken(HOST_ID, token, rotated)).toBe(false)
  })
})

describe('membership recover handler (AGL-552)', () => {
  it('emails a single-use link to an existing member', async () => {
    const { res, result } = makeResponse()
    await membershipRecoverHandler(
      makeRequest('10.1.0.1', { hostId: HOST_ID, email: 'user@example.com' }),
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ]
    expect(url).toBe('https://api.resend.com/emails')
    const payload = JSON.parse(init.body)
    expect(payload.to).toEqual(['user@example.com'])
    expect(String(payload.text)).toContain(
      'https://shop.aglyn.app/recover?token=',
    )
    // The mailed token really opens the door for this host + member.
    const token = decodeURIComponent(
      String(payload.text).match(/token=([^\s]+)/)![1],
    )
    expect(
      verifyPasswordResetToken(
        HOST_ID,
        token,
        mockMemberFields['passwordScrypt'] as string,
      ),
    ).toBe(true)
  })

  it('answers ok without sending when the email is not a member', async () => {
    mockMemberExists = false
    const { res, result } = makeResponse()
    await membershipRecoverHandler(
      makeRequest('10.1.0.2', { hostId: HOST_ID, email: 'ghost@example.com' }),
      res,
    )
    // The no-leak contract: byte-identical success either way.
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers ok without sending for suspended members', async () => {
    mockMemberFields['suspended'] = true
    const { res, result } = makeResponse()
    await membershipRecoverHandler(
      makeRequest('10.1.0.3', { hostId: HOST_ID, email: 'user@example.com' }),
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('meters the send (the metering call really runs)', async () => {
    // This assertion is the reason the mock factory stopped being a closed
    // world: `meterHostEmail` was absent from it, so this line threw into the
    // handler's silent catch on every send and nothing noticed.
    const { res } = makeResponse()
    await membershipRecoverHandler(
      makeRequest('10.1.0.9', { hostId: HOST_ID, email: 'user@example.com' }),
      res,
    )
    expect(mockMeterHostEmail).toHaveBeenCalledWith(HOST_ID)
  })

  it('rejects malformed input outright', async () => {
    const { res, result } = makeResponse()
    await membershipRecoverHandler(
      makeRequest('10.1.0.6', { hostId: HOST_ID, email: 'not-an-email' }),
      res,
    )
    expect(result.status).toBe(400)
  })
})

describe('membership recover abuse controls (AGL-1966)', () => {
  describe('the attempt caps', () => {
    it('refuses with 429 and a Retry-After once the cap is spent', async () => {
      mockConsumeAttempt.mockImplementation(async () =>
        refused('recipient', 1800),
      )
      const { res, result } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.0.1', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(result.status).toBe(429)
      expect(result.headers['Retry-After']).toBe('1800')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is consumed BEFORE the member lookup, so it cannot become an oracle', async () => {
      // The whole point of the ordering. If the cap were consumed only on the
      // send path, a 429 would appear exclusively for addresses that really
      // are members — turning the rate limiter into the account-existence
      // probe the endpoint's silent-success contract exists to prevent.
      for (const memberExists of [true, false]) {
        mockConsumeAttempt.mockClear()
        mockMemberExists = memberExists
        const { res } = makeResponse()
        await membershipRecoverHandler(
          makeRequest('10.3.0.2', {
            hostId: HOST_ID,
            email: 'user@example.com',
          }),
          res,
        )
        expect(mockConsumeAttempt).toHaveBeenCalledTimes(1)
      }
    })

    it('refuses a member and a non-member byte-identically', async () => {
      mockConsumeAttempt.mockImplementation(async () => refused('ip', 900))
      const answers: Array<{ status: number; body: unknown }> = []
      for (const memberExists of [true, false]) {
        mockMemberExists = memberExists
        const { res, result } = makeResponse()
        await membershipRecoverHandler(
          makeRequest('10.3.0.3', {
            hostId: HOST_ID,
            email: 'user@example.com',
          }),
          res,
        )
        answers.push({ status: result.status, body: result.body })
      }
      expect(answers[0]).toEqual(answers[1])
    })
  })

  describe('the register-then-recover guard', () => {
    it('sends nothing for a member row created moments ago', async () => {
      mockMemberFields['createdAt'] = timestamp(Date.now() - 1000)
      const { res, result } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.1.1', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ ok: true })
      expect(fetchMock).not.toHaveBeenCalled()
      // Silent-success, so it is indistinguishable from an unknown address.
      expect(mockConsumeSend).not.toHaveBeenCalled()
    })

    it('sends once the row is past the minimum age', async () => {
      mockMemberFields['createdAt'] = timestamp(
        Date.now() - RECOVER_MIN_MEMBER_AGE_MS - 1000,
      )
      const { res, result } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.1.2', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(result.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT refuse a legacy row that has no createdAt', async () => {
      // Rows predating the field must keep working — the guard is about rows
      // created seconds ago, where the field is present by construction.
      delete mockMemberFields['createdAt']
      const { res } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.1.3', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('the platform suppression list', () => {
    it('sends nothing to a suppressed address, silently', async () => {
      mockIsEmailSuppressed.mockImplementation(async () => true)
      const { res, result } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.2.1', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ ok: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('consults the list with the normalized address', async () => {
      const { res } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.2.2', { hostId: HOST_ID, email: '  USER@Example.COM ' }),
        res,
      )
      expect(mockIsEmailSuppressed).toHaveBeenCalledWith('user@example.com')
    })
  })

  describe('the per-site daily send ceiling', () => {
    it('takes the SILENT exit when the site budget is spent', async () => {
      // Never a 429: this branch is reachable only for a real member, so a
      // visible error here would leak exactly what every other exit hides.
      mockConsumeSend.mockImplementation(async () => refused('host', 3600))
      const { res, result } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.3.1', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ ok: true })
      expect(result.headers['Retry-After']).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is keyed on the site being recovered', async () => {
      const { res } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.3.2', { hostId: HOST_ID, email: 'user@example.com' }),
        res,
      )
      expect(mockConsumeSend).toHaveBeenCalledWith({ hostId: HOST_ID })
    })

    it('is not spent by a request that never reaches the send', async () => {
      mockMemberExists = false
      const { res } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.3.3.3', { hostId: HOST_ID, email: 'ghost@example.com' }),
        res,
      )
      expect(mockConsumeSend).not.toHaveBeenCalled()
    })
  })
})

describe('membership reset handler (AGL-552)', () => {
  it('sets the new password for a valid token', async () => {
    const token = mintPasswordResetToken(
      HOST_ID,
      'member-1',
      mockMemberFields['passwordScrypt'] as string,
    )
    const { res, result } = makeResponse()
    await membershipResetHandler(
      makeRequest('10.2.0.1', {
        hostId: HOST_ID,
        token,
        password: 'a whole new password',
      }),
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(memberSetCalls).toHaveLength(1)
    expect(
      verifyMemberPassword(
        'a whole new password',
        memberSetCalls[0]['passwordScrypt'] as string,
      ),
    ).toBe(true)
  })

  it('rejects a token reused after a completed reset', async () => {
    const token = mintPasswordResetToken(
      HOST_ID,
      'member-1',
      mockMemberFields['passwordScrypt'] as string,
    )
    const first = makeResponse()
    await membershipResetHandler(
      makeRequest('10.2.0.2', {
        hostId: HOST_ID,
        token,
        password: 'a whole new password',
      }),
      first.res,
    )
    expect(first.result.status).toBe(200)
    // Same link again: the hash binding no longer matches.
    const second = makeResponse()
    await membershipResetHandler(
      makeRequest('10.2.0.3', {
        hostId: HOST_ID,
        token,
        password: 'yet another password',
      }),
      second.res,
    )
    expect(second.result.status).toBe(400)
    expect(memberSetCalls).toHaveLength(1)
  })

  it('rejects expired, tampered, and wrong-host tokens', async () => {
    const hash = mockMemberFields['passwordScrypt'] as string
    const token = mintPasswordResetToken(HOST_ID, 'member-1', hash)
    const wrongHost = mintPasswordResetToken('host-2', 'member-1', hash)
    const tampered =
      token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')

    for (const badToken of [wrongHost, tampered]) {
      const { res, result } = makeResponse()
      await membershipResetHandler(
        makeRequest('10.2.0.4', {
          hostId: HOST_ID,
          token: badToken,
          password: 'a whole new password',
        }),
        res,
      )
      expect(result.status).toBe(400)
    }

    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 2 * 60 * 60 * 1000)
    const { res, result } = makeResponse()
    await membershipResetHandler(
      makeRequest('10.2.0.5', {
        hostId: HOST_ID,
        token,
        password: 'a whole new password',
      }),
      res,
    )
    expect(result.status).toBe(400)
    expect(memberSetCalls).toHaveLength(0)
  })

  it('rejects a suspended member even with a valid token (AGL-550)', async () => {
    // A token minted BEFORE the suspension stays cryptographically valid
    // for its hour — the handler must still refuse to rehabilitate the
    // account's password.
    const token = mintPasswordResetToken(
      HOST_ID,
      'member-1',
      mockMemberFields['passwordScrypt'] as string,
    )
    mockMemberFields['suspended'] = true
    const { res, result } = makeResponse()
    await membershipResetHandler(
      makeRequest('10.2.0.7', {
        hostId: HOST_ID,
        token,
        password: 'a whole new password',
      }),
      res,
    )
    expect(result.status).toBe(403)
    expect(String(result.body?.error)).toMatch(/suspended/i)
    expect(memberSetCalls).toHaveLength(0)
  })

  it('rejects short passwords before touching the token', async () => {
    const { res, result } = makeResponse()
    await membershipResetHandler(
      makeRequest('10.2.0.6', {
        hostId: HOST_ID,
        token: 'anything',
        password: 'short',
      }),
      res,
    )
    expect(result.status).toBe(400)
    expect(String(result.body?.error)).toMatch(/8 characters/)
  })
})
