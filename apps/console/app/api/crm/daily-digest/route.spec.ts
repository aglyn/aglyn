/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * The daily CRM digest route (AGL-2619), driven end to end over an
 * in-memory Firestore: who is told, who is not, what the words are, and
 * that a second run on the same day says nothing.
 *
 * `@aglyn/aglyn/server` is REAL — the arithmetic under the digest is the
 * thing being proved, and the entitlement, release-flag and branding
 * resolvers are pure. The Admin SDK, the mail sender and the suppression
 * gate are the seams.
 */

export {}

// ---------------------------------------------------------------------------
// In-memory Firestore: nested collections, equality and range filters, one
// order, a limit, and `startAfter(ref)` on the id order the sweeps use.
// ---------------------------------------------------------------------------

const mockStore = new Map<string, Record<string, any>>()
let mockAutoId = 0

function mockLast(path: string): string {
  return path.split('/').pop() as string
}

function mockChildren(path: string): string[] {
  const prefix = `${path}/`
  return [...mockStore.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function mockMerge(
  into: Record<string, any>,
  value: Record<string, any>,
): Record<string, any> {
  const out = { ...into }
  for (const [key, next] of Object.entries(value)) {
    const prior = out[key]
    out[key] =
      next && typeof next === 'object' && !Array.isArray(next) && prior && typeof prior === 'object'
        ? mockMerge(prior, next)
        : next
  }
  return out
}

interface MockFilter {
  field: string
  op: string
  value: unknown
}

interface MockQueryState {
  filters: MockFilter[]
  order: { field: string; dir: 'asc' | 'desc' } | null
  limitN: number | null
  after: string | null
}

function mockMatches(data: Record<string, any>, id: string, filter: MockFilter): boolean {
  const actual = filter.field === '__name__' ? id : data[filter.field]
  const expected = filter.value as any
  switch (filter.op) {
    case '==':
      return actual === expected
    case '<':
      return typeof actual === 'number' && actual < expected
    case '<=':
      return typeof actual === 'number' && actual <= expected
    case '>':
      return typeof actual === 'number' && actual > expected
    case '>=':
      return typeof actual === 'number' && actual >= expected
    default:
      throw new Error(`mock firestore: operator ${filter.op} is not modelled`)
  }
}

function mockSnapshot(path: string) {
  const data = mockStore.get(path)
  return {
    id: mockLast(path),
    path,
    exists: data !== undefined,
    data: () => data ?? {},
    get: (field: string) => data?.[field],
    ref: mockDocRef(path),
  }
}

function mockQuery(
  path: string,
  state: MockQueryState = { filters: [], order: null, limitN: null, after: null },
): any {
  return {
    where: (field: string, op: string, value: unknown) =>
      mockQuery(path, { ...state, filters: [...state.filters, { field, op, value }] }),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') =>
      mockQuery(path, { ...state, order: { field, dir } }),
    limit: (limitN: number) => mockQuery(path, { ...state, limitN }),
    startAfter: (ref: { id: string }) => mockQuery(path, { ...state, after: ref.id }),
    get: async () => {
      let rows = mockChildren(path).map((child) => ({
        id: mockLast(child),
        path: child,
        data: mockStore.get(child) as Record<string, any>,
      }))
      rows = rows.filter((row) =>
        state.filters.every((filter) => mockMatches(row.data, row.id, filter)),
      )
      const field = state.order?.field ?? '__name__'
      const valueOf = (row: (typeof rows)[number]) =>
        field === '__name__' ? row.id : row.data[field]
      rows.sort((a, b) => {
        const left = valueOf(a)
        const right = valueOf(b)
        return left < right ? -1 : left > right ? 1 : 0
      })
      if (state.order?.dir === 'desc') rows.reverse()
      if (state.after) {
        const at = rows.findIndex((row) => row.id === state.after)
        rows = at >= 0 ? rows.slice(at + 1) : rows
      }
      if (state.limitN !== null) rows = rows.slice(0, state.limitN)
      const docs = rows.map((row) => mockSnapshot(row.path))
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  }
}

function mockDocRef(path: string): any {
  return {
    id: mockLast(path),
    path,
    get: async () => mockSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      mockStore.set(
        path,
        options?.merge ? mockMerge(mockStore.get(path) ?? {}, value) : value,
      )
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}

function mockCollection(path: string): any {
  return {
    ...mockQuery(path),
    doc: (id?: string) => mockDocRef(`${path}/${id ?? `auto-${(mockAutoId += 1)}`}`),
  }
}

const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  getAll: async (...refs: any[]) => Promise.all(refs.map((ref) => ref.get())),
}

const mockNotified: Array<{ uids: string[]; payload: Record<string, any> }> = []
const mockSent: Array<Record<string, any>> = []
let mockSendResults: Array<Record<string, any>> = []
let mockMetered = 0
const mockSuppressed = new Set<string>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<server-timestamp>' },
      FieldPath: { documentId: () => '__name__' },
    },
  },
  findUserByUidAcrossPools: async (uid: string) => ({
    record: { email: `${uid}@pool.example.com` },
  }),
  getServerReleaseFlagValues: async () => ({ release_contacts: { enabled: true } }),
  listOrgMembers: async (orgId: string) =>
    mockChildren(`orgs/${orgId}/members`).map((path) => ({
      $id: mockLast(path),
      ...mockStore.get(path),
    })),
  // The custom-role resolution stands in for itself: a viewer lacks
  // `data.manage`, everybody else on the roster has it.
  memberHasOrgPermission: async (_orgId: string, member: { role?: string } | null) =>
    Boolean(member) && member?.role !== 'viewer',
  meterPlatformEmail: async () => {
    mockMetered += 1
  },
  notifyUsers: async (uids: Iterable<string>, payload: Record<string, any>) => {
    mockNotified.push({ uids: [...uids], payload })
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  // The REAL module spread in: `rateLimitedRetryAtMs` is how the route
  // recognises a deferral, and a closed-world factory that omitted it would
  // make the deferral branch unreachable.
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return mockSendResults.shift() ?? { sent: true, id: `email_${mockSent.length}` }
  },
}))

// The LEAF the route imports the gate from, so the barrel mock above cannot
// replace it with nothing.
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  __esModule: true,
  filterSuppressedEmails: async (addresses: string[]) =>
    addresses.filter((address) => !mockSuppressed.has(address)),
}))

// ---------------------------------------------------------------------------

import {
  CRM_DIGEST_JOB_ID,
  CRM_DIGEST_MARKER_COLLECTION,
  digestTimeZone,
  GET as digestGet,
  POST as digestPost,
} from './route'

const SECRET = 'digest-test-secret'
const NOW = Date.parse('2026-09-05T13:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const URL = 'https://app.aglyn.com/api/crm/daily-digest'

function request(method: string, body?: unknown, secret: string | null = SECRET) {
  return new Request(URL, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-cron-secret': secret } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const post = (body?: unknown) => digestPost(request('POST', body))

function seed(path: string, data: Record<string, any>) {
  mockStore.set(path, data)
}

/** The platform as the route finds it: one entitled org with work, two that are not. */
function seedPlatform() {
  seed('orgs/org-a', {
    name: 'Acme',
    slug: 'acme',
    plan: 'business',
    entitlements: { features: { crm: true } },
  })
  seed('orgs/org-a/members/ann', { role: 'admin', email: 'Ann@Acme.com', displayName: 'Ann' })
  seed('orgs/org-a/members/bob', {
    role: 'editor',
    email: 'bob@acme.com',
    hostAccess: { 'site-b': 'editor' },
  })
  seed('orgs/org-a/members/vic', { role: 'viewer', email: 'vic@acme.com' })
  seed('orgs/org-a/members/sus', { role: 'admin', email: 'sus@acme.com', orgSuspended: true })
  seed('hosts/site-a', { orgId: 'org-a', subdomain: 'main', name: 'Main site' })
  seed('hosts/site-b', { orgId: 'org-a', subdomain: 'shop', name: 'Shop' })
  const task = (
    id: string,
    fields: Record<string, any>,
  ) =>
    seed(`orgs/org-a/crmTasks/${id}`, {
      status: 'open',
      kind: 'call',
      hostId: 'site-a',
      title: id,
      ...fields,
    })
  task('t-ann-overdue', { title: 'Call Jane', dueAtMs: NOW - 2 * DAY, assigneeUid: 'ann' })
  task('t-ann-today', { title: 'Send proposal', dueAtMs: NOW + HOUR, assigneeUid: 'ann' })
  task('t-bob-overdue', { dueAtMs: NOW - DAY, assigneeUid: 'bob', hostId: 'site-b' })
  task('t-done', { status: 'done', dueAtMs: NOW - 3 * DAY, assigneeUid: 'ann' })
  task('t-upcoming', { dueAtMs: NOW + 2 * DAY, assigneeUid: 'ann' })
  task('t-undated', { dueAtMs: null, assigneeUid: 'ann' })
  task('t-unassigned', { dueAtMs: NOW - DAY })
  task('t-viewer', { dueAtMs: NOW - DAY, assigneeUid: 'vic' })
  task('t-suspended', { dueAtMs: NOW - DAY, assigneeUid: 'sus' })
  // Leads: one nobody owns on the main site, one of Bob's on the shop, one
  // too young to count, one already being worked.
  seed('hosts/site-a/leads/l-open', { email: 'jane@example.com', firstSeenAtMs: NOW - 3 * DAY })
  seed('hosts/site-b/leads/l-bob', {
    email: 'joe@example.com',
    name: 'Joe',
    ownerUid: 'bob',
    firstSeenAtMs: NOW - 4 * DAY,
  })
  seed('hosts/site-b/leads/l-young', { email: 'new@example.com', firstSeenAtMs: NOW - DAY })
  seed('hosts/site-b/leads/l-working', {
    email: 'busy@example.com',
    status: 'working',
    firstSeenAtMs: NOW - 5 * DAY,
  })
  seed('users/ann', {})
  seed('users/bob', {})
  // No CRM on the plan: the same work, and nobody is told.
  seed('orgs/org-free', { name: 'Free', slug: 'free', plan: 'free' })
  seed('orgs/org-free/members/fay', { role: 'owner', email: 'fay@free.com' })
  seed('orgs/org-free/crmTasks/t', { status: 'open', dueAtMs: NOW - DAY, assigneeUid: 'fay', hostId: 'h' })
  // Entitled, but the suite's release flag is held off for this org.
  seed('orgs/org-off', {
    name: 'Off',
    slug: 'off',
    plan: 'business',
    entitlements: { features: { crm: true } },
    releaseFlags: { release_contacts: false },
  })
  seed('orgs/org-off/members/olly', { role: 'owner', email: 'olly@off.com' })
  seed('orgs/org-off/crmTasks/t', { status: 'open', dueAtMs: NOW - DAY, assigneeUid: 'olly', hostId: 'h' })
}

beforeEach(() => {
  mockStore.clear()
  mockNotified.length = 0
  mockSent.length = 0
  mockSendResults = []
  mockMetered = 0
  mockSuppressed.clear()
  mockAutoId = 0
  process.env.CRON_SECRET = SECRET
  delete process.env.CRM_DIGEST_TIME_ZONE
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  seedPlatform()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('POST /api/crm/daily-digest (AGL-2619)', () => {
  it('refuses a caller without the secret, and a method it does not serve', async () => {
    expect((await digestPost(request('POST', undefined, null))).status).toBe(401)
    expect((await digestPost(request('POST', undefined, 'wrong'))).status).toBe(401)
    expect((await digestPost(request('DELETE'))).status).toBe(405)
    expect(mockSent).toEqual([])
  })

  it('tells each member with open work once, in the console and by mail', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      day: '2026-09-05',
      timeZone: 'America/Chicago',
      dryRun: false,
      swept: 3,
      digests: 2,
      notified: 2,
      emailed: 2,
      done: true,
      nextCursor: null,
    })
    expect(body.orgs['org-free'].skipped).toBe('not-entitled')
    expect(body.orgs['org-off'].skipped).toBe('release-flag')
    expect(body.orgs['org-a'].members).toEqual({
      ann: { overdue: 1, today: 1, leads: 1, notified: true, emailed: true },
      bob: { overdue: 1, today: 0, leads: 1, notified: true, emailed: true },
      vic: { skipped: 'no-data-manage' },
    })

    // The console notification: one per member, the summary as its body,
    // opening the Tasks section of the site the first task lives on.
    expect(mockNotified).toHaveLength(2)
    const [ann, bob] = mockNotified
    expect(ann.uids).toEqual(['ann'])
    expect(ann.payload).toEqual({
      type: 'content.crmDailyDigest',
      title: 'Your CRM today',
      body: '1 task due today, 1 overdue, 1 unworked lead',
      link: '/site-a/crm/tasks',
      orgId: 'org-a',
      hostId: 'site-a',
    })
    expect(bob.payload).toMatchObject({
      body: '1 task overdue, 1 unworked lead',
      link: '/site-b/crm/tasks',
      hostId: 'site-b',
    })

    // The email: the member's own address, the platform's bulk priority,
    // the digest's context tag, and the real console links.
    expect(mockSent).toHaveLength(2)
    const [annMail, bobMail] = mockSent
    expect(annMail).toMatchObject({
      to: ['ann@acme.com'],
      subject: 'Your CRM today: 1 task due today, 1 overdue, 1 unworked lead',
      context: 'crm-daily-digest',
      priority: 'bulk',
      fromName: 'Aglyn',
    })
    expect(annMail.text).toContain('Overdue (1)\n- Call Jane · Thu, Sep 3, 8:00 AM')
    expect(annMail.text).toContain('Due today (1)\n- Send proposal · Sat, Sep 5, 9:00 AM')
    expect(annMail.text).toContain('- jane@example.com · Main site · first seen Sep 2')
    expect(annMail.text).toContain(
      'Open your tasks: https://app.aglyn.com/acme/hosts/main/crm/tasks',
    )
    expect(annMail.text).toContain(
      'Leads on Main site: https://app.aglyn.com/acme/hosts/main/crm/leads',
    )
    expect(annMail.text).toContain('https://app.aglyn.com/manage/notifications')
    expect(bobMail.to).toEqual(['bob@acme.com'])
    expect(bobMail.text).toContain('- Joe <joe@example.com> · Shop · first seen Sep 1')
    expect(bobMail.text).not.toContain('jane@example.com')
    expect(mockMetered).toBe(2)

    // The marker, per member, and the beat.
    const marker = mockStore.get(`orgs/org-a/${CRM_DIGEST_MARKER_COLLECTION}/2026-09-05`)
    expect(marker?.members).toEqual({
      ann: { atMs: NOW, overdue: 1, today: 1, leads: 1, notified: true, emailed: true },
      bob: { atMs: NOW, overdue: 1, today: 0, leads: 1, notified: true, emailed: true },
    })
    expect(mockStore.get(`platformCronBeats/${CRM_DIGEST_JOB_ID}`)?.jobId).toBe(
      CRM_DIGEST_JOB_ID,
    )
  })

  it('says nothing twice on the same day', async () => {
    await post()
    const again = await (await post()).json()
    expect(again.digests).toBe(0)
    expect(again.orgs['org-a'].members.ann).toEqual({ skipped: 'already-sent' })
    expect(again.orgs['org-a'].members.bob).toEqual({ skipped: 'already-sent' })
    expect(mockNotified).toHaveLength(2)
    expect(mockSent).toHaveLength(2)
  })

  it('honors the digest switch for the whole digest and the category mute for the console alone', async () => {
    seed('users/ann', { digestPrefs: { crmDaily: false } })
    seed('users/bob', { notificationPrefs: { content: false } })
    const body = await (await post()).json()
    expect(body.orgs['org-a'].members.ann).toEqual({ skipped: 'digest-off' })
    expect(body.orgs['org-a'].members.bob).toMatchObject({ notified: false, emailed: true })
    expect(mockNotified).toEqual([])
    expect(mockSent.map((mail) => mail.to)).toEqual([['bob@acme.com']])
    // Ann was not stamped: the day she turns it back on, she is told.
    const marker = mockStore.get(`orgs/org-a/${CRM_DIGEST_MARKER_COLLECTION}/2026-09-05`)
    expect(Object.keys(marker?.members ?? {})).toEqual(['bob'])
  })

  it('chases a missing address through the auth pools and honors the suppression list', async () => {
    seed('orgs/org-a/members/ann', { role: 'admin' })
    mockSuppressed.add('bob@acme.com')
    const body = await (await post()).json()
    expect(mockSent.map((mail) => mail.to)).toEqual([['ann@pool.example.com']])
    expect(body.orgs['org-a'].members.bob).toMatchObject({
      emailed: false,
      emailReason: 'suppressed',
      notified: true,
    })
  })

  it('plans without sending on a GET, and writes no marker', async () => {
    const response = await digestGet(request('GET'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dryRun).toBe(true)
    expect(body.digests).toBe(2)
    expect(body.orgs['org-a'].members.ann).toEqual({
      overdue: 1,
      today: 1,
      leads: 1,
      notified: true,
    })
    expect(mockSent).toEqual([])
    expect(mockNotified).toEqual([])
    expect(mockStore.has(`orgs/org-a/${CRM_DIGEST_MARKER_COLLECTION}/2026-09-05`)).toBe(false)
    // A human's GET is not the scheduler.
    expect(mockStore.has(`platformCronBeats/${CRM_DIGEST_JOB_ID}`)).toBe(false)
  })

  it('sweeps in chunks behind a cursor', async () => {
    const first = await (await post({ limit: 1 })).json()
    expect(first).toMatchObject({ swept: 1, done: false, nextCursor: 'org-a' })
    expect(Object.keys(first.orgs)).toEqual(['org-a'])
    const second = await (await post({ limit: 1, cursor: first.nextCursor })).json()
    expect(second).toMatchObject({ swept: 1, done: false, nextCursor: 'org-free' })
    const third = await (await post({ limit: 1, cursor: second.nextCursor })).json()
    expect(third).toMatchObject({ swept: 1, done: true, nextCursor: null })
    expect(Object.keys(third.orgs)).toEqual(['org-off'])
  })

  it('stops when the send-rate governor refuses, stamping nobody it did not reach', async () => {
    mockSendResults = [{ sent: false, reason: 'rate-limited', retryAtMs: NOW + HOUR }]
    const body = await (await post()).json()
    expect(body).toMatchObject({ deferred: true, done: true, nextCursor: null, emailed: 0 })
    expect(body.orgs['org-a'].members.ann).toMatchObject({ deferred: true })
    expect(body.orgs['org-a'].members.bob).toBeUndefined()
    // The email came first for exactly this reason: nothing else happened.
    expect(mockNotified).toEqual([])
    expect(mockStore.has(`orgs/org-a/${CRM_DIGEST_MARKER_COLLECTION}/2026-09-05`)).toBe(false)
  })

  it('keeps going past a failed send that is not a refusal', async () => {
    mockSendResults = [{ sent: false, reason: 'network' }]
    const body = await (await post()).json()
    expect(body.orgs['org-a'].members.ann).toMatchObject({
      emailed: false,
      emailReason: 'network',
      notified: true,
    })
    expect(body.orgs['org-a'].members.bob).toMatchObject({ emailed: true })
    expect(mockNotified).toHaveLength(2)
  })

  it('reports an org that threw as 207 and sweeps the rest', async () => {
    // Only org-a reads user documents (the others are skipped before), so
    // one failing `getAll` is one failing org.
    jest.spyOn(mockFirestore, 'getAll').mockImplementationOnce(async () => {
      throw new Error('users unreadable')
    })
    const response = await post()
    expect(response.status).toBe(207)
    const body = await response.json()
    expect(body.failures).toEqual({ 'org-a': 'users unreadable' })
    expect(body).toMatchObject({ done: true, swept: 3, digests: 0 })
    expect(body.orgs['org-free'].skipped).toBe('not-entitled')
    expect(mockSent).toEqual([])
  })

  it('reads the zone from the environment and refuses one Intl does not know', () => {
    // The literals stand in for the environment, whose console typing
    // declares `NODE_ENV`; the zone is the only variable the reader consults.
    expect(digestTimeZone({ NODE_ENV: 'test' })).toBe('America/Chicago')
    expect(digestTimeZone({ NODE_ENV: 'test', CRM_DIGEST_TIME_ZONE: 'Europe/London' })).toBe(
      'Europe/London',
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(digestTimeZone({ NODE_ENV: 'test', CRM_DIGEST_TIME_ZONE: 'Mars/Olympus' })).toBe(
      'America/Chicago',
    )
    expect(warn).toHaveBeenCalled()
  })
})
