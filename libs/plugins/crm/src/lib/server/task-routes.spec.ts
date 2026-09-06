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
 * `crm/task-save` and `crm/task-complete` (AGL-2599) — the two task writes
 * with a side effect outside the document.
 *
 * WHAT THE DOUBLES MODEL, so a false green is visible:
 *
 *  1. The Firestore store below is real enough for what the routes do —
 *     `doc().get()`, `set()`, `update()` with `FieldValue.delete()` honored
 *     as a key removal, and `doc()` minting an id. Every assertion about what
 *     was written reads the store back.
 *  2. `@aglyn/aglyn/server` is the REAL module: `crmScopeTokens`,
 *     `consentGroupForHost`, `isOrgWideMember` and `memberCanSee` are exactly
 *     the rules under test, and doubling them would test the double.
 *  3. The Admin-SDK seams — token verification, org-for-host, membership,
 *     the permission resolver, `notifyUsers` — are spies with the shapes the
 *     real functions answer. `emitHostEvent` is a spy because the workflow
 *     runner is somebody else's suite.
 *  4. The ORGANIZATION variant (AGL-2637) is authorized by the real
 *     `authorizeOrgCaller` over a spied `resolveOrgPermissions` and
 *     `getOrgDoc` — the two facts it reads — so a refusal here is the org
 *     gate refusing, not a double of it.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const notifyUsers = jest.fn()
const emitHostEvent = jest.fn()
const resolveOrgPermissions = jest.fn()
const getOrgDoc = jest.fn()

let store: Record<string, Record<string, any>> = {}
let autoId = 0

const DELETE = '__delete'
const SERVER_TIMESTAMP = '__serverTimestamp'

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  get exists() {
    return store[path] !== undefined
  },
  get: (field: string) => store[path]?.[field],
  data: () => store[path],
})

const docHandle = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  get: async () => snapshotFor(path),
  set: async (data: Record<string, any>) => {
    store[path] = { ...data }
  },
  update: async (data: Record<string, any>) => {
    if (store[path] === undefined) throw new Error(`update of missing ${path}`)
    const next = { ...store[path] }
    for (const [key, value] of Object.entries(data)) {
      if (value === DELETE) delete next[key]
      else next[key] = value
    }
    store[path] = next
  },
})

const collectionHandle = (path: string) => ({
  doc: (id?: string) => docHandle(`${path}/${id ?? `auto-${++autoId}`}`),
})

const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => collectionHandle(`${name}/${id}/${sub}`),
    }),
  }),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp',
    delete: () => '__delete',
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: (...args: unknown[]) => emitHostEvent(...args),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) => resolveOrgPermissions(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
  getOrgDoc: (...args: unknown[]) => getOrgDoc(...args),
  resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
  notifyUsers: (...args: unknown[]) => notifyUsers(...args),
}))

import { crmTaskCompleteHandler, crmTaskSaveHandler } from './task-routes'

const HOST_ID = 'site-1'
/** A site some OTHER organization owns. */
const FOREIGN_HOST = 'foreign-site'
const ORG_ID = 'org-1'
const TASKS = `orgs/${ORG_ID}/crmTasks`
const WRITER = 'editor-uid'
const TEAMMATE = 'teammate-uid'

/** The roster the membership seam answers from; a uid not here is a stranger. */
let roster: Record<string, Record<string, unknown>> = {}
let org: Record<string, unknown> = {}

async function call(
  handler: typeof crmTaskSaveHandler,
  options: { method?: string; body?: unknown; token?: string | null },
) {
  const { method = 'POST', body, token = 'good-token' } = options
  let status = 0
  let payload: any
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
    send: (value: unknown) => {
      payload = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  await handler(
    {
      method,
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )
  return { status, body: payload, headers }
}

const task = (over: Record<string, unknown> = {}) => ({
  title: 'Call back about the quote',
  kind: 'call',
  priority: 'normal',
  dueAtMs: null,
  assigneeUid: WRITER,
  notes: '',
  contactId: null,
  companyId: null,
  dealId: null,
  ...over,
})

const stored = (): Array<Record<string, any>> =>
  Object.entries(store)
    .filter(([path]) => path.startsWith(`${TASKS}/`))
    .map(([path, data]) => ({ id: path.slice(TASKS.length + 1), ...data }))

beforeEach(() => {
  store = {}
  autoId = 0
  org = {}
  roster = {
    [WRITER]: { role: 'editor' },
    [TEAMMATE]: { role: 'editor' },
  }
  verifyIdToken.mockReset().mockResolvedValue({ uid: WRITER })
  getOrgForHost
    .mockReset()
    .mockImplementation(async (hostId: string) =>
      hostId === FOREIGN_HOST ? { orgId: 'org-2', org: {} } : { orgId: ORG_ID, org },
    )
  getOrgDoc
    .mockReset()
    .mockImplementation(async (orgId: string) => (orgId === ORG_ID ? org : null))
  // An org-wide admin holding the permission, unless a test says otherwise.
  resolveOrgPermissions.mockReset().mockResolvedValue({
    orgId: ORG_ID,
    orgWide: true,
    role: 'admin',
    permissions: { 'data.manage': true },
  })
  resolveOrgMembership
    .mockReset()
    .mockImplementation(async (uid: string, orgId: string) =>
      roster[uid] ? { orgId, member: roster[uid] } : null,
    )
  memberHasOrgPermission.mockReset().mockResolvedValue(true)
  notifyUsers.mockReset().mockResolvedValue(undefined)
  emitHostEvent.mockReset().mockResolvedValue({ alerts: [] })
})

describe('crm/task-save', () => {
  it('answers only POST', async () => {
    const { status, headers } = await call(crmTaskSaveHandler, { method: 'GET' })
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
  })

  it('refuses a body with no site or no readable task before touching anything', async () => {
    expect((await call(crmTaskSaveHandler, { body: { task: task() } })).status).toBe(400)
    const untitled = await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task({ title: '  ' }) },
    })
    expect(untitled.status).toBe(400)
    expect(untitled.body).toEqual({ error: 'A task needs a title.' })
    expect(getOrgForHost).not.toHaveBeenCalled()
    expect(stored()).toEqual([])
  })

  it('refuses a caller with no token, and one whose role cannot write org data', async () => {
    const anonymous = await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task() },
      token: null,
    })
    expect(anonymous.status).toBe(401)

    roster[WRITER] = { role: 'viewer' }
    const viewer = await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task() },
    })
    expect(viewer.status).toBe(403)

    // The rules' other half: a writer role whose custom permission map has
    // revoked `data.manage` is refused too.
    roster[WRITER] = { role: 'editor' }
    memberHasOrgPermission.mockResolvedValue(false)
    const revoked = await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task() },
    })
    expect(revoked.status).toBe(403)
    expect(stored()).toEqual([])
  })

  it('creates a task in the site’s scope, stamped with provenance, telling nobody about a note to self', async () => {
    const { status, body } = await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task({ contactId: 'c-1', dueAtMs: 1757062800000 }) },
    })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, taskId: 'auto-1', notified: false })
    const [row] = stored()
    expect(row).toEqual({
      id: 'auto-1',
      title: 'Call back about the quote',
      kind: 'call',
      priority: 'normal',
      dueAtMs: 1757062800000,
      notes: '',
      assigneeUid: WRITER,
      contactId: 'c-1',
      status: 'open',
      completedAtMs: null,
      // An undeclared site is a group of one: this site's token alone.
      visibleTo: ['host:site-1'],
      hostId: HOST_ID,
      createdByUid: WRITER,
      createdAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP,
    })
    // Unset optionals are ABSENT, not null — the record cards' equality
    // queries and the "my tasks" view depend on it.
    expect('companyId' in row).toBe(false)
    expect('dealId' in row).toBe(false)
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('stamps the whole org when the org has widened its default scope', async () => {
    org = { defaultResourceScope: 'org' }
    await call(crmTaskSaveHandler, { body: { hostId: HOST_ID, task: task() } })
    expect(stored()[0]?.visibleTo).toEqual(['org'])
  })

  it('leaves an unassigned task with no assignee key at all', async () => {
    await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task({ assigneeUid: null }) },
    })
    expect('assigneeUid' in stored()[0]).toBe(false)
  })

  it('notifies a teammate the task is handed to, with a link to its record', async () => {
    const { body } = await call(crmTaskSaveHandler, {
      body: {
        hostId: HOST_ID,
        task: task({ assigneeUid: TEAMMATE, dealId: 'd-7', dueAtMs: 1757062800000 }),
      },
    })
    expect(body.notified).toBe(true)
    expect(notifyUsers).toHaveBeenCalledTimes(1)
    const [recipients, payload] = notifyUsers.mock.calls[0]
    expect(recipients).toEqual([TEAMMATE])
    expect(payload).toMatchObject({
      type: 'content.taskAssigned',
      title: 'Task assigned to you',
      link: `/${HOST_ID}/crm/deals/d-7`,
      orgId: ORG_ID,
      hostId: HOST_ID,
    })
    expect(payload.body).toMatch(/^Call back about the quote · due /)
  })

  it('links the notification to the tasks list when the task is about nobody', async () => {
    await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task({ assigneeUid: TEAMMATE }) },
    })
    expect(notifyUsers.mock.calls[0][1].link).toBe(`/${HOST_ID}/crm/tasks`)
  })

  it('refuses an assignee who is not on the roster, and writes nothing', async () => {
    const { status, body } = await call(crmTaskSaveHandler, {
      body: { hostId: HOST_ID, task: task({ assigneeUid: 'stranger-uid' }) },
    })
    expect(status).toBe(400)
    expect(body.error).toMatch(/not a member/)
    expect(stored()).toEqual([])
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  describe('updating', () => {
    beforeEach(() => {
      store[`${TASKS}/t-1`] = {
        title: 'Old title',
        kind: 'todo',
        priority: 'normal',
        dueAtMs: null,
        notes: '',
        assigneeUid: TEAMMATE,
        contactId: 'c-1',
        status: 'open',
        completedAtMs: null,
        visibleTo: ['host:site-1'],
        hostId: HOST_ID,
        createdByUid: 'somebody-else',
        createdAt: 'then',
        updatedAt: 'then',
      }
    })

    it('rewrites the editable fields and leaves scope and provenance alone', async () => {
      const { status, body } = await call(crmTaskSaveHandler, {
        body: {
          hostId: HOST_ID,
          taskId: 't-1',
          task: task({ title: 'New title', assigneeUid: TEAMMATE, contactId: null }),
        },
      })
      expect(status).toBe(200)
      expect(body).toEqual({ ok: true, taskId: 't-1', notified: false })
      const row = store[`${TASKS}/t-1`]
      expect(row.title).toBe('New title')
      expect(row.updatedAt).toBe(SERVER_TIMESTAMP)
      // A cleared link comes OFF the document rather than staying behind.
      expect('contactId' in row).toBe(false)
      expect(row.visibleTo).toEqual(['host:site-1'])
      expect(row.createdByUid).toBe('somebody-else')
      expect(row.createdAt).toBe('then')
      expect(row.status).toBe('open')
      // The same assignee is not told twice.
      expect(notifyUsers).not.toHaveBeenCalled()
    })

    it('notifies a NEW assignee and not the one who already had it', async () => {
      roster['third-uid'] = { role: 'editor' }
      await call(crmTaskSaveHandler, {
        body: { hostId: HOST_ID, taskId: 't-1', task: task({ assigneeUid: 'third-uid' }) },
      })
      expect(notifyUsers).toHaveBeenCalledTimes(1)
      expect(notifyUsers.mock.calls[0][0]).toEqual(['third-uid'])
    })

    it('answers 404 for a task that is gone', async () => {
      const { status } = await call(crmTaskSaveHandler, {
        body: { hostId: HOST_ID, taskId: 'nope', task: task() },
      })
      expect(status).toBe(404)
    })

    it('refuses a scoped member whose reach does not include the task', async () => {
      store[`${TASKS}/t-1`].visibleTo = ['host:site-2']
      roster[WRITER] = {
        role: 'editor',
        allHosts: false,
        hostAccess: { [HOST_ID]: 'editor' },
      }
      const { status } = await call(crmTaskSaveHandler, {
        body: { hostId: HOST_ID, taskId: 't-1', task: task() },
      })
      expect(status).toBe(403)
      expect(store[`${TASKS}/t-1`].title).toBe('Old title')
    })
  })
})

describe('crm/task-complete', () => {
  const open = () => {
    store[`${TASKS}/t-1`] = {
      title: 'Send the deck',
      kind: 'email',
      priority: 'high',
      dueAtMs: 1757062800000,
      notes: '',
      assigneeUid: TEAMMATE,
      dealId: 'd-7',
      status: 'open',
      completedAtMs: null,
      visibleTo: ['host:site-1'],
      hostId: 'site-origin',
      createdByUid: WRITER,
    }
  }

  it('answers only POST and needs both ids', async () => {
    expect((await call(crmTaskCompleteHandler, { method: 'GET' })).status).toBe(405)
    expect(
      (await call(crmTaskCompleteHandler, { body: { hostId: HOST_ID } })).status,
    ).toBe(400)
    expect(
      (await call(crmTaskCompleteHandler, { body: { hostId: HOST_ID, taskId: 't-1' }, token: null }))
        .status,
    ).toBe(401)
    expect(
      (await call(crmTaskCompleteHandler, { body: { hostId: HOST_ID, taskId: 't-1' } })).status,
    ).toBe(404)
  })

  it('marks the task done and fires taskCompleted with a filterable payload', async () => {
    open()
    const before = Date.now()
    const { status, body } = await call(crmTaskCompleteHandler, {
      body: { hostId: HOST_ID, taskId: 't-1' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.alreadyDone).toBeUndefined()
    expect(body.completedAtMs).toBeGreaterThanOrEqual(before)
    const row = store[`${TASKS}/t-1`]
    expect(row).toMatchObject({
      status: 'done',
      completedAtMs: body.completedAtMs,
      completedByUid: WRITER,
      updatedAt: SERVER_TIMESTAMP,
    })
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
    // On the site whose console ticked the box, not the site that created it.
    expect(emitHostEvent.mock.calls[0][0]).toBe(HOST_ID)
    expect(emitHostEvent.mock.calls[0][1]).toBe('taskCompleted')
    expect(emitHostEvent.mock.calls[0][2]).toEqual({
      taskId: 't-1',
      title: 'Send the deck',
      kind: 'email',
      priority: 'high',
      dueAtMs: 1757062800000,
      completedAtMs: body.completedAtMs,
      completedByUid: WRITER,
      assigneeUid: TEAMMATE,
      createdByUid: WRITER,
      // Absent links are empty strings, so `contactId != ""` is a filter a
      // workflow can write without knowing whether the key exists.
      contactId: '',
      companyId: '',
      dealId: 'd-7',
      taskHostId: 'site-origin',
    })
  })

  it('is idempotent: a second tick writes nothing and fires nothing', async () => {
    open()
    store[`${TASKS}/t-1`].status = 'done'
    store[`${TASKS}/t-1`].completedAtMs = 1234
    const snapshot = { ...store[`${TASKS}/t-1`] }
    const { status, body } = await call(crmTaskCompleteHandler, {
      body: { hostId: HOST_ID, taskId: 't-1' },
    })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, completedAtMs: 1234, alreadyDone: true })
    expect(store[`${TASKS}/t-1`]).toEqual(snapshot)
    expect(emitHostEvent).not.toHaveBeenCalled()
  })

  it('refuses a scoped member whose reach does not include the task', async () => {
    open()
    store[`${TASKS}/t-1`].visibleTo = ['host:site-2']
    roster[WRITER] = { role: 'editor', allHosts: false, hostAccess: { [HOST_ID]: 'editor' } }
    const { status } = await call(crmTaskCompleteHandler, {
      body: { hostId: HOST_ID, taskId: 't-1' },
    })
    expect(status).toBe(403)
    expect(store[`${TASKS}/t-1`].status).toBe('open')
    expect(emitHostEvent).not.toHaveBeenCalled()
  })

  it('lets staff complete a task without a membership', async () => {
    open()
    verifyIdToken.mockResolvedValue({ uid: 'staff-uid', staff: true })
    roster = {}
    const { status } = await call(crmTaskCompleteHandler, {
      body: { hostId: HOST_ID, taskId: 't-1' },
    })
    expect(status).toBe(200)
    expect(store[`${TASKS}/t-1`].completedByUid).toBe('staff-uid')
  })
})

/**
 * THE ORGANIZATION VARIANT (AGL-2637): `orgId` in the body instead of a
 * site. Authorized by the org — an org-wide member holding `data.manage`,
 * never a site collaborator — with no reach check against the task, since
 * an org-wide member reads every row. A new task names the site it is
 * filed from beside the org, or none and is the organization's own; a
 * completion emits on the task's OWN site, and an organization task emits
 * nothing. The batch forms answer each task on their own.
 */
describe('crm/task-save at the organization level (AGL-2637)', () => {
  it('refuses a site-scoped member, and an org-wide one without data.manage, writing nothing', async () => {
    resolveOrgPermissions.mockResolvedValue({
      orgId: ORG_ID,
      orgWide: false,
      role: 'editor',
      permissions: { 'data.manage': true },
    })
    const scoped = await call(crmTaskSaveHandler, { body: { orgId: ORG_ID, task: task() } })
    expect(scoped.status).toBe(403)
    resolveOrgPermissions.mockResolvedValue({
      orgId: ORG_ID,
      orgWide: true,
      role: 'admin',
      permissions: { 'data.manage': false },
    })
    const revoked = await call(crmTaskSaveHandler, { body: { orgId: ORG_ID, task: task() } })
    expect(revoked.status).toBe(403)
    expect(stored()).toEqual([])
    // The site path was never consulted: no site, no site role.
    expect(getOrgForHost).not.toHaveBeenCalled()
  })

  it('creates an ORGANIZATION task — no site, the org token alone — and links its notification to the org hub', async () => {
    const { status, body } = await call(crmTaskSaveHandler, {
      body: { orgId: ORG_ID, task: task({ assigneeUid: TEAMMATE, contactId: 'c-1' }) },
    })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, taskId: 'auto-1', notified: true })
    const [row] = stored()
    expect(row).toMatchObject({
      hostId: null,
      visibleTo: ['org'],
      createdByUid: WRITER,
      status: 'open',
      contactId: 'c-1',
    })
    const [recipients, payload] = notifyUsers.mock.calls[0]
    expect(recipients).toEqual([TEAMMATE])
    // The `/org` shape the console rewrites onto the organization's hub,
    // and no `hostId` on the notification, because there is none.
    expect(payload.link).toBe('/org/crm/contacts/c-1')
    expect(payload.orgId).toBe(ORG_ID)
    expect('hostId' in payload).toBe(false)
  })

  it("files a task from a site named beside the org, stamped as that site's console would", async () => {
    // No membership on the roster at all: the org variant reads the org
    // gate, not a site role.
    roster = { [TEAMMATE]: { role: 'editor' } }
    const { status } = await call(crmTaskSaveHandler, {
      body: { orgId: ORG_ID, hostId: HOST_ID, task: task({ assigneeUid: TEAMMATE }) },
    })
    expect(status).toBe(200)
    expect(stored()[0]).toMatchObject({ hostId: HOST_ID, visibleTo: ['host:site-1'] })
    const payload = notifyUsers.mock.calls[0][1]
    expect(payload.link).toBe(`/${HOST_ID}/crm/tasks`)
    expect(payload.hostId).toBe(HOST_ID)
  })

  it("refuses a site that is not the organization's own, and writes nothing", async () => {
    const { status, body } = await call(crmTaskSaveHandler, {
      body: { orgId: ORG_ID, hostId: FOREIGN_HOST, task: task() },
    })
    expect(status).toBe(400)
    expect(body.error).toMatch(/not one of this organization/)
    expect(stored()).toEqual([])
  })

  describe('updating', () => {
    beforeEach(() => {
      roster['third-uid'] = { role: 'editor' }
      store[`${TASKS}/t-1`] = {
        title: 'Old title',
        kind: 'todo',
        priority: 'normal',
        dueAtMs: null,
        notes: '',
        assigneeUid: TEAMMATE,
        status: 'open',
        completedAtMs: null,
        // A site the org-level caller holds no site role on.
        visibleTo: ['host:site-2'],
        hostId: 'site-2',
        createdByUid: 'somebody-else',
      }
      store[`${TASKS}/t-org`] = {
        title: 'Renew the insurance',
        kind: 'todo',
        priority: 'normal',
        dueAtMs: null,
        notes: '',
        status: 'open',
        completedAtMs: null,
        visibleTo: ['org'],
        hostId: null,
        createdByUid: WRITER,
      }
    })

    it("rewrites a task whatever site captured it, and links a new assignee to the task's OWN site", async () => {
      const { status } = await call(crmTaskSaveHandler, {
        body: {
          orgId: ORG_ID,
          taskId: 't-1',
          task: task({ title: 'New title', assigneeUid: 'third-uid' }),
        },
      })
      expect(status).toBe(200)
      const row = store[`${TASKS}/t-1`]
      expect(row.title).toBe('New title')
      expect(row.visibleTo).toEqual(['host:site-2'])
      expect(row.hostId).toBe('site-2')
      const payload = notifyUsers.mock.calls[0][1]
      expect(payload.link).toBe('/site-2/crm/tasks')
      expect(payload.hostId).toBe('site-2')
    })

    it('links a new assignee of an organization task to the org hub', async () => {
      await call(crmTaskSaveHandler, {
        body: { orgId: ORG_ID, taskId: 't-org', task: task({ assigneeUid: 'third-uid' }) },
      })
      const payload = notifyUsers.mock.calls[0][1]
      expect(payload.link).toBe('/org/crm/tasks')
      expect('hostId' in payload).toBe(false)
    })

    it('saves a batch in one request, answering each task on its own, asking the roster once', async () => {
      const { status, body } = await call(crmTaskSaveHandler, {
        body: {
          orgId: ORG_ID,
          tasks: [
            { taskId: 't-1', task: task({ assigneeUid: 'third-uid' }) },
            { taskId: 'gone', task: task({ assigneeUid: 'third-uid' }) },
            { taskId: 't-org', task: task({ assigneeUid: 'third-uid' }) },
          ],
        },
      })
      expect(status).toBe(200)
      expect(body).toEqual({
        ok: true,
        results: [
          { taskId: 't-1', ok: true, notified: true },
          { taskId: 'gone', ok: false, error: 'That task no longer exists.' },
          { taskId: 't-org', ok: true, notified: true },
        ],
      })
      expect(store[`${TASKS}/t-1`].assigneeUid).toBe('third-uid')
      expect(store[`${TASKS}/t-org`].assigneeUid).toBe('third-uid')
      // One roster question for one assignee across three tasks.
      expect(resolveOrgMembership).toHaveBeenCalledTimes(1)
      expect(notifyUsers).toHaveBeenCalledTimes(2)
    })

    it('refuses a batch under a site, an empty one, one beyond the cap, and one with an unreadable entry — whole', async () => {
      const entry = { taskId: 't-1', task: task({ title: 'Touched' }) }
      expect(
        (await call(crmTaskSaveHandler, { body: { hostId: HOST_ID, tasks: [entry] } })).status,
      ).toBe(400)
      expect((await call(crmTaskSaveHandler, { body: { orgId: ORG_ID, tasks: [] } })).status).toBe(
        400,
      )
      expect(
        (
          await call(crmTaskSaveHandler, {
            body: { orgId: ORG_ID, tasks: Array.from({ length: 201 }, () => entry) },
          })
        ).status,
      ).toBe(400)
      const unreadable = await call(crmTaskSaveHandler, {
        body: { orgId: ORG_ID, tasks: [entry, { taskId: 't-org', task: task({ title: ' ' }) }] },
      })
      expect(unreadable.status).toBe(400)
      expect(unreadable.body).toEqual({ error: 'A task needs a title.' })
      expect(store[`${TASKS}/t-1`].title).toBe('Old title')
    })
  })
})

describe('crm/task-complete at the organization level (AGL-2637)', () => {
  const open = (id: string, over: Record<string, unknown> = {}) => {
    store[`${TASKS}/${id}`] = {
      title: 'Send the deck',
      kind: 'email',
      priority: 'high',
      dueAtMs: 1757062800000,
      notes: '',
      assigneeUid: TEAMMATE,
      status: 'open',
      completedAtMs: null,
      visibleTo: ['host:site-origin'],
      hostId: 'site-origin',
      createdByUid: WRITER,
      ...over,
    }
  }

  it("completes a task from the org hub, emitting on the task's OWN site", async () => {
    open('t-1')
    const { status, body } = await call(crmTaskCompleteHandler, {
      body: { orgId: ORG_ID, taskId: 't-1' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(store[`${TASKS}/t-1`]).toMatchObject({ status: 'done', completedByUid: WRITER })
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
    expect(emitHostEvent.mock.calls[0][0]).toBe('site-origin')
    expect(emitHostEvent.mock.calls[0][2]).toMatchObject({ taskId: 't-1', taskHostId: 'site-origin' })
  })

  it('completes an ORGANIZATION task with no event to emit — there is no site', async () => {
    open('t-org', { hostId: null, visibleTo: ['org'] })
    const { status } = await call(crmTaskCompleteHandler, {
      body: { orgId: ORG_ID, taskId: 't-org' },
    })
    expect(status).toBe(200)
    expect(store[`${TASKS}/t-org`].status).toBe('done')
    expect(emitHostEvent).not.toHaveBeenCalled()
  })

  it('refuses a site-scoped member, writing nothing', async () => {
    open('t-1')
    resolveOrgPermissions.mockResolvedValue({
      orgId: ORG_ID,
      orgWide: false,
      role: 'editor',
      permissions: { 'data.manage': true },
    })
    const { status } = await call(crmTaskCompleteHandler, {
      body: { orgId: ORG_ID, taskId: 't-1' },
    })
    expect(status).toBe(403)
    expect(store[`${TASKS}/t-1`].status).toBe('open')
    expect(emitHostEvent).not.toHaveBeenCalled()
  })

  it('completes a batch in one request: each answered, a done one as alreadyDone, a missing one refused', async () => {
    open('t-1')
    open('t-2', { status: 'done', completedAtMs: 1234 })
    open('t-org', { hostId: null, visibleTo: ['org'] })
    const { status, body } = await call(crmTaskCompleteHandler, {
      body: { orgId: ORG_ID, taskIds: ['t-1', 't-2', 'gone', 't-org', 't-1'] },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    // Deduplicated: five ids, four answers, in order.
    expect(body.results.map((row: { taskId: string }) => row.taskId)).toEqual([
      't-1',
      't-2',
      'gone',
      't-org',
    ])
    expect(body.results[0]).toMatchObject({ ok: true })
    expect(body.results[1]).toEqual({ taskId: 't-2', ok: true, completedAtMs: 1234, alreadyDone: true })
    expect(body.results[2]).toEqual({ taskId: 'gone', ok: false, error: 'That task no longer exists.' })
    expect(body.results[3]).toMatchObject({ ok: true })
    expect(store[`${TASKS}/t-1`].status).toBe('done')
    expect(store[`${TASKS}/t-org`].status).toBe('done')
    // One event: the site task's, on its site. The org task has none.
    expect(emitHostEvent).toHaveBeenCalledTimes(1)
    expect(emitHostEvent.mock.calls[0][0]).toBe('site-origin')
  })

  it('refuses a batch under a site, an empty one, and one beyond the cap', async () => {
    open('t-1')
    expect(
      (await call(crmTaskCompleteHandler, { body: { hostId: HOST_ID, taskIds: ['t-1'] } })).status,
    ).toBe(400)
    expect(
      (await call(crmTaskCompleteHandler, { body: { orgId: ORG_ID, taskIds: [] } })).status,
    ).toBe(400)
    expect(
      (
        await call(crmTaskCompleteHandler, {
          body: { orgId: ORG_ID, taskIds: Array.from({ length: 201 }, (_, i) => `t-${i}`) },
        })
      ).status,
    ).toBe(400)
    expect(store[`${TASKS}/t-1`].status).toBe('open')
  })
})
