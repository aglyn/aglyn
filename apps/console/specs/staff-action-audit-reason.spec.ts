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
 * The two staff actions whose audit rows could not answer "why" (AGL-2162).
 *
 * A sweep of all 35 `app/api/admin/*` route files against `adminAudit` and
 * `reason` found two standouts among the mutating ones:
 *
 * - **`broadcast`** pushed a message to every organization's owners and
 *   admins with no reason — and, worse, without recording the message BODY
 *   anywhere. The only durable trace of what every customer was told was a
 *   150-character title.
 * - **`firestore-export`** wrote no audit entry at all, while exporting every
 *   document in the database to a GCS bucket.
 *
 * The claims:
 *
 * 1. A reasonless broadcast is refused BEFORE the fan-out. A broadcast cannot
 *    be recalled, so a reason collected afterwards is a reason for something
 *    that already reached every customer.
 * 2. The audit row carries the body, the link, the plan cohort and whether the
 *    query hit its cap — a partial broadcast reads identically to a complete
 *    one from the count alone.
 * 3. An export writes an audit row naming the destination, with a SYSTEM
 *    actor, because the caller is a cron secret and not a person.
 * 4. A failed audit append does not fail the export: by that point Google has
 *    already started it, and reporting a failure that did not happen is worse
 *    than a missing row.
 */

// A module, not a script.
export {}

let mockDocs: Record<string, unknown>[] = []
const mockNotified: string[] = []
const mockVerifyIdToken = jest.fn()
/** Set per test to make the audit append throw, for claim 4. */
let mockAuditThrows = false

function mockFirestore() {
  return {
    collection: (name: string) => ({
      add: async (data: Record<string, unknown>) => {
        if (name === 'adminAudit' && mockAuditThrows) {
          throw new Error('PERMISSION_DENIED')
        }
        mockDocs.push({ __collection: name, ...data })
        return { id: `auto-${mockDocs.length}` }
      },
      limit: () => mockFirestoreQuery(),
      where: () => mockFirestoreQuery(),
    }),
  }
}

function mockFirestoreQuery(): any {
  return {
    limit: () => mockFirestoreQuery(),
    where: () => mockFirestoreQuery(),
    get: async () => ({
      size: 3,
      docs: [{ id: 'org-a' }, { id: 'org-b' }, { id: 'org-c' }],
    }),
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers),
  }),
}))

// The real `getApp()` reads the default firebase-admin app, which this suite
// never initializes. Returning the SAME shape `firebaseAdmin.app()` returns is
// deliberate: the route reads `options.projectId` and `options.credential` off
// it, and a double that answered those from somewhere else would let a route
// reading the wrong app pass.
jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({
    options: {
      projectId: 'aglyn-main',
      credential: {
        getAccessToken: async () => ({ access_token: 'gcp-token' }),
      },
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => mockFirestore(),
      options: {
        projectId: 'aglyn-main',
        credential: {
          getAccessToken: async () => ({ access_token: 'gcp-token' }),
        },
      },
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  notifyOrgAdmins: async (orgId: string) => {
    mockNotified.push(orgId)
  },
}))

function auditRows(): Record<string, unknown>[] {
  return mockDocs.filter((entry) => entry.__collection === 'adminAudit')
}

// ---------------------------------------------------------------------------

describe('a broadcast records why, and what was actually sent (AGL-2162)', () => {
  const post = (body: unknown) => {
    jest.resetModules()
    return require('../app/api/admin/broadcast/route').POST(
      new Request('https://app.aglyn.com/api/admin/broadcast', {
        method: 'POST',
        headers: {
          authorization: 'Bearer staff-id-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    ) as Promise<Response>
  }

  beforeEach(() => {
    mockDocs = []
    mockNotified.length = 0
    mockAuditThrows = false
    mockVerifyIdToken.mockReset().mockResolvedValue({
      uid: 'uid-staff',
      email_verified: true,
      staff: true,
    })
  })

  it('refuses a reasonless broadcast BEFORE notifying anyone', async () => {
    const response = await post({ title: 'Maintenance Saturday' })
    expect(response.status).toBe(400)
    // The point of refusing first: a broadcast cannot be un-sent.
    expect(mockNotified).toHaveLength(0)
    expect(auditRows()).toHaveLength(0)
  })

  it('refuses a reason too short to mean anything', async () => {
    const response = await post({ title: 'Maintenance', reason: 'ok' })
    expect(response.status).toBe(400)
    expect(mockNotified).toHaveLength(0)
  })

  it('records the reason, the BODY, the cohort and the link', async () => {
    const response = await post({
      title: 'Maintenance Saturday',
      body: 'The console will be read-only 02:00–04:00 UTC.',
      link: '/manage/notifications',
      plan: 'business',
      reason: 'Scheduled Firestore index rebuild, business tier only',
    })
    expect(response.status).toBe(200)
    expect(mockNotified).toEqual(['org-a', 'org-b', 'org-c'])

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUid: 'uid-staff',
      action: 'broadcast.send',
      target: 'orgs?plan=business',
      reason: 'Scheduled Firestore index rebuild, business tier only',
    })
    // The gap that mattered most: what every customer was TOLD was recorded
    // nowhere, only a 150-character title.
    expect(rows[0].after).toMatchObject({
      body: 'The console will be read-only 02:00–04:00 UTC.',
      link: '/manage/notifications',
      plan: 'business',
      orgs: 3,
      // 3 is far under MAX_ORGS_PER_BROADCAST, so this send was complete.
      truncated: false,
    })
  })

  it('still refuses a non-staff caller, reason or not', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-nonstaff',
      email_verified: true,
    })
    const response = await post({
      title: 'Maintenance',
      reason: 'a perfectly good reason',
    })
    expect(response.status).toBe(403)
    expect(mockNotified).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe('a full-database export is audited (AGL-2162)', () => {
  const ORIGINAL_ENV = process.env
  const post = () => {
    jest.resetModules()
    return require('../app/api/admin/firestore-export/route').POST(
      new Request('https://app.aglyn.com/api/admin/firestore-export', {
        method: 'POST',
        headers: { 'x-cron-secret': 'cron-fake' },
      }),
    ) as Promise<Response>
  }

  beforeEach(() => {
    mockDocs = []
    mockAuditThrows = false
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET: 'cron-fake',
      FIRESTORE_EXPORT_BUCKET: 'aglyn-main-firestore-exports',
    } as NodeJS.ProcessEnv
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'projects/aglyn-main/operations/op-1' }),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('writes an audit row naming the destination, with a SYSTEM actor', async () => {
    const response = await post()
    expect(response.status).toBe(200)

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      // The caller is a cron secret, not a person. Claiming a human actorUid
      // would be a worse record than admitting the actor is a schedule.
      actorUid: 'system:cron',
      action: 'firestore.export',
      target: 'gs://aglyn-main-firestore-exports',
    })
    expect(String(rows[0].reason)).toContain('DISASTER_RECOVERY')
    expect(rows[0].after).toMatchObject({
      operation: 'projects/aglyn-main/operations/op-1',
      projectId: 'aglyn-main',
    })
  })

  it('a failed audit append does NOT fail the export', async () => {
    // By this point Google has already started the export. Reporting a
    // failure that did not happen would send an operator hunting a backup
    // that in fact exists.
    mockAuditThrows = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await post()
    expect(response.status).toBe(200)
    expect((await response.json()).started).toBe(true)
    expect(auditRows()).toHaveLength(0)
  })

  it('an unauthenticated caller exports nothing and audits nothing', async () => {
    jest.resetModules()
    const response = (await require(
      '../app/api/admin/firestore-export/route',
    ).POST(
      new Request('https://app.aglyn.com/api/admin/firestore-export', {
        method: 'POST',
      }),
    )) as Response
    expect(response.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(auditRows()).toHaveLength(0)
  })
})
