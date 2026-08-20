/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this route needs `Request`/`Response`.
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
 * AGL-1959 — `POST /api/account/devices/revoke`.
 *
 * The four ways this route could return `200` and revoke nothing are the four
 * describe blocks below.
 */

const mockStore: Record<string, Record<string, unknown>> = {}
const mockRevoked: string[] = []
let mockVerifyArgs: unknown[] = []
let mockVerifyResult: Record<string, unknown> | Error = { uid: 'u1' }

/** Which pool `revokeRefreshTokens` was called on — the AGL-2005 question. */
let mockPoolAskedFor: unknown = '__never__'

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  authForPool: (tenantId: unknown) => {
    mockPoolAskedFor = tenantId
    return {
      revokeRefreshTokens: async (uid: string) => {
        mockRevoked.push(`${String(tenantId)}:${uid}`)
      },
    }
  },
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (...args: unknown[]) => {
          mockVerifyArgs = args
          if (mockVerifyResult instanceof Error) throw mockVerifyResult
          return mockVerifyResult
        },
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: (id: string) => ({ __id: id }),
            }),
          }),
        }),
        // Models the two behaviours the route depends on: `tx.get` reports
        // existence off the same mockStore `tx.set` writes to, and `set` with
        // `{ merge: true }` MERGES. A double that replaced would fabricate a
        // green for "the row is stamped, not replaced".
        runTransaction: async (
          fn: (tx: {
            get: (ref: { __id: string }) => Promise<{ exists: boolean }>
            set: (
              ref: { __id: string },
              value: Record<string, unknown>,
              options?: { merge?: boolean },
            ) => void
          }) => Promise<boolean>,
        ) =>
          fn({
            get: async (ref) => ({
              exists: Object.prototype.hasOwnProperty.call(mockStore, ref.__id),
            }),
            set: (ref, value, options) => {
              mockStore[ref.__id] = options?.merge
                ? { ...(mockStore[ref.__id] ?? {}), ...value }
                : { ...value }
            },
          }),
      }),
    }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  /*
   * `render-system-email` builds its default brand tokens at MODULE scope, so
   * a missing `brandMergeTokens` in this closed-world mock is not a failed
   * assertion — the whole suite fails to LOAD, three requires deep (the route
   * imports `DEVICES_COLLECTION` from `security-alerts`, which imports the
   * renderer). AGL-2190 records the same trap.
   */
  PLATFORM_BRAND_NAME: 'Aglyn',
  PLATFORM_BRANDING_PROFILE: {
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  },
  brandMergeTokens: (branding: Record<string, string>) => ({
    'brand.productName': branding.productName,
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async () => ({ sent: true }),
}))

import { POST } from '../app/api/account/devices/revoke/route'

const post = (body: unknown, token: string | null = 'tok') =>
  POST(
    new Request('https://app.aglyn.com/api/account/devices/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key]
  mockStore['dev-1'] = {
    deviceName: 'Chrome on macOS',
    ip: '203.0.113.7',
    lastSeenAt: 1,
  }
  mockRevoked.length = 0
  mockVerifyArgs = []
  mockVerifyResult = { uid: 'u1' }
  mockPoolAskedFor = '__never__'
})

describe('it stamps the row rather than deleting it', () => {
  it('writes revokedAt and keeps every descriptive field', async () => {
    const response = await post({ deviceId: 'dev-1' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    // Named in the RESPONSE, not only in the copy, so a caller cannot present
    // this as a per-device sign-out by accident.
    expect(body.signedOutEverywhere).toBe(true)
    expect(typeof body.revokedAt).toBe('number')

    // The row survives. Deleting it would hide the device and revoke nothing —
    // and would make the same browser read as BRAND NEW on its next sign-in,
    // mailing the owner a fresh alert about the stranger they just evicted.
    expect(mockStore['dev-1']).toMatchObject({
      deviceName: 'Chrome on macOS',
      ip: '203.0.113.7',
      revokedAt: body.revokedAt,
      revokedBy: 'owner',
    })
  })
})

describe('it revokes in the pool the account actually lives in', () => {
  it('uses the project pool for a project-pool account', async () => {
    await post({ deviceId: 'dev-1' })

    expect(mockPoolAskedFor).toBeNull()
    expect(mockRevoked).toEqual(['null:u1'])
  })

  it('uses the GCIP tenant pool for an SSO account — the AGL-2005 trap', async () => {
    // Measured on production: a `revokeRefreshTokens` dated 2026-08-14 sitting
    // on a project-pool ghost while the real account's `tokensValidAfterTime`
    // never moved. A 200 that revoked nothing.
    mockVerifyResult = { uid: 'u1', firebase: { tenant: 'sso-tenant-1' } }

    await post({ deviceId: 'dev-1' })

    expect(mockPoolAskedFor).toBe('sso-tenant-1')
    expect(mockRevoked).toEqual(['sso-tenant-1:u1'])
  })
})

describe('it revokes only what the caller owns', () => {
  it('404s a device that is not in the caller’s own subcollection', async () => {
    const response = await post({ deviceId: 'someone-elses' })

    expect(response.status).toBe(404)
    // Nothing revoked. A 404 that still signed the caller out would be a way
    // to sign yourself out by guessing.
    expect(mockRevoked).toEqual([])
  })

  it('refuses a path-shaped device id', async () => {
    // `.doc()` resolves a slashed id as a NESTED PATH, so this is not
    // cosmetic: `../../other/devices/x` would address another user's document.
    const response = await post({ deviceId: 'u2/devices/dev-1' })

    expect(response.status).toBe(400)
    expect(mockRevoked).toEqual([])
  })

  it('refuses a missing device id', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ deviceId: '   ' })).status).toBe(400)
    expect(mockRevoked).toEqual([])
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await post({ deviceId: 'dev-1' }, null)

    expect(response.status).toBe(401)
    expect(mockRevoked).toEqual([])
    expect(mockStore['dev-1']).not.toHaveProperty('revokedAt')
  })
})

describe('it will not let a stolen token drive a revocation', () => {
  it('passes checkRevoked when verifying the caller', async () => {
    await post({ deviceId: 'dev-1' })

    // A caller whose own tokens were already revoked is not signed in, and
    // letting one sign the real owner out is a denial-of-service handed to
    // whoever holds a stale token.
    expect(mockVerifyArgs).toEqual(['tok', true])
  })

  it('401s a revoked caller token and revokes nothing', async () => {
    mockVerifyResult = Object.assign(new Error('revoked'), {
      code: 'auth/id-token-revoked',
    })

    const response = await post({ deviceId: 'dev-1' })

    expect(response.status).toBe(401)
    expect(mockRevoked).toEqual([])
    expect(mockStore['dev-1']).not.toHaveProperty('revokedAt')
  })
})
