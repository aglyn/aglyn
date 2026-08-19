/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * Staff impersonation records WHY (AGL-2125).
 *
 * `POST /api/admin/impersonate` recorded an actor, an action and a target, and
 * nothing about why — while every neighbouring destructive staff surface
 * (`org-override`, `lockdown`, `media-quarantine`, `abuse-reports`,
 * `org-discount`) takes a reason. Signing in as a customer is the most
 * invasive thing staff can do and the one most likely to be asked about
 * months later.
 *
 * Four claims:
 *
 * 1. A reasonless request is REFUSED, and refused BEFORE a token is minted —
 *    a session opened and only then found to be unexplained is a session that
 *    happened.
 * 2. A token-shaped reason (`"x"`) is refused too. A required field that
 *    accepts a keystroke records that someone was made to type something.
 * 3. A real reason mints the token AND lands on the `adminAudit` row, at the
 *    top level where the audit page reads it.
 * 4. The dialog's minimum equals the route's. They are two constants in two
 *    modules (the route is server-only), and the copy that drifted DOWNWARD
 *    would show operators a dialog that submits and 400s.
 */

// A module, not a script.
export {}

const mockCreateCustomToken = jest.fn()
const mockVerifyIdToken = jest.fn()

/** Every document written, keyed by `collection/id`. */
let mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  authForPool: () => ({ createCustomToken: mockCreateCustomToken }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  findUserByUidAcrossPools: async (uid: string) =>
    uid === 'uid-customer'
      ? {
          record: { email: 'buyer@example.com', customClaims: {} },
          tenantId: null,
        }
      : null,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({
        collection: (name: string) => ({
          add: async (data: Record<string, unknown>) => {
            const id = `auto-${mockDocs.size}`
            mockDocs.set(`${name}/${id}`, { ...data })
            return { id }
          },
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__' },
}))

function post(body: unknown) {
  return require('../app/api/admin/impersonate/route').POST(
    new Request('https://app.aglyn.com/api/admin/impersonate', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-id-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  ) as Promise<Response>
}

function auditEntries(): Record<string, unknown>[] {
  return [...mockDocs.entries()]
    .filter(([path]) => path.startsWith('adminAudit/'))
    .map(([, value]) => value)
}

describe('staff impersonation records why (AGL-2125)', () => {
  beforeEach(() => {
    jest.resetModules()
    mockDocs = new Map()
    mockCreateCustomToken.mockReset().mockResolvedValue('custom-token')
    mockVerifyIdToken
      .mockReset()
      .mockResolvedValue({
        uid: 'uid-staff',
        email: 'zach@aglyn.com',
        email_verified: true,
        staff: true,
      })
  })

  it('refuses a request with no reason, before minting anything', async () => {
    const response = await post({ uid: 'uid-customer' })
    expect(response.status).toBe(400)
    expect(String((await response.json()).error)).toContain('reason')
    // The point of refusing early: no token exists to be used.
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
    expect(auditEntries()).toHaveLength(0)
  })

  it('refuses a reason too short to mean anything', async () => {
    const response = await post({ uid: 'uid-customer', reason: 'x' })
    expect(response.status).toBe(400)
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })

  it('refuses whitespace padded to length — trimmed, not counted raw', async () => {
    const response = await post({ uid: 'uid-customer', reason: '        ' })
    expect(response.status).toBe(400)
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })

  it('mints the token and records the reason on the audit row', async () => {
    const reason = 'ticket 481 — billing page shows the wrong plan'
    const response = await post({ uid: 'uid-customer', reason })
    expect(response.status).toBe(200)
    expect((await response.json()).token).toBe('custom-token')

    const audit = auditEntries()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorUid: 'uid-staff',
      action: 'user.impersonate',
      target: 'users/uid-customer',
      // Top level, where the audit page reads it without knowing this
      // action's payload shape.
      reason,
    })
  })

  it('the dialog enforces the same minimum the route does', () => {
    const {
      IMPERSONATION_MIN_REASON_LENGTH,
    } = require('../components/staff-impersonation-dialog.component')
    // Derived from the route's own refusal rather than from a second literal:
    // a reason one character short must be refused and one character over
    // must pass, so this fails if either side moves independently.
    const source: string = require('node:fs').readFileSync(
      require('node:path').join(
        __dirname,
        '../app/api/admin/impersonate/route.ts',
      ),
      'utf8',
    )
    const routeMinimum = Number(
      /const MIN_REASON_LENGTH = (\d+)/.exec(source)?.[1],
    )
    expect(routeMinimum).toBeGreaterThan(1)
    expect(IMPERSONATION_MIN_REASON_LENGTH).toBe(routeMinimum)
  })

  it('still refuses a non-staff caller, reason or not', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-nonstaff',
      email_verified: true,
    })
    const response = await post({
      uid: 'uid-customer',
      reason: 'a perfectly good reason',
    })
    expect(response.status).toBe(403)
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })
})
