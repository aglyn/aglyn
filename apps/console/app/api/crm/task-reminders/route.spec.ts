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
 * The hourly task reminder route (AGL-2659), driven end to end over an
 * in-memory Firestore: a reminder that has come due is sent once, to its
 * assignee, in the console and by mail; a muted, completed or already
 * handled one is not; and a second run over the same hour says nothing.
 *
 * `@aglyn/aglyn/server` is REAL — the rule and the words under the route
 * are the thing being proved, and the entitlement, release-flag and
 * branding resolvers are pure. The Admin SDK, the mail sender and the
 * suppression gate are the seams, in the digest spec's shape.
 */

export {}

// ---------------------------------------------------------------------------
// In-memory Firestore: nested collections, equality and range filters, one
// order in either direction, a limit, `startAfter(ref)` on the id order the
// sweep uses, and a write batch of updates.
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
    update: async (value: Record<string, any>) => {
      const prior = mockStore.get(path)
      if (prior === undefined) throw new Error(`update of missing ${path}`)
      mockStore.set(path, { ...prior, ...value })
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

/** Every batch the route committed, as the number of updates it carried. */
const mockBatches: number[] = []

const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  getAll: async (...refs: any[]) => Promise.all(refs.map((ref) => ref.get())),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      update: (ref: { update: (value: Record<string, any>) => Promise<void> }, value: Record<string, any>) => {
        queued.push(() => ref.update(value))
      },
      commit: async () => {
        mockBatches.push(queued.length)
        for (const op of queued) await op()
      },
    }
  },
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
  CRM_TASK_REMINDERS_JOB_ID,
  GET as remindersGet,
  POST as remindersPost,
} from './route'

const SECRET = 'reminders-test-secret'
/** 13:00 UTC, 08:00 America/Chicago — the zone the words are said in. */
const NOW = Date.parse('2026-09-05T13:00:00.000Z')
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const URL = 'https://app.aglyn.com/api/crm/task-reminders'

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

const post = (body?: unknown) => remindersPost(request('POST', body))

function seed(path: string, data: Record<string, any>) {
  mockStore.set(path, data)
}

const taskAt = (id: string) => mockStore.get(`orgs/org-a/crmTasks/${id}`)

/** The platform as the route finds it: one entitled org with reminders due, two that are not. */
function seedPlatform() {
  seed('orgs/org-a', {
    name: 'Acme',
    slug: 'acme',
    plan: 'business',
    entitlements: { features: { crm: true } },
  })
  seed('orgs/org-a/members/ann', { role: 'admin', email: 'Ann@Acme.com', displayName: 'Ann' })
  seed('orgs/org-a/members/bob', { role: 'editor', email: 'bob@acme.com' })
  seed('orgs/org-a/members/vic', { role: 'viewer', email: 'vic@acme.com' })
  seed('orgs/org-a/members/sus', { role: 'admin', email: 'sus@acme.com', orgSuspended: true })
  seed('hosts/site-a', { orgId: 'org-a', subdomain: 'main', name: 'Main site' })
  seed('hosts/site-b', { orgId: 'org-a', subdomain: 'shop', name: 'Shop' })
  const task = (id: string, fields: Record<string, any>) =>
    seed(`orgs/org-a/crmTasks/${id}`, {
      status: 'open',
      kind: 'call',
      hostId: 'site-a',
      title: id,
      dueAtMs: NOW - HOUR,
      remindAtMs: NOW - HOUR,
      ...fields,
    })
  // Ann: a call five minutes ago on the main site, and an organization
  // task reminded an hour ahead of a due date tomorrow.
  task('t-ann-call', {
    title: 'Call Jane',
    dueAtMs: NOW - 5 * MINUTE,
    remindAtMs: NOW - 5 * MINUTE,
    assigneeUid: 'ann',
    contactId: 'c-1',
  })
  task('t-ann-org', {
    title: 'Renew the insurance',
    kind: 'todo',
    hostId: null,
    dueAtMs: NOW + DAY,
    remindAtMs: NOW - HOUR,
    assigneeUid: 'ann',
  })
  task('t-bob', {
    title: 'Send the deck',
    kind: 'email',
    hostId: 'site-b',
    assigneeUid: 'bob',
    dealId: 'd-7',
  })
  // Not due: a reminder still to come, a task already done, one already
  // handled, and one with no reminder at all.
  task('t-future', { remindAtMs: NOW + HOUR, assigneeUid: 'ann' })
  task('t-done', { status: 'done', remindAtMs: NOW - DAY, assigneeUid: 'ann' })
  task('t-sent', { remindAtMs: NOW - DAY, reminderSentAtMs: NOW - DAY + MINUTE, assigneeUid: 'ann' })
  task('t-none', { remindAtMs: null, assigneeUid: 'ann' })
  // Due, and for nobody the route can tell.
  task('t-unassigned', {})
  task('t-viewer', { assigneeUid: 'vic' })
  task('t-suspended', { assigneeUid: 'sus' })
  seed('users/ann', {})
  seed('users/bob', {})
  // No CRM on the plan: the same work, and nobody is told.
  seed('orgs/org-free', { name: 'Free', slug: 'free', plan: 'free' })
  seed('orgs/org-free/members/fay', { role: 'owner', email: 'fay@free.com' })
  seed('orgs/org-free/crmTasks/t', {
    status: 'open',
    remindAtMs: NOW - HOUR,
    assigneeUid: 'fay',
    hostId: 'h',
  })
  // Entitled, but the suite's release flag is held off for this org.
  seed('orgs/org-off', {
    name: 'Off',
    slug: 'off',
    plan: 'business',
    entitlements: { features: { crm: true } },
    releaseFlags: { release_contacts: false },
  })
  seed('orgs/org-off/members/olly', { role: 'owner', email: 'olly@off.com' })
  seed('orgs/org-off/crmTasks/t', {
    status: 'open',
    remindAtMs: NOW - HOUR,
    assigneeUid: 'olly',
    hostId: 'h',
  })
}

beforeEach(() => {
  mockStore.clear()
  mockNotified.length = 0
  mockSent.length = 0
  mockBatches.length = 0
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

describe('POST /api/crm/task-reminders (AGL-2659)', () => {
  it('refuses a caller without the secret, and a method it does not serve', async () => {
    expect((await remindersPost(request('POST', undefined, null))).status).toBe(401)
    expect((await remindersPost(request('POST', undefined, 'wrong'))).status).toBe(401)
    expect((await remindersPost(request('DELETE'))).status).toBe(405)
    expect(mockSent).toEqual([])
    expect(mockStore.has(`platformCronBeats/${CRM_TASK_REMINDERS_JOB_ID}`)).toBe(false)
  })

  it('tells each assignee once — a notification per task, one mail per member — and stamps what it handled', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      timeZone: 'America/Chicago',
      dryRun: false,
      swept: 3,
      due: 6,
      handled: 6,
      notified: 3,
      emailed: 2,
      done: true,
      nextCursor: null,
    })
    expect(body.orgs['org-free'].skipped).toBe('not-entitled')
    expect(body.orgs['org-off'].skipped).toBe('release-flag')
    expect(body.orgs['org-a'].members).toEqual({
      '': { tasks: 1, skipped: 'unassigned' },
      ann: { tasks: 2, notified: 2, emailed: true },
      bob: { tasks: 1, notified: 1, emailed: true },
      sus: { tasks: 1, skipped: 'not-a-member' },
      vic: { tasks: 1, skipped: 'no-data-manage' },
    })

    // The console notifications: one per task, opening the record it is
    // for, on its site — or on the organization hub for a task with none.
    expect(mockNotified).toHaveLength(3)
    const [annCall, annOrg, bob] = mockNotified
    expect(annCall.uids).toEqual(['ann'])
    expect(annCall.payload).toEqual({
      type: 'content.taskReminder',
      title: 'Task reminder',
      body: 'Call Jane · due Sat, Sep 5, 7:55 AM',
      link: '/site-a/crm/contacts/c-1',
      orgId: 'org-a',
      hostId: 'site-a',
    })
    expect(annOrg.payload).toEqual({
      type: 'content.taskReminder',
      title: 'Task reminder',
      body: 'Renew the insurance · due Sun, Sep 6, 8:00 AM',
      link: '/org/crm/tasks',
      orgId: 'org-a',
    })
    expect(bob.uids).toEqual(['bob'])
    expect(bob.payload).toMatchObject({
      body: 'Send the deck · due Sat, Sep 5, 7:00 AM',
      link: '/site-b/crm/deals/d-7',
      hostId: 'site-b',
    })

    // The email: one per member, the platform's bulk priority, the
    // reminder's context tag, and the real console links — soonest first.
    expect(mockSent).toHaveLength(2)
    const [annMail, bobMail] = mockSent
    expect(annMail).toMatchObject({
      to: ['ann@acme.com'],
      subject: 'Reminder: 2 tasks are due',
      context: 'crm-task-reminder',
      priority: 'bulk',
      fromName: 'Aglyn',
    })
    expect(annMail.text).toContain(
      '- Call Jane · due Sat, Sep 5, 7:55 AM\n' +
        '  https://app.aglyn.com/acme/hosts/main/crm/contacts/c-1\n' +
        '- Renew the insurance · due Sun, Sep 6, 8:00 AM\n' +
        '  https://app.aglyn.com/acme/crm/tasks',
    )
    expect(annMail.text).toContain('https://app.aglyn.com/manage/notifications')
    expect(bobMail).toMatchObject({ to: ['bob@acme.com'], subject: 'Reminder: Send the deck' })
    expect(bobMail.text).toContain('https://app.aglyn.com/acme/hosts/shop/crm/deals/d-7')
    expect(mockMetered).toBe(2)

    // The mark, on everything handled — sent or settled — and on nothing
    // the run did not read: the reminder still to come, the done task, the
    // one handled last night (its own mark kept), the task with none.
    for (const id of ['t-ann-call', 't-ann-org', 't-bob', 't-unassigned', 't-viewer', 't-suspended']) {
      expect(taskAt(id)?.reminderSentAtMs).toBe(NOW)
    }
    for (const id of ['t-future', 't-done', 't-none']) {
      expect('reminderSentAtMs' in (taskAt(id) ?? {})).toBe(false)
    }
    expect(taskAt('t-sent')?.reminderSentAtMs).toBe(NOW - DAY + MINUTE)
    // Each verdict landed as ONE batch: the unassigned task, then the three
    // members' sets, so a rerun reads the same answer for all of a set.
    expect(mockBatches).toEqual([1, 2, 1, 1, 1])
    expect(mockStore.get(`platformCronBeats/${CRM_TASK_REMINDERS_JOB_ID}`)?.jobId).toBe(
      CRM_TASK_REMINDERS_JOB_ID,
    )
  })

  it('says nothing twice: a second run over the same hour finds nothing due', async () => {
    await post()
    const again = await (await post()).json()
    expect(again).toMatchObject({ due: 0, handled: 0, notified: 0, emailed: 0 })
    expect(again.orgs['org-a'].skipped).toBe('nothing-due')
    expect(mockNotified).toHaveLength(3)
    expect(mockSent).toHaveLength(2)
  })

  it('skips a member who muted the operational category — mail included — and stamps the reminder', async () => {
    seed('users/ann', { notificationPrefs: { content: false } })
    const body = await (await post()).json()
    expect(body.orgs['org-a'].members.ann).toEqual({ tasks: 2, skipped: 'muted' })
    expect(body.orgs['org-a'].members.bob).toMatchObject({ notified: 1, emailed: true })
    expect(mockNotified.map((entry) => entry.uids[0])).toEqual(['bob'])
    expect(mockSent.map((mail) => mail.to)).toEqual([['bob@acme.com']])
    // Settled, not deferred: the day she unmutes, last week's reminders do
    // not arrive at once.
    expect(taskAt('t-ann-call')?.reminderSentAtMs).toBe(NOW)
  })

  it('chases a missing address through the auth pools and honors the suppression list', async () => {
    seed('orgs/org-a/members/ann', { role: 'admin' })
    mockSuppressed.add('bob@acme.com')
    const body = await (await post()).json()
    expect(mockSent.map((mail) => mail.to)).toEqual([['ann@pool.example.com']])
    expect(body.orgs['org-a'].members.bob).toEqual({
      tasks: 1,
      notified: 1,
      emailed: false,
      emailReason: 'suppressed',
    })
    // The notification does not wait on the mail, and the mark does not
    // wait on either.
    expect(mockNotified.map((entry) => entry.uids[0])).toEqual(['ann', 'ann', 'bob'])
    expect(taskAt('t-bob')?.reminderSentAtMs).toBe(NOW)
  })

  it('plans without sending on a GET, stamps nothing, and leaves no beat', async () => {
    const response = await remindersGet(request('GET'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ dryRun: true, due: 6, handled: 6, notified: 0, emailed: 0 })
    expect(body.orgs['org-a'].members.ann).toEqual({ tasks: 2, notified: 2, emailed: true })
    expect(mockSent).toEqual([])
    expect(mockNotified).toEqual([])
    expect(mockBatches).toEqual([])
    expect('reminderSentAtMs' in (taskAt('t-ann-call') ?? {})).toBe(false)
    // A human's GET is not the scheduler.
    expect(mockStore.has(`platformCronBeats/${CRM_TASK_REMINDERS_JOB_ID}`)).toBe(false)
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
    // The email came first for exactly this reason: nothing else happened
    // for Ann, and her reminders are at the top of next hour's window.
    expect(mockNotified).toEqual([])
    expect('reminderSentAtMs' in (taskAt('t-ann-call') ?? {})).toBe(false)
    // The verdict already reached — nobody to tell — stands.
    expect(taskAt('t-unassigned')?.reminderSentAtMs).toBe(NOW)
  })

  it('keeps going past a failed send that is not a refusal', async () => {
    mockSendResults = [{ sent: false, reason: 'network' }]
    const body = await (await post()).json()
    expect(body.orgs['org-a'].members.ann).toMatchObject({
      emailed: false,
      emailReason: 'network',
      notified: 2,
    })
    expect(body.orgs['org-a'].members.bob).toMatchObject({ emailed: true })
    expect(mockNotified).toHaveLength(3)
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
    expect(body).toMatchObject({ done: true, swept: 3, notified: 0 })
    expect(body.orgs['org-free'].skipped).toBe('not-entitled')
    expect(mockSent).toEqual([])
  })
})
