/**
 * @jest-environment node
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
 * The CRM's writer on the record-timeline seam (AGL-2981), against a
 * path-keyed store: what it writes, under which id, with which scope, and
 * what it refuses before it writes anything.
 */

type Data = Record<string, unknown>

const mockDocs = new Map<string, Data>()
let mockActivityCount = 0
const mockRecompute = jest.fn(async (..._args: unknown[]) => ({ records: 1, missing: 0 }))

function mockDocRef(path: string): Record<string, unknown> {
  const id = path.split('/').pop() as string
  return {
    id,
    path,
    get: async () => ({ id, exists: mockDocs.has(path), data: () => mockDocs.get(path), get: (field: string) => mockDocs.get(path)?.[field] }),
    create: async (data: Data) => {
      if (mockDocs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      mockDocs.set(path, data)
    },
    set: async (data: Data) => void mockDocs.set(path, data),
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
  }
}

function mockCollectionRef(path: string) {
  return { doc: (id: string) => mockDocRef(`${path}/${id}`) }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  const activity = jest.requireActual('@aglyn/tenant-data-admin/server/crm-email-activity')
  return {
    __esModule: true,
    // The real ids: the capture address's `cap_` scheme is what makes a copy
    // of the same email the same row.
    crmActivityRef: activity.crmActivityRef,
    crmCapturedEmailActivityRef: activity.crmCapturedEmailActivityRef,
    createCrmEmailActivity: activity.createCrmEmailActivity,
    countCrmActivitiesForRecord: jest.fn(async () => mockActivityCount),
    recomputeCrmNextTaskAt: (...args: unknown[]) => mockRecompute(...args),
    firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  }
})

import {
  pluginRecordTimelineWriter,
  type PluginRecordActivityRequest,
  type PluginRecordTaskRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { CRM_ACTIVITY_LOG_FULL_MESSAGE, crmCapturedEmailKey } from '@aglyn/aglyn/server'
import { crmCapturedEmailActivityRef } from '@aglyn/tenant-data-admin/server/crm-email-activity'
import { createCrmRecordTimelineWriter, registerCrmRecordTimelineWriter } from './record-timeline'

const ORG = 'org-1'
const HOST = 'host-1'

function seedOrg(extra: Data = {}) {
  mockDocs.set(`orgs/${ORG}`, {
    plan: 'pro',
    billingStatus: 'active',
    consentGroups: { g1: { name: 'Main', hostIds: [HOST, 'host-2'] } },
    ...extra,
  })
}

const writer = createCrmRecordTimelineWriter({ firestore: () => mockFirestore as never })

const INBOUND: PluginRecordActivityRequest = {
  orgId: ORG,
  hostId: HOST,
  link: { contactId: 'contact-1', companyId: 'company-1' },
  sourcePluginId: 'outreach',
  kind: 'email',
  atMs: 1_750_000_000_000,
  body: 'Thanks — can we talk Thursday?',
  byUid: '',
  email: {
    direction: 'inbound',
    subject: 'Re: A quick question',
    from: 'pat@example.com',
    to: 'rep@example.org',
    messageId: '<reply-1@mail.example.com>',
    inReplyTo: '<sent-1@example.org>',
  },
}

const TASK: PluginRecordTaskRequest = {
  orgId: ORG,
  hostId: HOST,
  link: { contactId: 'contact-1' },
  sourcePluginId: 'outreach',
  dedupeKey: 'reply:<reply-1@mail.example.com>',
  title: 'Reply from Pat Example',
  kind: 'email',
  dueAtMs: 1_750_000_000_000,
  assigneeUid: 'uid-rep',
  createdByUid: '',
}

beforeEach(() => {
  mockDocs.clear()
  mockActivityCount = 0
  mockRecompute.mockClear()
  seedOrg()
})

describe('the CRM on the record-timeline seam (AGL-2981)', () => {
  it('registers as the workspace record system', () => {
    resetPluginServicesForTests()
    registerCrmRecordTimelineWriter({ firestore: () => mockFirestore as never })
    expect(pluginRecordTimelineWriter()?.pluginId).toBe('crm')
  })

  it("files an email under the capture address's id for its Message-ID, scoped like a record of the site", async () => {
    const result = await writer.logActivity(INBOUND)
    const ref = crmCapturedEmailActivityRef(
      mockFirestore as never,
      ORG,
      String(crmCapturedEmailKey(INBOUND.email?.messageId, null)),
    )
    expect(result).toEqual({ ok: true, id: ref.id, created: true })
    expect(ref.id).toMatch(/^cap_[0-9a-f]{28}$/)
    expect(mockDocs.get(ref.path)).toMatchObject({
      kind: 'email',
      direction: 'inbound',
      subject: 'Re: A quick question',
      body: 'Thanks — can we talk Thursday?',
      from: 'pat@example.com',
      messageId: '<reply-1@mail.example.com>',
      inReplyTo: '<sent-1@example.org>',
      contactId: 'contact-1',
      companyId: 'company-1',
      hostId: HOST,
      visibleTo: ['host:host-1', 'host:host-2'],
      sourcePluginId: 'outreach',
    })
  })

  it('files the same message once, however many times it is asked', async () => {
    await writer.logActivity(INBOUND)
    const again = await writer.logActivity({ ...INBOUND, body: 'a second read' })
    expect(again).toMatchObject({ ok: true, created: false })
    expect([...mockDocs.keys()].filter((key) => key.includes('/crmActivities/'))).toHaveLength(1)
  })

  it('stamps the org scope when the workspace widened its default', async () => {
    seedOrg({ defaultResourceScope: 'org' })
    await writer.logActivity(INBOUND)
    const row = [...mockDocs.entries()].find(([key]) => key.includes('/crmActivities/'))?.[1]
    expect(row?.['visibleTo']).toEqual(['org'])
  })

  it("files a non-email entry under the caller's own key, namespaced by its plugin", async () => {
    const first = await writer.logActivity({
      ...INBOUND,
      kind: 'note',
      email: null,
      body: 'Sequence finished.',
      dedupeKey: 'finished:enrollment-1',
    })
    const second = await writer.logActivity({
      ...INBOUND,
      kind: 'note',
      email: null,
      body: 'Sequence finished.',
      dedupeKey: 'finished:enrollment-1',
    })
    expect(first).toMatchObject({ ok: true, created: true })
    expect(second).toEqual({ ok: true, id: (first as { id: string }).id, created: false })
    expect((first as { id: string }).id).toMatch(/^plg_[0-9a-f]{28}$/)
  })

  it('refuses before writing: a Free workspace, a full log, no record, no key', async () => {
    seedOrg({ plan: 'free' })
    expect(await writer.logActivity(INBOUND)).toMatchObject({ ok: false, status: 403 })
    seedOrg()
    mockActivityCount = 5_000
    expect(await writer.logActivity(INBOUND)).toEqual({ ok: false, status: 409, error: CRM_ACTIVITY_LOG_FULL_MESSAGE })
    mockActivityCount = 0
    expect(await writer.logActivity({ ...INBOUND, link: {} })).toMatchObject({ ok: false, status: 400 })
    expect(await writer.logActivity({ ...INBOUND, kind: 'note', email: null, dedupeKey: ' ' })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(await writer.logActivity({ ...INBOUND, orgId: 'org-gone' })).toMatchObject({ ok: false, status: 404 })
    expect([...mockDocs.keys()].some((key) => key.includes('/crmActivities/'))).toBe(false)
  })

  it('creates a task once per key, for its assignee, reminding at its due time', async () => {
    const first = await writer.createTask(TASK)
    const again = await writer.createTask({ ...TASK, title: 'Changed' })
    expect(first).toMatchObject({ ok: true, created: true })
    expect(again).toEqual({ ok: true, id: (first as { id: string }).id, created: false })
    const task = mockDocs.get(`orgs/${ORG}/crmTasks/${(first as { id: string }).id}`)
    expect(task).toMatchObject({
      title: 'Reply from Pat Example',
      kind: 'email',
      priority: 'normal',
      status: 'open',
      dueAtMs: TASK.dueAtMs,
      remindAtMs: TASK.dueAtMs,
      assigneeUid: 'uid-rep',
      createdByUid: '',
      sourcePluginId: 'outreach',
      contactId: 'contact-1',
      hostId: HOST,
      visibleTo: ['host:host-1', 'host:host-2'],
    })
    // The records it names learn their next task once, for the one it made.
    expect(mockRecompute).toHaveBeenCalledTimes(1)
    expect(mockRecompute).toHaveBeenCalledWith(mockFirestore, ORG, [{ contactId: 'contact-1' }])
  })

  it('refuses a task with no title, an unknown kind, or no due time', async () => {
    expect(await writer.createTask({ ...TASK, title: '  ' })).toMatchObject({ ok: false, status: 400 })
    expect(await writer.createTask({ ...TASK, kind: 'linkedin' as never })).toMatchObject({ ok: false, status: 400 })
    expect(await writer.createTask({ ...TASK, dueAtMs: Number.NaN })).toMatchObject({ ok: false, status: 400 })
    expect([...mockDocs.keys()].some((key) => key.includes('/crmTasks/'))).toBe(false)
  })
})
