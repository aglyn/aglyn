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

export {}

/**
 * AGL-1513 part 2 — the staff lever for "someone stole my laptop".
 *
 * AGL-1959 gave the ACCOUNT HOLDER a device list and a sign-out, and said in
 * its own route comment why it stopped there: "a uid parameter would make this
 * a way to sign anybody out." That is the correct answer for a self-service
 * endpoint and the wrong one for support, where a uid is the entire point — so
 * the staff half lives here, on the audited super-only route, and the property
 * every test below defends is that it is genuinely NARROWER than what staff
 * already had rather than a second spelling of it.
 *
 * The thing staff had was `disable`, which takes the account away. The person
 * on the phone has done nothing wrong and needs to keep working. So the
 * assertions are as much about what this action does NOT touch — the account's
 * `disabled` flag, its password — as about what it does.
 */

const SSO_TENANT = 'aglyn-org-y5v14'
const TARGET_UID = 'SsoTenantUidFixture000000000'
const ACTOR_UID = 'staff-1'
const DEVICE_ID = 'dev-stolen-laptop'

/** Every pool-tagged mutation, in the order it happened. */
let mockCalls: string[] = []
/** The device subcollection, as documents. */
const mockDevices: Record<string, Record<string, unknown>> = {}
/** Every `adminAudit` row written. */
let mockAudit: Array<Record<string, unknown>> = []
const mockVerifyIdToken = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => {
  const invalidateTokenRevocationCache = (uid: string, tenantId?: unknown) => {
    mockCalls.push(`${String(tenantId ?? 'PROJECT')}:invalidateRevocation:${uid}`)
  }
  const recordingPool = (pool: string | null) => {
    const tag = pool ?? 'PROJECT'
    return {
      setCustomUserClaims: async (uid: string, claims: any) => {
        mockCalls.push(`${tag}:setCustomUserClaims:${uid}:staff=${claims.staff}`)
      },
      updateUser: async (uid: string, update: any) => {
        mockCalls.push(
          `${tag}:updateUser:${uid}:${Object.keys(update).sort().join(',')}`,
        )
      },
      revokeRefreshTokens: async (uid: string) => {
        mockCalls.push(`${tag}:revokeRefreshTokens:${uid}`)
      },
    }
  }
  const targetRecord = {
    uid: 'SsoTenantUidFixture000000000',
    email: 'owner@acme.com',
    displayName: null,
    photoURL: null,
    disabled: false,
    customClaims: {},
    providerData: [{ providerId: 'saml.aglyn-workspace' }],
    metadata: { creationTime: null, lastSignInTime: null },
  }
  /**
   * A Firestore double that models the two behaviours the write depends on:
   * `tx.get` reports existence off the same store `tx.set` writes to, and
   * `set` with `{ merge: true }` MERGES. A double that replaced would
   * fabricate a green for "the row is stamped, not replaced" — the emulator
   * spec re-asks that same question of a real database for exactly that
   * reason.
   */
  const firestore = () => ({
    collection: (name: string) => ({
      add: async (row: Record<string, unknown>) => {
        if (name === 'adminAudit') mockAudit.push(row)
        return undefined
      },
      doc: () => ({
        set: async () => undefined,
        collection: () => ({ doc: (id: string) => ({ __id: id }) }),
      }),
    }),
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
        get: async (ref) => {
          mockCalls.push(`tx:get:${ref.__id}`)
          return {
            exists: Object.prototype.hasOwnProperty.call(mockDevices, ref.__id),
          }
        },
        set: (ref, value, options) => {
          mockCalls.push(`tx:set:${ref.__id}`)
          mockDevices[ref.__id] = options?.merge
            ? { ...(mockDevices[ref.__id] ?? {}), ...value }
            : { ...value }
        },
      }),
  })
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          ...recordingPool(null),
        }),
        firestore,
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
    },
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
    findUserByUidAcrossPools: async () => ({
      record: targetRecord,
      tenantId: 'aglyn-org-y5v14',
      uidAlsoInPools: [null],
    }),
    authForPool: (tenantId: string | null) => recordingPool(tenantId ?? null),
    invalidateTokenRevocationCache,
    setClaimsInOwningPool: async () => ({ uid: '', tenantId: null, claims: {} }),
    eraseUser: async () => ({ ok: true, deleted: {} }),
    consumePasswordResetSend: async () => ({ allowed: true }),
    passwordResetThrottleMessage: () => '',
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  PLATFORM_BRAND_NAME: 'Aglyn',
  isMediaCdnPath: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
  }),
}))

jest.mock('../app/api/_lib/password-admin', () => ({
  __esModule: true,
  originFromHeaders: () => 'https://console.aglyn.com',
  sendAuthPasswordResetEmail: async () => true,
  sendPasswordChangedNotice: async () => true,
  validateNewPassword: () => ({ password: 'a-new-password' }),
}))

const { POST } = require('../app/api/admin/users/manage/route')

async function manage(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('https://console.aglyn.com/api/admin/users/manage', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer staff-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uid: TARGET_UID, ...body }),
    }),
  )
}

beforeEach(() => {
  mockCalls = []
  mockAudit = []
  for (const key of Object.keys(mockDevices)) delete mockDevices[key]
  mockDevices[DEVICE_ID] = {
    deviceName: 'Chrome on macOS',
    userAgent: 'Mozilla/5.0 …',
    ip: '203.0.113.7',
    location: 'Dallas, TX',
    createdAt: 1,
    lastSeenAt: 2,
  }
  mockVerifyIdToken.mockResolvedValue({
    uid: ACTOR_UID,
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('the staff sign-out stamps the row rather than deleting it', () => {
  it('writes revokedAt/revokedBy/revokedByUid and keeps every descriptive field', async () => {
    const response = await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.deviceId).toBe(DEVICE_ID)
    expect(typeof body.revokedAt).toBe('number')

    const row = mockDevices[DEVICE_ID]
    expect(Number(row['revokedAt'])).toBeGreaterThan(0)
    // WHO ended it. The owner's own route writes `owner`; a row that could not
    // tell the two apart would make the audit trail the only place the
    // difference exists, and the customer never sees the audit trail.
    expect(row['revokedBy']).toBe('staff')
    expect(row['revokedByUid']).toBe(ACTOR_UID)
    // A delete would hide the device and revoke nothing — and would make that
    // same browser read as BRAND NEW on its next sign-in, mailing the owner a
    // fresh "new device" alert about the stranger just evicted.
    expect(row['deviceName']).toBe('Chrome on macOS')
    expect(row['ip']).toBe('203.0.113.7')
    expect(row['lastSeenAt']).toBe(2)
  })

  it('tells the caller the blast radius in the response, not only in the copy', async () => {
    const body = await (
      await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })
    ).json()
    // Named here so a future caller cannot present this as a per-device
    // sign-out by accident. Firebase has no per-device refresh-token
    // revocation; what is per-device is the refusal afterwards.
    expect(body.signedOutEverywhere).toBe(true)
  })
})

describe('it revokes in the pool the target actually lives in (AGL-2005)', () => {
  it('revokes and drops the cache on the SSO tenant, never the project pool', async () => {
    expect(
      (await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })).status,
    ).toBe(200)
    expect(mockCalls).toContain(`${SSO_TENANT}:revokeRefreshTokens:${TARGET_UID}`)
    // A project-pool revocation for an SSO uid returns 200 and revokes
    // nothing — measured on production under AGL-1962.
    expect(mockCalls).not.toContain(`PROJECT:revokeRefreshTokens:${TARGET_UID}`)
    expect(mockCalls).toContain(`${SSO_TENANT}:invalidateRevocation:${TARGET_UID}`)
  })

  it('stamps the row BEFORE revoking', async () => {
    await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })
    const stamped = mockCalls.indexOf(`tx:set:${DEVICE_ID}`)
    const revoked = mockCalls.indexOf(
      `${SSO_TENANT}:revokeRefreshTokens:${TARGET_UID}`,
    )
    expect(stamped).toBeGreaterThanOrEqual(0)
    expect(revoked).toBeGreaterThanOrEqual(0)
    // The reverse order would end every session and leave no record of why:
    // the row would still read as live and the operator would do it again.
    expect(stamped).toBeLessThan(revoked)
  })
})

describe('it is NARROWER than the levers staff already had', () => {
  it('does not disable the account and does not touch the password', async () => {
    expect(
      (await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })).status,
    ).toBe(200)
    // The whole reason this action exists. `disable` was the narrowest thing
    // on this route and it takes the account away — the person who just had a
    // laptop stolen cannot then sign in on their phone and carry on.
    expect(mockCalls.some((call) => call.includes(':updateUser:'))).toBe(false)
    expect(mockCalls.some((call) => call.includes(':setCustomUserClaims:'))).toBe(
      false,
    )
  })
})

describe('it refuses without signing anybody out', () => {
  it('404s an unknown device and revokes nothing', async () => {
    const response = await manage({
      action: 'signOutDevice',
      deviceId: 'no-such-device',
    })
    expect(response.status).toBe(404)
    // The dangerous failure mode: a mistyped device id that still ends every
    // session on a customer's account.
    expect(mockCalls.some((call) => call.includes('revokeRefreshTokens'))).toBe(
      false,
    )
    expect(mockAudit).toHaveLength(0)
  })

  it.each([
    ['a path-shaped id', 'users/other/devices/x'],
    ['an empty id', ''],
    ['an oversized id', 'x'.repeat(201)],
  ])('400s %s, writing nothing', async (_label, deviceId) => {
    const response = await manage({ action: 'signOutDevice', deviceId })
    expect(response.status).toBe(400)
    // `.doc()` resolves a SLASHED id as a nested path, so this check is what
    // keeps the write inside the named user's own subcollection.
    expect(mockCalls.some((call) => call.startsWith('tx:'))).toBe(false)
    expect(mockCalls.some((call) => call.includes('revokeRefreshTokens'))).toBe(
      false,
    )
  })

  it('403s a support-role staff member and writes nothing', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: ACTOR_UID,
      email: 'support@aglyn.com',
      email_verified: true,
      staff: true,
      staffRole: 'support',
    })
    const response = await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })
    expect(response.status).toBe(403)
    expect(mockDevices[DEVICE_ID]['revokedAt']).toBeUndefined()
    expect(mockCalls.some((call) => call.includes('revokeRefreshTokens'))).toBe(
      false,
    )
  })

  it('403s a non-staff caller', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'customer-1',
      email: 'nobody@example.com',
      email_verified: true,
    })
    expect(
      (await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })).status,
    ).toBe(403)
    expect(mockDevices[DEVICE_ID]['revokedAt']).toBeUndefined()
  })
})

describe('the action is audited', () => {
  it('records who, which account, which device, and the blast radius', async () => {
    await manage({ action: 'signOutDevice', deviceId: DEVICE_ID })
    expect(mockAudit).toHaveLength(1)
    const row = mockAudit[0]
    expect(row['action']).toBe('user.signOutDevice')
    expect(row['actorUid']).toBe(ACTOR_UID)
    expect(row['target']).toBe(`users/${TARGET_UID}`)
    // WHICH pool (AGL-1993): a uid alone does not identify an account when the
    // same uid can exist in two of them.
    expect(row['targetTenantId']).toBe(SSO_TENANT)
    const after = row['after'] as Record<string, unknown>
    // A row that recorded only "signed out a device" would not answer the
    // question this audit exists for.
    expect(after['deviceId']).toBe(DEVICE_ID)
    expect(after['signedOutEverywhere']).toBe(true)
    expect(Number(after['revokedAt'])).toBeGreaterThan(0)
  })
})

describe('the action is actually reachable', () => {
  it('is on the allowed-action list', async () => {
    // Guards the wiring rather than the behaviour: an action missing from
    // `ACTIONS` answers 400 "unknown action" from the top of the handler, and
    // every assertion above would then be testing a route that never runs.
    const response = await manage({
      action: 'signOutDevice',
      deviceId: DEVICE_ID,
    })
    expect(response.status).not.toBe(400)
  })

  it('still rejects an action that is not on the list', async () => {
    const response = await manage({
      action: 'signOutEverything',
      deviceId: DEVICE_ID,
    })
    expect(response.status).toBe(400)
  })
})
