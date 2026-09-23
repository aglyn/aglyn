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
 * What a `workflow` job reads (AGL-2919): the site's own records, each read
 * as a projection of the fields a lookup needs, in the Actions editor's
 * windows, and scoped to the site where the org's records are shared among
 * sites. A run is read as the run history shows it — never its payload.
 */

const mockReads: Array<{ path: string; fields: string[]; limit: number | null; scopedTo: string | null }> = []
const mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  scopedToHost: (ref: { scope: (hostId: string) => unknown }, hostId: string) => ref.scope(hostId),
}))

import {
  AI_WORKFLOW_PIPELINES_WINDOW,
  AI_WORKFLOW_RECORDS_WINDOW,
  readAiAutomationRecords,
  readAiWorkflowFunctions,
  readAiWorkflowRun,
  readAiWorkflowTarget,
} from './ai-workflow-records'

// ── Firestore double ─────────────────────────────────────────────────────

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function queryOf(path: string, state: { fields: string[]; limit: number | null; scopedTo: string | null }) {
  const query = {
    scope: (hostId: string) => queryOf(path, { ...state, scopedTo: hostId }),
    select: (...fields: string[]) => queryOf(path, { ...state, fields }),
    limit: (limit: number) => queryOf(path, { ...state, limit }),
    get: async () => {
      mockReads.push({ path, ...state })
      const docs = [...mockDocs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshotOf)
      return { docs }
    },
  }
  return query
}

function docRef(path: string): Record<string, unknown> {
  return {
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  return { doc: (id: string) => docRef(`${path}/${id}`), ...queryOf(path, { fields: [], limit: null, scopedTo: null }) }
}

const firestore = { collection: (name: string) => collectionRef(name) } as unknown as FirebaseFirestore.Firestore

const readOf = (path: string) => mockReads.find((read) => read.path === path)

beforeEach(() => {
  mockReads.length = 0
  mockDocs.clear()
})

describe('readAiAutomationRecords', () => {
  beforeEach(() => {
    mockDocs.set('hosts/host-1/forms/form-a', {
      displayName: 'Newsletter sign-up',
      fields: [{ fieldName: 'email' }, { fieldName: ' firstName ' }, { label: 'No name' }],
    })
    mockDocs.set('hosts/host-1/forms/form-b', { slug: 'quote', fields: 'not a list' })
    mockDocs.set('hosts/host-1/forms/form-c', { displayName: 'Retired', archivedAt: 1_700_000_000_000 })
    mockDocs.set('orgs/org-1/datasets/ds-a', { displayName: 'Leads' })
    mockDocs.set('orgs/org-1/datasets/ds-b', { name: 'Old', deletedAt: 1 })
    mockDocs.set('orgs/org-1/lists/list-a', { name: 'Newsletter' })
    mockDocs.set('orgs/org-1/lists/list-b', { name: '  ' })
    mockDocs.set('orgs/org-1/lists/list-c', { name: 'Gone', deletedAt: 5 })
    // The org's containers: one on every site, one placed here, one placed
    // only on a sibling, one placed nowhere, one deleted — and a leftover
    // at the retired site path, which is not read.
    mockDocs.set('orgs/org-1/emailCampaigns/cmp-a', { name: 'Spring sale', visibleTo: ['org'] })
    mockDocs.set('orgs/org-1/emailCampaigns/cmp-b', { name: 'Site push', visibleTo: ['host:host-1'] })
    mockDocs.set('orgs/org-1/emailCampaigns/cmp-c', { name: 'Sibling push', visibleTo: ['host:host-2'] })
    mockDocs.set('orgs/org-1/emailCampaigns/cmp-d', { name: 'Unplaced' })
    mockDocs.set('orgs/org-1/emailCampaigns/cmp-e', { name: 'Gone', visibleTo: ['org'], deletedAt: 1 })
    mockDocs.set('hosts/host-1/emailCampaigns/cmp-old', { name: 'Stale site copy' })
    mockDocs.set('orgs/org-1/campaigns/send-a', { name: 'A single email send' })
    mockDocs.set('hosts/host-1/workflows/wf-a', { name: 'Quote calculator' })
    mockDocs.set('hosts/host-1/webhooks/hook-a', { name: 'Zapier', direction: 'outbound' })
    mockDocs.set('hosts/host-1/webhooks/hook-b', { name: 'Stripe in', direction: 'inbound' })
    mockDocs.set('orgs/org-1/pipelines/p-a', {
      stages: [{ id: 'new', name: 'New' }, { id: 'won', name: 'Won' }, { id: 'nameless' }],
    })
    mockDocs.set('orgs/org-1/pipelines/p-b', { stages: [{ id: 'old', name: 'Old stage' }], archivedAt: 1_700_000_000_000 })
  })

  it('reads the records a draft’s words are looked up among, leaving out what is archived, deleted or unnamed', async () => {
    expect(await readAiAutomationRecords(firestore, { orgId: 'org-1', hostId: 'host-1', crm: true })).toEqual({
      forms: [
        { id: 'form-a', name: 'Newsletter sign-up', fields: ['email', 'firstName'] },
        { id: 'form-b', name: 'quote', fields: [] },
      ],
      datasets: [{ id: 'ds-a', name: 'Leads' }],
      lists: [{ id: 'list-a', name: 'Newsletter' }],
      // The campaign containers an Assign step runs against here — live and
      // placed on this site — not the email sends beside them.
      campaigns: [
        { id: 'cmp-a', name: 'Spring sale' },
        { id: 'cmp-b', name: 'Site push' },
      ],
      workflows: [{ id: 'wf-a', name: 'Quote calculator' }],
      webhooks: [{ id: 'hook-a', name: 'Zapier' }],
      stages: [
        { id: 'new', name: 'New' },
        { id: 'won', name: 'Won' },
      ],
    })
    expect(readOf('orgs/org-1/campaigns')).toBeUndefined()
    expect(readOf('hosts/host-1/emailCampaigns')).toBeUndefined()
  })

  it('reads each as a projection, in the editor’s window, scoped to the site where the org shares them', async () => {
    await readAiAutomationRecords(firestore, { orgId: 'org-1', hostId: 'host-1', crm: true })
    expect(mockReads.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      {
        path: 'hosts/host-1/forms',
        fields: ['displayName', 'slug', 'fields', 'archivedAt'],
        limit: AI_WORKFLOW_RECORDS_WINDOW,
        scopedTo: null,
      },
      {
        path: 'hosts/host-1/webhooks',
        fields: ['name', 'direction', 'deletedAt'],
        limit: AI_WORKFLOW_RECORDS_WINDOW,
        scopedTo: null,
      },
      { path: 'hosts/host-1/workflows', fields: ['name', 'deletedAt'], limit: AI_WORKFLOW_RECORDS_WINDOW, scopedTo: null },
      {
        path: 'orgs/org-1/datasets',
        fields: ['displayName', 'name', 'deletedAt'],
        limit: AI_WORKFLOW_RECORDS_WINDOW,
        scopedTo: 'host-1',
      },
      // Campaign containers are the org's; placement narrows them in memory.
      {
        path: 'orgs/org-1/emailCampaigns',
        fields: ['name', 'deletedAt', 'visibleTo'],
        limit: AI_WORKFLOW_RECORDS_WINDOW,
        scopedTo: null,
      },
      // Lists belong to the whole org, as the editor's picker and the executor read them.
      { path: 'orgs/org-1/lists', fields: ['name', 'deletedAt'], limit: AI_WORKFLOW_RECORDS_WINDOW, scopedTo: null },
      {
        path: 'orgs/org-1/pipelines',
        fields: ['stages', 'archivedAt'],
        limit: AI_WORKFLOW_PIPELINES_WINDOW,
        scopedTo: 'host-1',
      },
    ])
  })

  it('reads only the kinds asked for, and answers every other kind empty', async () => {
    const records = await readAiAutomationRecords(firestore, {
      orgId: 'org-1',
      hostId: 'host-1',
      crm: true,
      only: ['lists', 'webhooks'],
    })
    expect(records).toEqual({
      forms: [],
      datasets: [],
      lists: [{ id: 'list-a', name: 'Newsletter' }],
      campaigns: [],
      workflows: [],
      webhooks: [{ id: 'hook-a', name: 'Zapier' }],
      stages: [],
    })
    expect(mockReads.map((read) => read.path).sort()).toEqual(['hosts/host-1/webhooks', 'orgs/org-1/lists'])
    await readAiAutomationRecords(firestore, { orgId: 'org-1', hostId: 'host-1', crm: true, only: [] })
    expect(mockReads).toHaveLength(2)
  })

  it('reads no pipeline for a workspace without the CRM', async () => {
    const records = await readAiAutomationRecords(firestore, { orgId: 'org-1', hostId: 'host-1', crm: false })
    expect(records.stages).toEqual([])
    expect(readOf('orgs/org-1/pipelines')).toBeUndefined()
  })
})

describe('readAiWorkflowFunctions', () => {
  it('reads the site’s live functions by name', async () => {
    mockDocs.set('hosts/host-1/functions/fn-a', { name: 'rateFor' })
    mockDocs.set('hosts/host-1/functions/fn-b', { name: 'retired', deletedAt: 3 })
    expect(await readAiWorkflowFunctions(firestore, 'host-1')).toEqual([{ id: 'fn-a', name: 'rateFor' }])
    expect(readOf('hosts/host-1/functions')).toEqual({
      path: 'hosts/host-1/functions',
      fields: ['name', 'deletedAt'],
      limit: AI_WORKFLOW_RECORDS_WINDOW,
      scopedTo: null,
    })
  })
})

describe('readAiWorkflowTarget', () => {
  it('reads a saved action or workflow of the site, and nothing that is gone', async () => {
    mockDocs.set('hosts/host-1/actions/act-1', { name: 'Welcome', trigger: { event: 'lead' }, steps: [] })
    mockDocs.set('hosts/host-1/actions/act-2', { trigger: { event: 'lead' }, steps: [] })
    mockDocs.set('hosts/host-1/actions/act-3', { name: 'Deleted', deletedAt: 9 })
    mockDocs.set('hosts/host-1/workflows/wf-1', { name: 'Quote', steps: [] })
    expect(await readAiWorkflowTarget(firestore, { hostId: 'host-1', type: 'action', id: 'act-1' })).toEqual({
      type: 'action',
      id: 'act-1',
      name: 'Welcome',
      action: { name: 'Welcome', trigger: { event: 'lead' }, steps: [] },
    })
    expect((await readAiWorkflowTarget(firestore, { hostId: 'host-1', type: 'action', id: 'act-2' }))?.name).toBe('act-2')
    expect(await readAiWorkflowTarget(firestore, { hostId: 'host-1', type: 'action', id: 'act-3' })).toBeNull()
    expect(await readAiWorkflowTarget(firestore, { hostId: 'host-1', type: 'action', id: 'wf-1' })).toBeNull()
    expect(await readAiWorkflowTarget(firestore, { hostId: 'host-1', type: 'workflow', id: 'wf-1' })).toEqual({
      type: 'workflow',
      id: 'wf-1',
      name: 'Quote',
      workflow: { name: 'Quote', steps: [] },
    })
  })
})

describe('readAiWorkflowRun', () => {
  const read = (runId: string) => readAiWorkflowRun(firestore, { hostId: 'host-1', targetId: 'act-1', runId })

  it('reads a failed run of the automation as the run history shows it, never the event’s payload', async () => {
    mockDocs.set('hosts/host-1/activity/run-1', {
      action: 'Action ran on lead with errors: unknown list "Old list"',
      trigger: 'lead',
      summary: 'enrolled nobody',
      createdAt: 1,
      target: { type: 'action', id: 'act-1', name: 'Welcome' },
      payload: { message: 'what a visitor typed' },
      uid: 'uid-visitor',
    })
    expect(await read('run-1')).toEqual({
      ok: true,
      run: {
        result: undefined,
        trigger: 'lead',
        summary: 'enrolled nobody',
        action: 'Action ran on lead with errors: unknown list "Old list"',
        createdAt: 1,
      },
    })
  })

  it('finds no run that is missing or belongs to another automation, and refuses one that did not fail', async () => {
    mockDocs.set('hosts/host-1/activity/run-2', { result: 'failed', target: { id: 'act-9' } })
    mockDocs.set('hosts/host-1/activity/run-3', { result: 'succeeded', target: { id: 'act-1' } })
    mockDocs.set('hosts/host-1/activity/run-4', { action: 'Action ran on lead', target: { id: 'act-1' } })
    expect(await read('run-missing')).toEqual({ ok: false, reason: 'gone' })
    expect(await read('run-2')).toEqual({ ok: false, reason: 'gone' })
    expect(await read('run-3')).toEqual({ ok: false, reason: 'not-failed' })
    expect(await read('run-4')).toEqual({ ok: false, reason: 'not-failed' })
  })
})
