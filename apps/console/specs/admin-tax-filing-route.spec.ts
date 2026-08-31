/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * WHO MAY CHANGE WHERE THE PLATFORM FILES, AND WHAT IS RECORDED (AGL-2021).
 *
 * Any staff may read the configuration — support answers "where do we file"
 * without a deploy — and only `super` may change it, with an `adminAudit` row
 * carrying a before, an after and the reason typed for it. Both gates live in
 * the route, so a component that hides a button changes nothing here.
 *
 * The audit row is asserted rather than assumed. When somebody asks in a year
 * why a return was filed under a different registration number, the answer has
 * to exist — and it has to exist WITHOUT the number, because `adminAudit` is
 * readable by every staff role including the ones this route refuses.
 *
 * Every identifier below is SYNTHETIC, and deliberately not a digit run:
 * `tools/scripts/check-no-tax-identifiers.mjs` refuses real registration
 * numbers in tracked source, and a spec that pins a literal is how one came
 * back the first time.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
const mockSettingsSet = jest.fn(async (..._args: unknown[]) => undefined)
const mockSettingsDelete = jest.fn(async (..._args: unknown[]) => undefined)

/** The `platformSettings/taxFiling` document, as the route will read it. */
let mockStoredDoc: Record<string, unknown> | null = null

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
    body:
      request.method === 'GET'
        ? undefined
        : await request.json().catch(() => undefined),
  }),
  // `resolveEffectivePlan` is not used here, but the module is mocked whole:
  // a partial mock of a barrel is today's recurring way to turn an unrelated
  // import into "Element type is invalid" three files away.
  resolveEffectivePlan: () => 'free',
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: async () => ({
              exists: mockStoredDoc !== null,
              data: () => mockStoredDoc,
            }),
            // The fake STORES, so a route that re-reads its own write to
            // build the audit's `after` observes what it just wrote. A mock
            // that only records the call would report every after as the
            // before and quietly make the audit assertion meaningless.
            set: (...args: unknown[]) => {
              mockStoredDoc = args[0] as Record<string, unknown>
              return mockSettingsSet(name, ...args)
            },
            delete: (...args: unknown[]) => {
              mockStoredDoc = null
              return mockSettingsDelete(name, ...args)
            },
          }),
          add: (row: unknown) => mockAuditAdd(name, row),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

import { DELETE, GET, PUT } from '../app/api/admin/tax-filing/route'
import { invalidateTaxFilingConfigCache } from '../utils/server/tax-filing-store'

/** Synthetic throughout — see the header. */
const ENV_REGISTRATION = 'REG-SYNTHETIC-4242'
const ENV_FILING = 'FILE-SYNTHETIC-9090'
const NEW_REGISTRATION = 'REG-TYPED-1357'
const NEW_FILING = 'FILE-TYPED-2468'

function request(method: string, body?: unknown) {
  return new Request('https://app.aglyn.com/api/admin/tax-filing', {
    method,
    headers: {
      Authorization: 'Bearer token',
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

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredDoc = null
  invalidateTaxFilingConfigCache()
  process.env['AGLYN_TAX_JURISDICTION'] = 'US-TX'
  process.env['AGLYN_TAX_REGISTRATION_ID'] = ENV_REGISTRATION
  process.env['AGLYN_TAX_FILING_ID'] = ENV_FILING
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  invalidateTaxFilingConfigCache()
  jest.restoreAllMocks()
})

describe('reading is open to any staff role', () => {
  it('answers support with the configuration in force', async () => {
    asStaff('support')
    const response = await GET(request('GET'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.role).toBe('support')
    expect(body.config.jurisdiction).toBe('US-TX')
    expect(body.config.jurisdictionSource).toBe('environment')
    expect(body.config.registration.configured).toBe(true)
  })

  it('hands back no identifier, in whole or in part', async () => {
    asStaff('super')
    mockStoredDoc = {
      jurisdiction: 'US-TX',
      registrationId: NEW_REGISTRATION,
      filingId: NEW_FILING,
    }
    const response = await GET(request('GET'))
    const wire = JSON.stringify(await response.json())
    // Anti-vacuity: the response really does describe a configured
    // registration, so these are absences from a populated payload.
    expect(wire).toContain('"configured":true')
    expect(wire).not.toContain(NEW_REGISTRATION)
    expect(wire).not.toContain(NEW_FILING)
    expect(wire).not.toContain(ENV_REGISTRATION)
    expect(wire).not.toContain(ENV_FILING)
    // The registration's last four is the one fragment permitted.
    expect(wire).toContain('"hint":"1357"')
    expect(wire).toContain('"filing":{"configured":true,"source":"console","hint":null}')
  })
})

describe('writing needs the super staff role', () => {
  it('refuses support, and writes nothing at all', async () => {
    asStaff('support')
    const response = await PUT(
      request('PUT', {
        jurisdiction: 'GB',
        registrationId: NEW_REGISTRATION,
        note: 'trying it on',
      }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('super')
    expect(mockSettingsSet).not.toHaveBeenCalled()
    // A refusal is not an audited event on this route; the absence of a row
    // is what tells a reader nothing happened.
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('refuses a support DELETE too', async () => {
    asStaff('support')
    const response = await DELETE(request('DELETE', { note: 'trying it on' }))
    expect(response.status).toBe(403)
    expect(mockSettingsDelete).not.toHaveBeenCalled()
  })

  it('lets super through — the control for both refusals', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', {
        jurisdiction: 'GB',
        registrationId: NEW_REGISTRATION,
        note: 'Registered for VAT in the United Kingdom',
      }),
    )
    expect(response.status).toBe(200)
    expect(mockSettingsSet).toHaveBeenCalled()
  })
})

describe('the change is audited with the reason given for it', () => {
  it('records a before, an after and the typed reason', async () => {
    asStaff('super')
    await PUT(
      request('PUT', {
        jurisdiction: 'US-CA',
        registrationId: NEW_REGISTRATION,
        note: 'Registered with the CDTFA on 2026-08-20',
      }),
    )
    const [collection, row] = mockAuditAdd.mock.calls.at(-1) as [
      string,
      Record<string, any>,
    ]
    expect(collection).toBe('adminAudit')
    expect(row.action).toBe('taxFilingConfig.update')
    expect(row.actorUid).toBe('staff-1')
    expect(row.note).toBe('Registered with the CDTFA on 2026-08-20')
    expect(row.before.jurisdiction).toBe('US-TX')
    expect(row.after.jurisdiction).toBe('US-CA')
    expect(row.target).toBe('platformSettings/taxFiling')
  })

  it('records that an identifier changed and never what it changed to', async () => {
    asStaff('super')
    await PUT(
      request('PUT', {
        jurisdiction: 'US-CA',
        registrationId: NEW_REGISTRATION,
        note: 'Registered with the CDTFA',
      }),
    )
    const row = (mockAuditAdd.mock.calls.at(-1) as [string, unknown])[1]
    const wire = JSON.stringify(row)
    // The row really does describe a registration — anti-vacuity again.
    expect(wire).toContain('"registrationIdSet":true')
    expect(wire).not.toContain(NEW_REGISTRATION)
    expect(wire).not.toContain(ENV_REGISTRATION)
    expect(wire).not.toContain(ENV_FILING)
  })

  it('refuses a change with no reason, so no row is ever reasonless', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { jurisdiction: 'GB', note: '   ' }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('reason')
    expect(mockSettingsSet).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })
})

describe('the stored record is the whole configuration', () => {
  it('refuses a jurisdiction that could not be a bucket key', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { jurisdiction: 'Texas', note: 'moving' }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('US-TX')
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })

  it('refuses half a Texas registration', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', {
        jurisdiction: 'US-TX',
        registrationId: NEW_REGISTRATION,
        filingId: '',
        note: 'renewal',
      }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Webfile number')
  })

  it('keeps a stored identifier the caller did not send', async () => {
    asStaff('super')
    mockStoredDoc = {
      jurisdiction: 'GB',
      registrationId: NEW_REGISTRATION,
      filingId: null,
    }
    await PUT(
      request('PUT', {
        jurisdiction: 'GB',
        firstTaxablePeriod: '2025-Q1',
        note: 'Correcting the first filable period',
      }),
    )
    const written = (mockSettingsSet.mock.calls.at(-1) as unknown[])[1] as any
    // Editing the period must not be a way to silently unset a registration.
    expect(written.registrationId).toBe(NEW_REGISTRATION)
    expect(written.firstTaxablePeriod).toBe('2025-Q1')
  })

  it('drops a stored identifier when the jurisdiction moves', async () => {
    asStaff('super')
    mockStoredDoc = {
      jurisdiction: 'US-CA',
      registrationId: NEW_REGISTRATION,
      filingId: null,
    }
    await PUT(
      request('PUT', { jurisdiction: 'GB', note: 'Registered in the UK' }),
    )
    const written = (mockSettingsSet.mock.calls.at(-1) as unknown[])[1] as any
    expect(written.jurisdiction).toBe('GB')
    // One authority's number is never carried onto another's return.
    expect(written.registrationId).toBeNull()
  })

  it('erases on an explicitly empty identifier', async () => {
    asStaff('super')
    mockStoredDoc = {
      jurisdiction: 'GB',
      registrationId: NEW_REGISTRATION,
      filingId: null,
    }
    await PUT(
      request('PUT', {
        jurisdiction: 'GB',
        registrationId: '',
        filingId: '',
        note: 'Deregistered',
      }),
    )
    const written = (mockSettingsSet.mock.calls.at(-1) as unknown[])[1] as any
    expect(written.registrationId).toBeNull()
  })

  it('writes without merging, so no field can survive unnoticed', async () => {
    asStaff('super')
    await PUT(
      request('PUT', {
        jurisdiction: 'GB',
        registrationId: NEW_REGISTRATION,
        note: 'Registered in the UK',
      }),
    )
    const call = mockSettingsSet.mock.calls.at(-1) as unknown[]
    expect(call[0]).toBe('platformSettings')
    // No `{ merge: true }` third argument: a merge would leave a previous
    // authority's identifier under a new jurisdiction.
    expect(call[2]).toBeUndefined()
  })
})

describe('clearing hands the environment its layer back', () => {
  it('deletes the record and reports the environment in force', async () => {
    asStaff('super')
    mockStoredDoc = { jurisdiction: 'GB', registrationId: NEW_REGISTRATION }
    const response = await DELETE(
      request('DELETE', { note: 'Reverting to the deployment configuration' }),
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(mockSettingsDelete).toHaveBeenCalled()
    // The environment's jurisdiction, back in force the moment the stored
    // record is gone — the other direction of the precedence rule.
    expect(body.config.jurisdiction).toBe('US-TX')
    expect(body.config.jurisdictionSource).toBe('environment')
    expect(body.config.storedPresent).toBe(false)
    const row = (mockAuditAdd.mock.calls.at(-1) as [string, any])[1]
    expect(row.action).toBe('taxFilingConfig.clear')
    expect(row.note).toBe('Reverting to the deployment configuration')
  })

  it('refuses a clear with no reason', async () => {
    asStaff('super')
    const response = await DELETE(request('DELETE', {}))
    expect(response.status).toBe(400)
    expect(mockSettingsDelete).not.toHaveBeenCalled()
  })
})

describe('the gate before every gate', () => {
  it('refuses a caller with no staff claim', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email: 'someone@example.com',
      email_verified: true,
    })
    expect((await GET(request('GET'))).status).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/admin/tax-filing'),
    )
    expect(response.status).toBe(401)
  })
})
