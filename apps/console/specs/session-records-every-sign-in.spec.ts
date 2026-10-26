/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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

/*
 * Every sign-in lands in sign-in history (2026-10-25).
 *
 * The cookie exchange hands back a custom token a browser signs in with, and
 * Firebase stamps that as a sign-in, but it wrote nothing to the device
 * registry: an account's "last sign-in" moved while its sign-in history did
 * not. And the mint recorded its device only in `after()`, which production
 * showed leaving no row behind. These pin the route's half: the mint and the
 * exchange both record, saying how, before the response is sent.
 */

const mockVerifyIdToken = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockCreateSessionCookie = jest.fn(async () => 'minted-cookie')
const mockCreateCustomToken = jest.fn(async () => 'custom-token')
/** `users/{uid}/devices/{id}` by full path, or an Error to throw. */
let mockDeviceDocs: Record<string, Record<string, unknown>> | Error = {}

jest.mock('@aglyn/tenant-data-admin', () => {
  const firestore = () => ({
    doc: (path: string) => ({
      get: async () => {
        if (mockDeviceDocs instanceof Error) throw mockDeviceDocs
        const data = mockDeviceDocs[path]
        return { exists: data !== undefined, data: () => data }
      },
    }),
  })
  return {
    __esModule: true,
    ssoDomainRefusal: () => null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          verifySessionCookie: (...args: unknown[]) =>
            mockVerifySessionCookie(...args),
          createSessionCookie: (...args: unknown[]) =>
            mockCreateSessionCookie(...(args as [])),
          createCustomToken: (...args: unknown[]) =>
            mockCreateCustomToken(...(args as [])),
          tenantManager: () => ({ authForTenant: () => ({}) }),
        }),
        firestore,
      }),
      firestore,
    },
    isImpersonationSession: (decoded: { impersonatedBy?: string }) =>
      Boolean(decoded?.impersonatedBy),
    getLockdownVerdict: async () => null,
    getFeatureLockdown: async () => null,
    lockdownJsonResponse: () =>
      Response.json({ error: 'locked' }, { status: 423 }),
    seedUserProfile: async () => undefined,
    emailUnverifiedResponse: () =>
      Response.json({ error: 'unverified' }, { status: 403 }),
    // The custom-domain guard (AGL-1099c). `app.aglyn.com` is the workspace
    // apex, so it returns before this is reached; present so the closed world
    // does not throw if that ever changes.
    resolveConsoleDomain: async () => ({ known: false, servable: false }),
  }
})

jest.mock('next/server', () => ({
  __esModule: true,
  after: (fn: () => unknown) => void fn,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  PLATFORM_BRAND_NAME: 'Aglyn',
  PLATFORM_BRANDING_PROFILE: {
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  },
  brandMergeTokens: (b: Record<string, string>) => ({
    'brand.productName': b.productName,
  }),
  resolveIdpDisplayName: () => null,
  resolveIdpPhotoUrl: () => null,
  resolveIdpPhone: () => null,
  // Every key present and blank, exactly as the real `resolveIdpAddress`
  // returns when the assertion carries no address (AGL-1963). A mock that
  // returned null or undefined would be easier to satisfy than the real
  // function, which is how a double starts fabricating results.
  resolveIdpAddress: () => ({
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }),
  isLockdownActive: () => false,
  toEpochMs: () => undefined,
}))

const mockRecordDevice = jest.fn(async () => ({ newDevice: false, alerted: false }))
jest.mock('../app/api/_lib/security-alerts', () => ({
  __esModule: true,
  ...jest.requireActual('../app/api/_lib/security-alerts'),
  recordDeviceAndMaybeAlert: (...args: unknown[]) => mockRecordDevice(...(args as [])),
}))

import { GET, POST } from '../app/api/auth/session/route'

const UID = 'u1'
const DEVICE = 'dev-1'
const DEVICE_PATH = `users/${UID}/devices/${DEVICE}`
const REVOKED_AT = 1_760_000_000_000
const AFTER_S = Math.floor((REVOKED_AT + 60_000) / 1000)

const request = (method: 'GET' | 'POST', cookies: string[], query = '') =>
  new Request(`https://app.aglyn.com/api/auth/session${query}`, {
    method,
    headers: {
      authorization: 'Bearer id-token',
      cookie: cookies.join('; '),
      host: 'app.aglyn.com',
    },
  })

const setCookies = (response: Response) =>
  [...(response.headers as unknown as Headers).entries()]
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, value]) => value)
    .join(' || ')

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSessionCookie.mockResolvedValue('minted-cookie')
  mockCreateCustomToken.mockResolvedValue('custom-token')
  mockDeviceDocs = { [DEVICE_PATH]: { revokedAt: REVOKED_AT } }
})

describe('the mint', () => {
  it('records the device as a sign-in before it answers', async () => {
    mockDeviceDocs = {}
    mockVerifyIdToken.mockResolvedValue({ uid: UID, email: 'a@b.co', email_verified: true, auth_time: AFTER_S })

    const response = await POST(request('POST', [`aglyn_device=${DEVICE}`]))

    expect(response.status).toBe(200)
    expect(mockRecordDevice).toHaveBeenCalledTimes(1)
    expect(mockRecordDevice).toHaveBeenCalledWith(
      expect.objectContaining({ uid: UID, deviceId: DEVICE, via: 'sign-in' }),
    )
  })
})

describe('the cross-subdomain exchange', () => {
  beforeEach(() => {
    mockDeviceDocs = {}
    mockVerifySessionCookie.mockResolvedValue({ uid: UID, email: 'a@b.co', iat: AFTER_S })
  })

  it('records a restore, without ever emailing, when the tab is signing back in', async () => {
    const response = await GET(
      request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`], '?intent=restore'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ token: 'custom-token' })
    expect(mockRecordDevice).toHaveBeenCalledWith(
      expect.objectContaining({ uid: UID, deviceId: DEVICE, via: 'restore', alert: false }),
    )
  })

  it('records a signed-in page checking its cookie as a session, throttled', async () => {
    await GET(request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`]))

    expect(mockRecordDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        via: 'session',
        alert: false,
        touchMinIntervalMs: expect.any(Number),
      }),
    )
  })

  it('gives a browser with no device cookie one, so its next visit is the same row', async () => {
    const response = await GET(request('GET', ['__session=cookie'], '?intent=restore'))

    const deviceId = (mockRecordDevice.mock.calls[0] as unknown as [{ deviceId: string }])[0].deviceId
    expect(deviceId).toBeTruthy()
    expect(setCookies(response)).toContain(`aglyn_device=${deviceId}`)
  })

  it("never records a staff impersonation as the customer's own device", async () => {
    mockVerifySessionCookie.mockResolvedValue({ uid: UID, iat: AFTER_S, impersonatedBy: 'staff-1' })

    const response = await GET(
      request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`], '?intent=restore'),
    )

    expect(response.status).toBe(200)
    expect(mockRecordDevice).not.toHaveBeenCalled()
  })

  it('still answers when the record never finishes', async () => {
    jest.useFakeTimers()
    try {
      mockRecordDevice.mockImplementationOnce(() => new Promise(() => undefined))
      const pending = GET(request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`], '?intent=restore'))
      await jest.advanceTimersByTimeAsync(2000)
      expect((await pending).status).toBe(200)
    } finally {
      jest.useRealTimers()
    }
  })
})
