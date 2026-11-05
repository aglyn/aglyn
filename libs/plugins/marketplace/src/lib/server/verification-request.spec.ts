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

// Each save's agreement is recorded through its own module (AGL-4105),
// faked here so the route's Firestore double does not have to model it.
jest.mock('./publisher-agreement-acceptance', () => ({
  recordPublisherAgreementAcceptance: jest.fn(async () => ({})),
  publisherAgreementNote: () => ({ version: 'noted' }),
}))
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
/** The caller's standing on "Edit the publisher profile", and what was asked (AGL-4047). */
const mockVerdict: { current: 'granted' | 'refused' | 'not-a-member' } = { current: 'granted' }
const mockAsked: Array<[unknown, unknown, unknown]> = []
jest.mock('./publisher-permissions', () => ({
  publisherPermissionVerdict: async (uid: unknown, orgId: unknown, key: unknown) => {
    mockAsked.push([uid, orgId, key])
    return mockVerdict.current
  },
}))

import { verificationRequestHandler } from './verification-request'
import { publisherAgreementConsent } from '../model/publisher-agreement'

const authError = (code: string, message = 'x') => Object.assign(new Error(message), { code })

async function call(token: string | null = 'token', agreement: unknown = publisherAgreementConsent()) {
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
      body: { listingId: 'listing-1', action: 'request', agreement },
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )
  return { status, body }
}

beforeEach(() => {
  mockVerdict.current = 'granted'
  mockAsked.length = 0
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

  it('throws to the dispatcher, which answers 5xx, when the certificates cannot be fetched', async () => {
    // A failure to CHECK the credential is ours, so it is rethrown rather than
    // read as the caller's bad sign-in (AGL-2852).
    mockVerifyIdToken.mockRejectedValueOnce(
      authError('auth/argument-error', 'Error fetching public keys for Google certs: ETIMEDOUT'),
    )
    await expect(call()).rejects.toThrow(/public keys/)
  })

  it('answers 500 when the listing read fails after the caller verified', async () => {
    mockListingGet.mockRejectedValueOnce(new Error('UNAVAILABLE'))
    expect((await call()).status).toBe(500)
  })

  it('CONTROL: a verified caller asking about a listing that is not there hears 404', async () => {
    expect((await call()).status).toBe(404)
  })
})

describe('verification-request carries the publisher agreement (AGL-4105)', () => {
  it('refuses an ask that did not tick the box, before reading anything', async () => {
    const answer = await call('token', null)
    expect(answer.status).toBe(428)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(mockListingGet).not.toHaveBeenCalled()
  })
})

describe('asking for the badge asks "Edit the publisher profile" (AGL-4047)', () => {
  const listed = () =>
    mockListingGet.mockResolvedValue({ data: () => ({ profileId: 'pub-org', reviewStatus: 'listed' }) })
  const recorded = () =>
    (
      jest.requireMock('./publisher-agreement-acceptance') as {
        recordPublisherAgreementAcceptance: jest.Mock
      }
    ).recordPublisherAgreementAcceptance

  beforeEach(() => recorded().mockClear())

  it('asks the key of the workspace that published the listing, never a role', async () => {
    listed()
    mockVerdict.current = 'refused'
    await call()
    expect(mockAsked).toEqual([['publisher-1', 'pub-org', 'marketplace.publisherProfile']])
  })

  it('a member without it hears the permission named, and nothing is recorded or written', async () => {
    listed()
    mockVerdict.current = 'refused'
    const answer = await call()
    expect(answer).toEqual({
      status: 403,
      body: {
        error: 'Your role does not include "Edit the publisher profile" — ask an organization admin',
        reason: 'permission',
        permission: 'marketplace.publisherProfile',
      },
    })
    expect(recorded()).not.toHaveBeenCalled()
  })

  it('someone outside the publishing workspace hears the listing is not there, as before', async () => {
    listed()
    mockVerdict.current = 'not-a-member'
    expect((await call()).status).toBe(404)
    expect(recorded()).not.toHaveBeenCalled()
  })
})
