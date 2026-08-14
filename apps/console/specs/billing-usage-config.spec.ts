/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * `/api/billing/usage-config` hands the Billing card the raw
 * `BILL_ORG_LIBRARY_STORAGE_FROM` value (AGL-1473's console half).
 *
 * The contract that matters is VERBATIM: the route must not interpret,
 * validate or normalise the env var, because `billsOrgLibraryStorage` is the
 * one evaluator — the rollup passes the raw value through it on the server
 * and the card passes this route's answer through the same function on the
 * client. A route that "helpfully" cleaned the value would be a second
 * parser, and second parsers drift.
 */

const mockVerifyIdToken = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: {},
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { GET } from '../app/api/billing/usage-config/route'

function request(token?: string, method = 'GET') {
  return new Request('https://app.aglyn.com/api/billing/usage-config', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  delete process.env.BILL_ORG_LIBRARY_STORAGE_FROM
})

describe('/api/billing/usage-config', () => {
  it('rejects a caller with no token', async () => {
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('rejects a token the SDK cannot verify', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'))
    const response = await GET(request('forged'))
    expect(response.status).toBe(401)
  })

  it('answers null while the switch is unset — the shipped default', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1' })
    const response = await GET(request('valid'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ orgLibraryBilledFrom: null })
  })

  it('returns the configured value VERBATIM, garbage included', async () => {
    // ` 2026-09 ` (whitespace) and `true` (a typo'd boolean) must arrive
    // untouched: `billsOrgLibraryStorage` is where tolerance and fail-closed
    // live, on both ends, and it already has its own spec for both values.
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1' })
    for (const raw of ['2026-09', ' 2026-09 ', 'true']) {
      process.env.BILL_ORG_LIBRARY_STORAGE_FROM = raw
      const response = await GET(request('valid'))
      expect(await response.json()).toEqual({ orgLibraryBilledFrom: raw })
    }
  })
})
