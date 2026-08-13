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
 * The scheduled DETECTOR (AGL-1478).
 *
 * `route.emulator.spec.ts` covers the repair — that the stamps land, that a
 * preset scope survives, that a second pass plans nothing — and it is
 * skipped unless the emulators are up. None of that was the problem. The
 * problem is that the route worked perfectly and **nothing ever called it**,
 * so a defect this exact plan would have listed sat undetected across 19
 * folders in two scopes until somebody noticed the file counts looked wrong.
 *
 * So what is pinned here is the invocation contract, which is the part that
 * did not exist: the weekly cron reaches it, it REPORTS rather than repairs,
 * it goes loud on a non-zero plan, and it writes nothing to the collections
 * it is inspecting no matter what the caller asks for. That last one is
 * deliberate and is the whole design: a job that silently repaired would
 * hide this same class of bug in a new way — the creation paths would stay
 * broken and the nightly sweep would keep papering over them.
 */

const mockNotifyStaff = jest.fn(async (_payload: unknown) => undefined)
const mockBatchSet = jest.fn()
const mockCommit = jest.fn(async () => undefined)
const mockVerifyIdToken = jest.fn()

/** Docs the fake Firestore hands back, by collection name. */
let seeded: Record<string, Array<{ id: string; data: Record<string, unknown> }>> =
  {}

const fakeSnapshot = (collection: string) => ({
  docs: (seeded[collection] ?? []).map((entry) => ({
    id: entry.id,
    data: () => entry.data,
    get: (field: string) => entry.data[field],
    ref: { id: entry.id },
  })),
})

const orgRef = {
  id: 'org-1',
  collection: (name: string) => ({
    get: async () => fakeSnapshot(name),
    doc: (id: string) => ({ id, collection: name }),
  }),
}

jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual('@aglyn/aglyn/server')
  return {
    ...actual,
    pluginRequestFromWeb: async (request: Request) => ({
      method: request.method,
      query: Object.fromEntries(new URL(request.url).searchParams),
      body: request.method === 'POST' ? await request.json().catch(() => ({})) : {},
      headers: Object.fromEntries(request.headers.entries()),
    }),
  }
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  notifyStaff: (payload: unknown) => mockNotifyStaff(payload),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    firestore: { FieldPath: { documentId: () => '__name__' } },
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({
        batch: () => ({ set: mockBatchSet, commit: mockCommit }),
        collectionGroup: () => ({
          select: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        }),
        collection: (name: string) =>
          name === 'orgs'
            ? {
                orderBy: () => ({
                  limit: () => ({ get: async () => ({ docs: [{ ...orgRef, ref: orgRef }] }) }),
                  startAfter: () => ({
                    limit: () => ({ get: async () => ({ docs: [] }) }),
                  }),
                }),
              }
            : { doc: (id: string) => ({ id }), add: async () => undefined },
      }),
    }),
  },
}))

const call = async (
  headers: Record<string, string>,
  body?: Record<string, unknown>,
) => {
  const { POST } = await import('./route')
  const response = await POST(
    new Request('https://console.test/api/admin/backfill-scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }),
  )
  return { status: response.status, payload: (await response.json()) as any }
}

const CRON = { 'x-cron-secret': 'test-secret' }

describe('the scope-drift detector (AGL-1478)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.CRON_SECRET = 'test-secret'
    seeded = { members: [], datasets: [], media: [], mediaFolders: [], contacts: [], contactSegments: [] }
  })

  it('is reachable by the cron, which is the entire point', async () => {
    // Before this the ONLY caller was a staff member who knew the path and
    // minted a Bearer token by hand. Nobody ever did.
    const { status } = await call(CRON)
    expect(status).toBe(200)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('DETECTS an unstamped document', async () => {
    seeded.mediaFolders = [
      { id: 'unscoped', data: { name: 'Product' } },
      { id: 'ok', data: { name: 'Brand', visibleTo: ['org'] } },
    ]
    const { payload } = await call(CRON)
    expect(payload.drift.byCollection).toEqual({ mediaFolders: 1 })
    expect(payload.drift.total).toBe(1)
  })

  it('REPORTS rather than repairs — no write, whatever the caller asks', async () => {
    seeded.datasets = [{ id: 'forked', data: { displayName: 'Survey' } }]
    // `dryRun: false` is the repair switch, and the cron is refused it: the
    // repair is a human act taken after reading the plan (docs/SCOPE_DRIFT.md).
    const { payload } = await call(CRON, { dryRun: false })
    expect(payload.dryRun).toBe(true)
    expect(mockBatchSet).not.toHaveBeenCalled()
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('goes loud on a non-zero plan — 207 and a staff notification', async () => {
    seeded.datasets = [{ id: 'forked', data: { displayName: 'Survey' } }]
    seeded.media = [{ id: 'a', data: {} }, { id: 'b', data: {} }]
    const { status, payload } = await call(CRON)
    // 207 is what the shared cron workflow turns into a RED run — the same
    // "finished, but a human must look" signal the resumable sweeps use.
    expect(status).toBe(207)
    expect(payload.drift.total).toBe(3)
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    const notification = mockNotifyStaff.mock.calls[0][0] as {
      title: string
      body: string
    }
    expect(notification.title).toMatch(/scope/i)
    // The numbers ARE the product here: "8 of 9 folders unscoped" would have
    // been AGL-1466 in one glance.
    expect(notification.body).toContain('2 media')
    expect(notification.body).toContain('1 datasets')
  })

  it('stays quiet and green when everything is stamped', async () => {
    seeded.datasets = [{ id: 'a', data: { visibleTo: ['org'] } }]
    // An EMPTY array is a stored "visible to nobody", not drift — the
    // backfill leaves it alone by design, so the detector must not report
    // it either or the alert cries wolf every week forever.
    seeded.media = [{ id: 'b', data: { visibleTo: [] } }]
    const { status, payload } = await call(CRON)
    expect(status).toBe(200)
    expect(payload.drift.total).toBe(0)
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    const { status } = await call({})
    expect(status).toBe(401)
  })

  it('still lets a staff Bearer token run the repair', async () => {
    // The repair path is unchanged: this route is still how the stamps get
    // written, and taking that away would replace a dead process with no
    // process at all.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    seeded.datasets = [{ id: 'forked', data: {} }]
    const { payload } = await call(
      { authorization: 'Bearer staff-token' },
      { dryRun: false },
    )
    expect(payload.dryRun).toBe(false)
    expect(mockCommit).toHaveBeenCalled()
  })
})

// This file drives the route through dynamic `import()` so the module-scope
// mocks are installed first, which leaves it with no top-level import — and
// therefore a global script, whose `const`s collide with every other spec in
// the program. Marked a module explicitly.
export {}
