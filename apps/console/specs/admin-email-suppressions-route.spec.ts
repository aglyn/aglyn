/**
 * @jest-environment node
 */

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
 * The PLATFORM-WIDE suppression list, on the staff console.
 *
 * `listEmailSuppressions` and `releaseEmail` were written and had no callers
 * anywhere in the repo, so an address could be suppressed platform-wide by
 * the delivery webhook and never seen or lifted by anybody. A customer whose
 * address landed there stopped receiving mail from the whole product, and no
 * screen said why.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **STAFF ONLY, both directions.** A gate that admits everybody passes
 *    every test that only tries a staffer, so a non-staff account is tried
 *    too — releasing an address puts a known-bad one back onto the domain
 *    every customer's mail leaves by.
 *  - **A RELEASE IS AUDITED, with the address MASKED.** `adminAudit` is
 *    readable by any staff role; a row echoing addresses in full would make
 *    the audit trail leakier than the list it describes.
 *  - **A REASON IS REQUIRED BY THE ROUTE**, not only by the button. A record
 *    saying somebody released an address and nothing else answers half the
 *    question it is kept for.
 */

const mockListed: Array<Record<string, unknown>> = []
/** Enough rows that a page can end short of them. */
let mockRows: Array<Record<string, unknown>> = []
const mockReleased: Array<Record<string, unknown>> = []
const mockAudits: Array<Record<string, unknown>> = []
let mockReleaseAnswer = true
let mockDecoded: Record<string, unknown> = {
  uid: 'uid-staff',
  email: 'staff@aglyn.com',
  email_verified: true,
  staff: true,
}

jest.mock('@aglyn/aglyn/server', () => ({
  pluginRequestFromWeb: async (request: any) => ({
    method: request.method,
    query: request.query ?? {},
    body: request.jsonBody ?? {},
    headers: request.headers ?? {},
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({ auth: () => ({ verifyIdToken: async () => mockDecoded }) }),
  },
  listEmailSuppressions: async (options: Record<string, unknown>) => {
    mockListed.push(options)
    return mockRows.slice(0, Number(options.limit ?? 100))
  },
  // The REAL cursor derivation, so a spec asserting on the cursor asserts on
  // the value the next request will actually be given.
  suppressionCursorFrom: jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/email-suppression',
  ).suppressionCursorFrom,
  releaseEmail: async (input: Record<string, unknown>) => {
    mockReleased.push(input)
    return mockReleaseAnswer
  },
}))

jest.mock('../app/api/_lib/admin-audit', () => ({
  recordAdminAudit: async (entry: Record<string, unknown>) => {
    mockAudits.push(entry)
  },
  // The REAL masking, not a stub: whether the address reaches the audit row
  // readable is the property under test, and a double returning the input
  // would certify the leak.
  maskEmailAddresses: jest.requireActual('../app/api/_lib/admin-audit')
    .maskEmailAddresses,
  subjectAddressKeyForRecipients: jest.requireActual(
    '../app/api/_lib/admin-audit',
  ).subjectAddressKeyForRecipients,
}))

jest.mock('../app/api/_lib/invalid-id-token-response', () => ({
  invalidIdTokenResponse: () => null,
}))

import { GET, POST } from '../app/api/admin/emails/suppressions/route'

const request = (
  method: string,
  extra: Record<string, unknown> = {},
): Request =>
  ({
    method,
    headers: { authorization: 'Bearer token' },
    ...extra,
  }) as unknown as Request

beforeEach(() => {
  mockListed.length = 0
  mockRows = Array.from({ length: 5 }, (_unused, index) => ({
    $id: `hash-${index}`,
    email: `person${index}@example.com`,
    reason: 'bounce',
    suppressedAt: { seconds: 1_700_000_000 - index, nanoseconds: index },
  }))
  mockReleased.length = 0
  mockAudits.length = 0
  mockReleaseAnswer = true
  mockDecoded = {
    uid: 'uid-staff',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('GET /api/admin/emails/suppressions', () => {
  it('answers a staffer with the list', async () => {
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    expect((await response.json()).entries).toHaveLength(5)
  })

  it('over-fetches by one, so “is there more” is observed and not guessed', async () => {
    // A footer that offers Next on faith takes an operator to an empty page;
    // one that hides it on faith strands whatever is past the window, which
    // on this list is the customer nobody can explain.
    const response = await GET(request('GET', { query: { limit: '2' } }))
    const body = await response.json()

    expect(Number(mockListed[0].limit)).toBe(3)
    expect(body.entries).toHaveLength(2)
    expect(body.hasMore).toBe(true)
    // The cursor is the LAST ROW SHOWN, not the row that proved there was
    // more — starting the next page after the probe would skip it.
    expect(body.nextCursor).toBe('1699999999.1')
  })

  it('says there is no more when the page is not full', async () => {
    const body = await (await GET(request('GET', { query: { limit: '50' } }))).json()
    expect(body.hasMore).toBe(false)
    expect(body.nextCursor).toBeNull()
  })

  it('carries a cursor through to the read', async () => {
    await GET(request('GET', { query: { cursor: '1699999999.1' } }))
    expect(mockListed[0].startAfter).toBe('1699999999.1')
  })

  it('refuses a non-staff account', async () => {
    mockDecoded = { uid: 'uid-user', email_verified: true }
    const response = await GET(request('GET'))
    expect(response.status).toBe(403)
    expect(mockListed).toHaveLength(0)
  })

  it('refuses an unverified staff email', async () => {
    mockDecoded = { uid: 'uid-staff', email_verified: false, staff: true }
    expect((await GET(request('GET'))).status).toBe(403)
  })

  it('bounds the page a caller may ask for', async () => {
    // The clamp, plus the one extra row the probe needs.
    await GET(request('GET', { query: { limit: '100000' } }))
    expect(Number(mockListed[0].limit)).toBe(201)
    await GET(request('GET', { query: { limit: '0' } }))
    expect(Number(mockListed[1].limit)).toBe(2)
  })
})

describe('POST /api/admin/emails/suppressions', () => {
  const release = (body: Record<string, unknown>) =>
    POST(request('POST', { jsonBody: body }))

  it('releases the address and records who did it and why', async () => {
    const response = await release({
      email: 'dana@example.com',
      note: 'mailbox was full, not gone',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ released: true })
    expect(mockReleased[0]).toMatchObject({
      email: 'dana@example.com',
      releasedByUid: 'uid-staff',
    })
    expect(mockAudits).toHaveLength(1)
    expect(mockAudits[0]).toMatchObject({ action: 'email.suppression.release' })
  })

  it('MASKS the address in the audit row', async () => {
    await release({ email: 'dana@example.com', note: 'a good reason' })
    // The row must not be a mailing list. It still has to name the reason, so
    // the record answers what it is kept for.
    expect(String(mockAudits[0].note)).not.toContain('dana@example.com')
    expect(String(mockAudits[0].note)).toContain('a good reason')
  })

  it('refuses a release with no reason, and writes nothing', async () => {
    const response = await release({ email: 'dana@example.com' })
    expect(response.status).toBe(400)
    expect(mockReleased).toHaveLength(0)
    expect(mockAudits).toHaveLength(0)
  })

  it('refuses a reason too short to be one', async () => {
    expect(
      (await release({ email: 'dana@example.com', note: 'ok' })).status,
    ).toBe(400)
    expect(mockReleased).toHaveLength(0)
  })

  it('refuses a non-staff account, and writes nothing', async () => {
    mockDecoded = { uid: 'uid-user', email_verified: true }
    const response = await release({
      email: 'dana@example.com',
      note: 'a good reason',
    })
    expect(response.status).toBe(403)
    expect(mockReleased).toHaveLength(0)
    expect(mockAudits).toHaveLength(0)
  })

  it('says so plainly when there was nothing to release', async () => {
    // Not an error: the address was never on the list, or was released
    // already. Saying so is the answer, and no audit row is owed for an act
    // that did not happen.
    mockReleaseAnswer = false
    const response = await release({
      email: 'dana@example.com',
      note: 'a good reason',
    })
    expect(await response.json()).toEqual({ released: false })
    expect(mockAudits).toHaveLength(0)
  })

  it('refuses a request naming no address', async () => {
    expect((await release({ note: 'a good reason' })).status).toBe(400)
  })
})
