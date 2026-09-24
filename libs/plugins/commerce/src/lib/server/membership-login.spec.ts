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
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { hashMemberPassword } from './membership'
import { membershipLoginHandler } from './membership-login'

// The member lookup and the member's credential document (AGL-3308) are the
// only Firestore surfaces sign-in touches; a chainable stub keeps the spec at
// the handler contract. `null` is a member with no credential document — the
// shape of every member until the migration moves the legacy hash.
const mockMemberFields: Record<string, unknown> = {}
let mockCredentialFields: Record<string, unknown> | null = null
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
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) =>
              name === 'siteMemberCredentials'
                ? {
                    doc: (memberId: string) => ({
                      get: async () => ({
                        id: memberId,
                        exists: mockCredentialFields !== null,
                        get: (field: string) => mockCredentialFields?.[field],
                      }),
                    }),
                  }
                : {
                    where: () => ({
                      limit: () => ({
                        get: async () => ({
                          docs: [
                            {
                              id: 'member-1',
                              get: (field: string) => mockMemberFields[field],
                            },
                          ],
                        }),
                      }),
                    }),
                  },
          }),
        }),
      }),
    }),
  },
}))
jest.mock('@aglyn/tenant-runtime', () => ({
  // Every server door captures through `captureHostContact` (AGL-2605), which
  // is `upsertHostContact` plus the contactCreated announcement. The stub
  // hands the call to whichever double this spec keeps for the writer — the
  // runtime mock's own, or the data-admin mock's when the spec doubles the
  // data layer instead — so assertions on its options read the same calls.
  captureHostContact: (...args: unknown[]) => {
    const runtime = jest.requireMock('@aglyn/tenant-runtime') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    const dataAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    return (runtime.upsertHostContact ?? dataAdmin.upsertHostContact)?.(...args)
  },
  emitHostEvent: jest.fn(async () => undefined),
}))

const PASSWORD = 'correct horse battery'

function makeRequest(ip: string): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', email: 'user@example.com', password: PASSWORD },
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

describe('membership login suspension gate (AGL-546)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMemberFields['passwordScrypt'] = hashMemberPassword(PASSWORD)
    delete mockMemberFields['suspended']
    mockCredentialFields = null
  })

  it('rejects a suspended member with 401 and a clear message', async () => {
    mockMemberFields['suspended'] = true
    const { res, result } = makeResponse()
    await membershipLoginHandler(makeRequest('10.0.0.1'), res)
    expect(result.status).toBe(401)
    expect(String(result.body?.error)).toMatch(/suspended/i)
    // No sign-in event and no session cookie for suspended members.
    expect(emitHostEvent).not.toHaveBeenCalled()
    expect(result.headers['Set-Cookie']).toBeUndefined()
  })

  it('still signs in members that are not suspended', async () => {
    const { res, result } = makeResponse()
    await membershipLoginHandler(makeRequest('10.0.0.2'), res)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(String(result.headers['Set-Cookie'])).toContain(
      'aglyn_member_host-1=',
    )
    expect(emitHostEvent).toHaveBeenCalledWith('host-1', 'memberSignIn', {
      email: 'user@example.com',
    })
  })

  it('keeps the wrong-password path generic (no suspension leak)', async () => {
    mockMemberFields['suspended'] = true
    const { res, result } = makeResponse()
    const req = makeRequest('10.0.0.3')
    req.body = { ...req.body, password: 'not the password' }
    await membershipLoginHandler(req, res)
    expect(result.status).toBe(401)
    expect(String(result.body?.error)).toBe('Wrong email or password')
  })
})

describe('which hash sign-in checks (AGL-3308)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of Object.keys(mockMemberFields)) delete mockMemberFields[key]
    mockCredentialFields = null
  })

  const signIn = async (ip: string, password = PASSWORD) => {
    const { res, result } = makeResponse()
    const req = makeRequest(ip)
    req.body = { ...req.body, password }
    await membershipLoginHandler(req, res)
    return result
  }

  it('signs a member in against their credential document', async () => {
    // The shape sign-up writes now: no hash on the profile at all.
    mockCredentialFields = { passwordScrypt: hashMemberPassword(PASSWORD) }
    const result = await signIn('10.0.1.1')
    expect(result.status).toBe(200)
    expect(String(result.headers['Set-Cookie'])).toContain('aglyn_member_host-1=')
  })

  it('refuses a wrong password against the credential document', async () => {
    mockCredentialFields = { passwordScrypt: hashMemberPassword(PASSWORD) }
    const result = await signIn('10.0.1.2', 'not the password')
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'Wrong email or password' })
  })

  it('falls back to the legacy hash on the profile until the migration moves it', async () => {
    mockMemberFields['passwordScrypt'] = hashMemberPassword(PASSWORD)
    const result = await signIn('10.0.1.3')
    expect(result.status).toBe(200)
  })

  it('ignores the legacy hash once a credential document carries one', async () => {
    // A stale copy left on the profile — or one planted there — must not open
    // an account whose password has moved.
    mockMemberFields['passwordScrypt'] = hashMemberPassword(PASSWORD)
    mockCredentialFields = { passwordScrypt: hashMemberPassword('the new password') }
    expect((await signIn('10.0.1.4')).status).toBe(401)
    expect((await signIn('10.0.1.5', 'the new password')).status).toBe(200)
  })

  it('refuses a member with no hash anywhere', async () => {
    const result = await signIn('10.0.1.6')
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'Wrong email or password' })
  })
})
