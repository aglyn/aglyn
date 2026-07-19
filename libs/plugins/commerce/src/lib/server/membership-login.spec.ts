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

// The member lookup is the only Firestore surface the suspension gate
// touches; a chainable stub keeps the spec at the handler contract.
const mockMemberFields: Record<string, unknown> = {}
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
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
            }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('@aglyn/tenant-runtime', () => ({
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
