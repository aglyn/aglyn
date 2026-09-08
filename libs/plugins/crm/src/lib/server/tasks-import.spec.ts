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
 * `crm/tasks-import` (AGL-2662): who may call it, how an assignee is
 * resolved and a stranger refused per row, and what each row becomes —
 * the task-save route's own document shape, in one batch per chunk.
 */

let decodedToken: Record<string, unknown> = { uid: 'editor-uid' }
let hostRoles: Record<string, string> = { 'editor-uid': 'editor' }
let membership: { orgId: string; member: Record<string, unknown> } | null = {
  orgId: 'org-1',
  member: { $id: 'editor-uid', role: 'editor' },
}
let manageData = true
let members: Record<string, unknown>[] = []
let written: Record<string, unknown>[] = []
let commits = 0
const listMembers = jest.fn(async () => members)

const ORG_ID = 'org-1'
const HOST_ID = 'site-1'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm-task-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/crm'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/consent-groups'),
}))

let taskSeq = 0
const firestoreHandle = {
  collection: (name: string) => ({
    doc: (id: string) => {
      if (name === 'hosts') {
        return {
          get: async () => ({
            exists: id === HOST_ID,
            get: (key: string) => (key === 'memberRoles' ? hostRoles : undefined),
          }),
        }
      }
      if (name === 'orgs') {
        return {
          collection: (sub: string) => {
            if (sub !== 'crmTasks') throw new Error(`unexpected collection ${sub}`)
            return {
              doc: () => {
                taskSeq += 1
                return { id: `task-${taskSeq}` }
              },
            }
          },
        }
      }
      throw new Error(`unexpected doc ${name}/${id}`)
    },
  }),
  batch: () => {
    const staged: Record<string, unknown>[] = []
    return {
      set: (_ref: unknown, data: Record<string, unknown>) => void staged.push(data),
      commit: async () => {
        commits += 1
        written.push(...staged)
      },
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  memberHasOrgPermission: async () => manageData,
  listOrgMembers: (...args: unknown[]) => listMembers(...(args as [])),
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
}))

import { crmTasksImportHandler } from './tasks-import'

async function drive(
  body: unknown,
  options: { method?: string; headers?: Record<string, string> } = {},
) {
  const out: { code: number; body: any; headers: Record<string, unknown> } = {
    code: 0,
    body: undefined,
    headers: {},
  }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
    setHeader(name: string, value: unknown) {
      out.headers[name] = value
    },
  }
  await crmTasksImportHandler(
    {
      method: options.method ?? 'POST',
      body,
      rawBody: JSON.stringify(body ?? ''),
      headers: options.headers ?? { authorization: 'Bearer token' },
      query: {},
      cookies: {},
      socket: {},
    } as any,
    res,
  )
  return out
}

const importRows = (rows: unknown[]) => drive({ hostId: HOST_ID, rows })

beforeEach(() => {
  decodedToken = { uid: 'editor-uid' }
  hostRoles = { 'editor-uid': 'editor' }
  membership = { orgId: ORG_ID, member: { $id: 'editor-uid', role: 'editor' } }
  manageData = true
  members = []
  written = []
  commits = 0
  taskSeq = 0
  listMembers.mockClear()
})

describe('the request shape and the gates', () => {
  it('answers only POST, and refuses a malformed batch before reading anything', async () => {
    const out = await drive({ hostId: HOST_ID, rows: [{}] }, { method: 'GET' })
    expect(out.code).toBe(405)
    expect(out.headers['Allow']).toBe('POST')
    expect((await importRows([])).code).toBe(400)
  })

  it('needs a bearer token, a site role, and data.manage', async () => {
    expect((await drive({ hostId: HOST_ID, rows: [{ title: 'x' }] }, { headers: {} })).code).toBe(401)
    hostRoles = {}
    expect((await importRows([{ title: 'x' }])).code).toBe(403)
    hostRoles = { 'editor-uid': 'editor' }
    manageData = false
    expect((await importRows([{ title: 'x' }])).code).toBe(403)
    expect(written).toEqual([])
  })
})

describe('what a row becomes', () => {
  it('writes the task-save shape with the assignee by address, in one batch', async () => {
    members = [{ $id: 'ada-uid', email: 'Ada@Example.com' }]
    const out = await importRows([
      {
        title: ' Call  Maya ',
        kind: 'Call',
        priority: 'High',
        due: '2026-09-30',
        assigneeEmail: 'ada@example.com',
        notes: 'Renewal',
      },
      { title: 'Bare' },
    ])
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ received: 2, created: 2, merged: 0, skipped: [], ownersUnresolved: [] })
    expect(commits).toBe(1)
    expect(written[0]).toMatchObject({
      title: 'Call Maya',
      kind: 'call',
      priority: 'high',
      status: 'open',
      dueAtMs: Date.UTC(2026, 8, 30, 12),
      completedAtMs: null,
      assigneeUid: 'ada-uid',
      notes: 'Renewal',
      visibleTo: ['host:site-1'],
      hostId: HOST_ID,
      createdByUid: 'editor-uid',
      createdAt: '__serverTimestamp',
    })
    // The optional ids and the assignee are absent, never null; the due date is null.
    expect(written[1]).toMatchObject({ kind: 'todo', priority: 'normal', dueAtMs: null, notes: '' })
    expect('assigneeUid' in written[1]).toBe(false)
    expect('contactId' in written[1]).toBe(false)
  })

  it('stamps a done row as completed by the importer', async () => {
    const out = await importRows([{ title: 'Old one', status: 'done' }])
    expect(out.body.created).toBe(1)
    expect(written[0]).toMatchObject({ status: 'done', completedByUid: 'editor-uid' })
    expect(typeof written[0]['completedAtMs']).toBe('number')
  })

  it('refuses, by name, a row whose assignee is nobody on the team, and reads the roster once', async () => {
    members = [{ $id: 'ada-uid', email: 'ada@example.com' }]
    const out = await importRows([
      { title: 'A', assigneeEmail: 'ghost@example.com' },
      { title: 'B', assigneeEmail: 'ada@example.com' },
      { kind: 'call' },
    ])
    expect(out.body.skipped).toEqual([
      { index: 0, title: 'A', reason: 'unknown-assignee' },
      { index: 2, title: '', reason: 'missing-title' },
    ])
    expect(out.body.created).toBe(1)
    expect(written.map((task) => task['title'])).toEqual(['B'])
    expect(listMembers).toHaveBeenCalledTimes(1)
  })

  it('costs no roster read for a file with no assignee column, and tallies dropped cells', async () => {
    const out = await importRows([{ title: 'A', kind: 'lunch', due: 'soon' }])
    expect(listMembers).not.toHaveBeenCalled()
    expect(out.body.dropped).toEqual({ kind: 1, due: 1 })
  })
})
