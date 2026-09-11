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
 * `marketplace/verification-request` tells a refused credential from a
 * failure (AGL-2852).
 *
 * The handler verifies the caller, reads the listing and runs a transaction
 * inside one try, and its catch answered 401 to every throw — so a Google
 * certificate outage, a listing read that failed and a transaction that
 * aborted each told a publisher their sign-in was bad, and nothing paged. A
 * refused credential is still the caller's 401; everything else is a 5xx.
 */

const mockVerifyIdToken = jest.fn()
const mockListingGet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => mockVerifyIdToken(token) }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: () => mockListingGet() }) }),
      }),
    }),
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'server-timestamp', delete: () => 'delete' },
}))
jest.mock('./publisher-profile', () => ({ canActAsPublisher: async () => true }))

import { verificationRequestHandler } from './verification-request'

const authError = (code: string, message = 'x') => Object.assign(new Error(message), { code })

async function call(token: string | null = 'token') {
  let status = 0
  let body: unknown
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      body = value
      return res
    },
  }
  await verificationRequestHandler(
    {
      method: 'POST',
      query: {},
      body: { listingId: 'listing-1', action: 'request' },
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )
  return { status, body }
}

beforeEach(() => {
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'publisher-1' })
  mockListingGet.mockReset()
  mockListingGet.mockResolvedValue({ data: () => undefined })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('verification-request tells a refused credential from a failure (AGL-2852)', () => {
  it('answers 401 for a refused credential, and for no credential at all', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(authError('auth/id-token-expired'))
    expect((await call()).status).toBe(401)
    expect((await call(null)).status).toBe(401)
  })

  it('answers 500 when the certificates cannot be fetched', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      authError('auth/argument-error', 'Error fetching public keys for Google certs: ETIMEDOUT'),
    )
    expect((await call()).status).toBe(500)
  })

  it('answers 500 when the listing read fails after the caller verified', async () => {
    mockListingGet.mockRejectedValueOnce(new Error('UNAVAILABLE'))
    expect((await call()).status).toBe(500)
  })

  it('CONTROL: a verified caller asking about a listing that is not there hears 404', async () => {
    expect((await call()).status).toBe(404)
  })
})
