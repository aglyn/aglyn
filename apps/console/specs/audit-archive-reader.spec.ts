/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * THE 365-DAY AUDIT ARCHIVE GETS A READER (AGL-2324).
 *
 * `audit-archive/route.ts` has been moving `adminAudit` rows older than 90
 * days into `adminAudit-archive/{yyyy-MM}/*.jsonl` and DELETING them from
 * Firestore since AGL-214, and `docs/DATA_RETENTION.md` advertises "90 days
 * hot, then 365 days archived". Nothing read the second half. The archived
 * year was reachable only by a human with GCS console access — not a product
 * path, and not something an auditor can be handed.
 *
 * WHAT THIS FILE HAS TO CATCH, and how each assertion is shaped against the
 * false greens this sweep exists to end:
 *
 *  - **Content, not presence.** Asserting a 200 with a `rows` array proves
 *    nothing about whether the bytes were parsed. Each fixture line carries
 *    DISTINCT values and is asserted per row, so a reader returning the first
 *    line N times — the plausible bug — dies.
 *  - **The gate is the whole product.** These objects sit in a bucket whose
 *    storage rules deny every client by design; the staff claim is the only
 *    thing between an id token and the compliance trail. No token 401, a
 *    verified non-staff token 403, and in the 403 case STORAGE IS NEVER
 *    TOUCHED — a gate that reads first and refuses second has already leaked.
 *  - **`month` and `file` become path segments.** `../../` must be REJECTED
 *    rather than stripped: stripping turns a hostile path into a plausible
 *    one and answers a question nobody asked.
 *  - **A corrupt line is reported, not dropped.** Silently skipping it
 *    answers "what happened in March" with a shorter list and no sign that
 *    it is shorter — the 200-row window's defect, one layer down.
 */

const mockVerifyIdToken = jest.fn()
const mockGetFiles = jest.fn()
const mockExists = jest.fn()
const mockDownload = jest.fn()
const mockFile = jest.fn(() => ({
  exists: () => mockExists(),
  download: () => mockDownload(),
}))
const mockBucket = jest.fn(() => ({
  getFiles: (...args: unknown[]) => mockGetFiles(...args),
  file: (...args: unknown[]) => mockFile(...(args as [])),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      storage: () => ({ bucket: (...args: unknown[]) => mockBucket(...(args as [])) }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

import { GET } from '../app/api/admin/audit-archive/browse/route'

const get = (params: string, token?: string) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/admin/audit-archive/browse${params}`,
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
    ),
  )

/**
 * Three archived rows, all DIFFERENT.
 *
 * Distinct actors, actions, targets and timestamps, and one carries the
 * `targetTenantId` that a staff-access review is looking for. A reader that
 * returned the first line three times, or that returned a constant row,
 * produces a visibly wrong answer against this fixture rather than a
 * plausible one.
 */
const LINES = [
  JSON.stringify({
    $id: 'a1',
    actorUid: 'u-alice',
    actorEmail: 'alice@aglyn.com',
    action: 'org.override',
    target: 'orgs/acme',
    reason: 'enterprise-rate',
    at: '2026-03-04T10:00:00.000Z',
  }),
  JSON.stringify({
    $id: 'b2',
    actorUid: 'u-bob',
    actorEmail: 'bob@aglyn.com',
    action: 'user.grantStaff',
    target: 'users/carol',
    targetTenantId: 'tenant-northwind',
    at: '2026-03-05T11:00:00.000Z',
  }),
  JSON.stringify({
    $id: 'c3',
    actorUid: 'u-system',
    action: 'plugins.artifacts.reap',
    target: 'plugins/foo',
    at: '2026-03-06T12:00:00.000Z',
  }),
]

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-staff',
    email_verified: true,
    staff: true,
  })
  mockExists.mockResolvedValue([true])
  mockDownload.mockResolvedValue([Buffer.from(LINES.join('\n') + '\n')])
  mockGetFiles.mockResolvedValue([
    [
      {
        name: 'adminAudit-archive/2026-03/2026-04-01T04-00-00-000Z-1.jsonl',
        metadata: { size: '4096', timeCreated: '2026-04-01T04:00:01.000Z' },
      },
      {
        name: 'adminAudit-archive/2026-03/2026-04-02T04-00-00-000Z-1.jsonl',
        metadata: { size: '2048', timeCreated: '2026-04-02T04:00:01.000Z' },
      },
    ],
  ])
})

describe('the archive reader gate (AGL-2324)', () => {
  it('401s without a token, before Storage is touched', async () => {
    const response = await get('?month=2026-03')
    expect(response.status).toBe(401)
    expect(mockBucket).not.toHaveBeenCalled()
  })

  it('403s a verified NON-staff token, and reads nothing', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-customer',
      email_verified: true,
    })
    const response = await get('?month=2026-03', 'customer-token')
    expect(response.status).toBe(403)
    // The load-bearing half. A gate that lists the bucket and then refuses
    // has already done the thing it was refusing.
    expect(mockGetFiles).not.toHaveBeenCalled()
    expect(mockFile).not.toHaveBeenCalled()
  })

  it('rejects a traversing month or file rather than sanitizing it', async () => {
    for (const bad of [
      '?month=../orgs',
      '?month=2026-3',
      '?month=2026-13',
      '?month=2026-03/../../',
    ]) {
      const response = await get(bad, 'staff-token')
      expect(response.status).toBe(400)
    }
    const badFile = await get(
      '?month=2026-03&file=../../../orgs/secret.jsonl',
      'staff-token',
    )
    expect(badFile.status).toBe(400)
    // Rejected, not stripped: nothing walked out of the archive prefix.
    expect(mockFile).not.toHaveBeenCalled()
  })
})

describe('the archive reader (AGL-2324)', () => {
  it('lists a month newest run first, reading under the archive prefix only', async () => {
    const response = await get('?month=2026-03', 'staff-token')
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockGetFiles).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'adminAudit-archive/2026-03/' }),
    )
    // Names only — the caller must not have to know the prefix to open one.
    expect(body.files.map((file: any) => file.name)).toEqual([
      '2026-04-02T04-00-00-000Z-1.jsonl',
      '2026-04-01T04-00-00-000Z-1.jsonl',
    ])
    // Each object's OWN size, so a listing that reused the first entry's
    // metadata for every row cannot pass.
    expect(body.files.map((file: any) => file.bytes)).toEqual([2048, 4096])
  })

  it('parses each archived line back into its own row', async () => {
    const response = await get(
      '?month=2026-03&file=2026-04-01T04-00-00-000Z-1.jsonl',
      'staff-token',
    )
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(mockFile).toHaveBeenCalledWith(
      'adminAudit-archive/2026-03/2026-04-01T04-00-00-000Z-1.jsonl',
    )
    expect(body.rows).toHaveLength(3)
    // Asserted PER ROW and with distinct values. The failure this is shaped
    // against is a reader that returns line one three times — a response
    // with the right length and the wrong content.
    expect(body.rows[0]).toMatchObject({
      $id: 'a1',
      action: 'org.override',
      actorEmail: 'alice@aglyn.com',
      reason: 'enterprise-rate',
    })
    expect(body.rows[1]).toMatchObject({
      $id: 'b2',
      action: 'user.grantStaff',
      // The field AGL-1993 wrote and nothing ever projected. It survives the
      // round trip into the archive, which is the only place it now lives
      // for anything older than 90 days.
      targetTenantId: 'tenant-northwind',
    })
    expect(body.rows[2]).toMatchObject({
      $id: 'c3',
      action: 'plugins.artifacts.reap',
    })
    expect(body.unreadable).toBe(0)
    expect(body.truncated).toBe(false)
  })

  it('reports a line it could not parse instead of quietly shortening the list', async () => {
    mockDownload.mockResolvedValue([
      Buffer.from([LINES[0], '{ this is not json', LINES[2]].join('\n') + '\n'),
    ])
    const body = await (
      await get('?month=2026-03&file=x.jsonl', 'staff-token')
    ).json()

    expect(body.rows).toHaveLength(2)
    // The count is the point. Two rows with `unreadable: 0` is a compliance
    // trail asserting it is complete when it is not.
    expect(body.unreadable).toBe(1)
    expect(body.total).toBe(3)
  })

  it('404s an object that is not there, rather than an empty success', async () => {
    mockExists.mockResolvedValue([false])
    const response = await get('?month=2026-03&file=x.jsonl', 'staff-token')
    // A 200 with `rows: []` says "March was quiet". A 404 says "that object
    // does not exist" — opposite conclusions from the same screen.
    expect(response.status).toBe(404)
    expect(mockDownload).not.toHaveBeenCalled()
  })
})
