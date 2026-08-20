/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor (feedback_jest_environment_pragma_shadowed_by_license).
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
 * THE RAMP, and who may turn it (AGL-2409).
 *
 * The platform hourly send ceiling exists so a sending-domain ramp is a value
 * change rather than a deploy. This route is that value change, so it carries
 * the same posture as release flags: any staff may READ it, only `super` may
 * set it, and every set writes an `adminAudit` row.
 *
 * The reason the audit row is asserted here and not taken on trust: a ramp
 * nobody can reconstruct afterwards is not a ramp. When somebody asks in two
 * weeks why campaigns were short on the 3rd, the answer has to exist.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
const mockConfigSet = jest.fn(async (..._args: unknown[]) => undefined)
const mockReadConfig = jest.fn(async (..._args: unknown[]) => ({
  perHour: 2_000,
  enabled: true,
  updatedAtMs: null,
  updatedByEmail: null,
  note: '',
}))
const mockReadWindow = jest.fn(async (..._args: unknown[]) => ({
  windowStartMs: 1_755_100_800_000,
  resetMs: 1_755_104_400_000,
  used: 137,
}))
const mockInvalidate = jest.fn((..._args: unknown[]) => undefined)

jest.mock('@aglyn/tenant-data-admin', () => {
  const actualRateLimits = 'rateLimits'
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        }),
        firestore: () => ({
          collection: (name: string) => ({
            doc: () => ({ set: (...args: unknown[]) => mockConfigSet(...args) }),
            add: (row: unknown) => mockAuditAdd(name, row),
          }),
        }),
      }),
    },
    RATE_LIMIT_COLLECTION: actualRateLimits,
    EMAIL_SEND_RATE_CONFIG_DOC: 'sendRateConfig',
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
    // Referenced through arrows, not by value: the `jest.mock` factory is
    // HOISTED above these `const` declarations, so naming one directly is a
    // temporal-dead-zone ReferenceError that fails the whole suite to
    // TRANSFORM — which reads a great deal like a suite that ran.
    invalidateEmailSendRateConfigCache: (...args: unknown[]) =>
      mockInvalidate(...args),
    readEmailSendRateConfig: (...args: unknown[]) => mockReadConfig(...args),
    readEmailSendRateWindow: (...args: unknown[]) => mockReadWindow(...args),
    // The real one — a pure shape function with no I/O, and the thing that
    // guarantees the stored document carries no `expiresAt`.
    emailSendRateConfigWrite: jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/email-send-rate',
    ).emailSendRateConfigWrite,
  }
})

import { GET, PUT } from '../app/api/admin/email-send-rate/route'

function request(method: string, body?: unknown, token = 'token') {
  return new Request('https://app.aglyn.com/api/admin/email-send-rate', {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function asStaff(role: string) {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: role,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadConfig.mockResolvedValue({
    perHour: 2_000,
    enabled: true,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  })
  mockReadWindow.mockResolvedValue({
    windowStartMs: 1_755_100_800_000,
    resetMs: 1_755_104_400_000,
    used: 137,
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('GET', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await GET(request('GET', undefined, ''))
    expect(response.status).toBe(401)
  })

  it('refuses a signed-in NON-staff caller', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email_verified: true,
    })
    expect((await GET(request('GET'))).status).toBe(403)
  })

  it('answers the ceiling AND the current hour to any staff', async () => {
    asStaff('support')
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.config.perHour).toBe(2_000)
    // The number alone cannot answer "is it biting" — the window is why the
    // card is usable during an incident.
    expect(body.window.used).toBe(137)
    expect(body.bounds.min).toBeGreaterThan(0)
  })
})

describe('PUT', () => {
  it('refuses a non-super staff member', async () => {
    asStaff('support')
    const response = await PUT(request('PUT', { perHour: 500 }))
    expect(response.status).toBe(403)
    expect(mockConfigSet).not.toHaveBeenCalled()
  })

  it('REFUSES an out-of-range ceiling rather than silently clamping it', async () => {
    asStaff('super')
    // Storing a different number than the operator typed is how a ramp step
    // gets believed and is not real.
    expect((await PUT(request('PUT', { perHour: 0 }))).status).toBe(400)
    expect((await PUT(request('PUT', { perHour: 10_000_000 }))).status).toBe(400)
    expect((await PUT(request('PUT', { perHour: 'lots' }))).status).toBe(400)
    expect(mockConfigSet).not.toHaveBeenCalled()
  })

  it('stores the ceiling, and the stored document carries NO expiresAt', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { perHour: 500, enabled: true, note: 'warm-up step 2' }),
    )
    expect(response.status).toBe(200)
    expect(mockConfigSet).toHaveBeenCalledTimes(1)
    const [written] = mockConfigSet.mock.calls[0] as any[]
    expect(written.perHour).toBe(500)
    expect(written.updatedByEmail).toBe('staff@aglyn.com')
    // `rateLimits` has a TTL policy on `expiresAt` serving the hourly
    // counters. A config document carrying it would be swept and the platform
    // would silently revert to the compiled-in default.
    expect(written).not.toHaveProperty('expiresAt')
  })

  it('writes an adminAudit row with the before and after', async () => {
    asStaff('super')
    await PUT(request('PUT', { perHour: 500, enabled: false, note: 'incident' }))
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
    const [collection, row] = mockAuditAdd.mock.calls[0] as any[]
    expect(collection).toBe('adminAudit')
    expect(row.action).toBe('emailSendRate.update')
    expect(row.before).toEqual({ perHour: 2_000, enabled: true })
    expect(row.after).toEqual({ perHour: 500, enabled: false })
    expect(row.actorUid).toBe('staff-1')
  })

  it('drops the config cache so the acting process serves the new ceiling', async () => {
    asStaff('super')
    await PUT(request('PUT', { perHour: 500 }))
    expect(mockInvalidate).toHaveBeenCalled()
  })

  it('refuses an unsupported method', async () => {
    asStaff('super')
    const response = await PUT(
      new Request('https://app.aglyn.com/api/admin/email-send-rate', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token' },
      }),
    )
    expect(response.status).toBe(405)
  })
})
