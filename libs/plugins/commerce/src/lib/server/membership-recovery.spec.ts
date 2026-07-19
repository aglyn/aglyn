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

jest.mock('@aglyn/tenant-data-admin', () => ({
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
  memberSetCalls.length = 0
})

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

  it('throttles repeated requests per IP + email', async () => {
    let lastStatus = 0
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { res, result } = makeResponse()
      await membershipRecoverHandler(
        makeRequest('10.1.0.4', {
          hostId: HOST_ID,
          email: 'user@example.com',
        }),
        res,
      )
      lastStatus = result.status
    }
    expect(lastStatus).toBe(429)
    // The same address from a different IP is not caught in the damper.
    const { res, result } = makeResponse()
    await membershipRecoverHandler(
      makeRequest('10.1.0.5', { hostId: HOST_ID, email: 'user@example.com' }),
      res,
    )
    expect(result.status).toBe(200)
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
