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
 * `crm.deals`, `crm.tasks`, `crm.leads` and the exported-only resources
 * (AGL-3528) through the real job engine: a file imported twice updates
 * its deals and tasks rather than duplicating them; links resolve by contact
 * email, company domain or name, and deal; a lead is filed through the
 * capture door, never Qualified by a file; and activities, pipelines and
 * custom fields export and refuse an import.
 *
 * Firestore is the in-memory store every hook and the engine share; the
 * lead door is a double that keys the person and files them under the
 * site, as `addHostLead` does (its own rules are its own specs').
 */

const mockMemory = (
  jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')
).memoryFirestore()
const mockLeadDoor: Array<Record<string, unknown>> = []

jest.mock('firebase-admin/firestore', () =>
  (jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')).memoryFirestoreModule,
)

jest.mock('@aglyn/tenant-data-admin/server/org-containers', () => ({
  __esModule: true,
  listOrgContainers: async () => [
    { id: 'cmp-spring', exists: true, live: true, name: 'Spring push', visibleTo: ['host:site-1'] },
  ],
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const people = jest.requireActual('@aglyn/aglyn/app-utils/person-key')
  return {
    __esModule: true,
    firebaseAdmin: { app: () => ({ firestore: () => mockMemory.firestore }) },
    listOrgMembers: async () => [{ $id: 'uid-sam', email: 'sam@agency.test', displayName: 'Sam Owner' }],
    crmRecordsQuotaForOrg: async () => ({ crmRecordsCount: 0 }),
    restampCrmListFieldsOf: async () => ({ restamped: 0, current: 0, missing: 0 }),
    restampCrmListFieldsAt: async () => undefined,
    // The lead door, as far as a transfer depends on it: one document per
    // person, filed under the capturing site, `import` among its sources.
    addHostLeadOutcome: async (options: { hostId: string; lead: { email: string; name?: string; source: string } }) => {
      mockLeadDoor.push(options.lead)
      const key = people.personKey(options.lead.email)
      const ref = mockMemory.firestore.collection('orgs').doc('org-1').collection('leads').doc(key)
      const existing = await ref.get()
      if (existing.exists) {
        await ref.update({ sources: [...new Set([...(existing.get('sources') ?? []), options.lead.source])] })
        return { stored: true, created: false, sourceAdded: true }
      }
      await ref.set({
        email: options.lead.email,
        ...(options.lead.name ? { name: options.lead.name } : {}),
        status: 'new',
        sources: [options.lead.source],
        visibleTo: [`host:${options.hostId}`],
        capturedByHostIds: [options.hostId],
      })
      return { stored: true, created: true, sourceAdded: true }
    },
  }
})

import type { TransferWarningClass } from '@aglyn/aglyn/data-transfer'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import {
  resetTransferResourcesForTests,
  resolveTransferResource,
  transferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  analyzeTransferJob,
  applyTransferJob,
  planTransferJob,
  TransferEngineError,
  uploadTransferSource,
  type TransferBucket,
  type TransferEngineDeps,
} from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { streamTransferExport } from '@aglyn/tenant-data-admin/server/transfer-export'
import { registerCrmTransferResources } from './register'

const ORG = 'org-1'
const SITE = 'site-1'
const ME = 'uid-me'
const SITE_TOKENS = [hostScopeToken(SITE)]
const at = (collection: string, id = '') => `orgs/${ORG}/${collection}${id ? `/${id}` : ''}`

const files = new Map<string, Buffer>()
const bucket: TransferBucket = {
  file: (path) => ({
    save: async (data) => void files.set(path, Buffer.from(data)),
    download: async () => [files.get(path) as Buffer],
    delete: async () => void files.delete(path),
  }),
}
const deps: TransferEngineDeps = { firestore: mockMemory.firestore, bucket, now: () => Date.now() }

const docsIn = (collection: string) =>
  [...mockMemory.docs.entries()]
    .filter(([path]) => path.startsWith(`${at(collection)}/`) && !path.slice(at(collection).length + 1).includes('/'))
    .map(([path, data]) => ({ id: path.split('/').pop() as string, data }))

beforeEach(() => {
  mockMemory.docs.clear()
  files.clear()
  mockLeadDoor.length = 0
  mockMemory.seed(`orgs/${ORG}`, { plan: 'starter' })
  mockMemory.seed(at('pipelines', 'sales'), {
    name: 'Sales',
    isDefault: true,
    visibleTo: ['org'],
    stages: [
      { id: 'qualify', name: 'Qualify', order: 0, probability: 10, kind: 'open' },
      { id: 'proposal', name: 'Proposal', order: 1, probability: 60, kind: 'open', forecastCategory: 'bestCase' },
      { id: 'won', name: 'Closed Won', order: 2, probability: 100, kind: 'won' },
    ],
  })
  mockMemory.seed(at('contacts', 'ana'), { email: 'ana@acme.com', name: 'Ana', visibleTo: SITE_TOKENS })
  mockMemory.seed(at('companies', 'acme'), { name: 'Acme', nameLower: 'acme', domain: 'acme.com', visibleTo: SITE_TOKENS })
  resetTransferResourcesForTests()
  registerCrmTransferResources('crm')
})

/** Upload, read and plan one file, then apply it; answers the plan and the results. */
async function imported(resource: string, content: string, choices: Record<string, unknown> = {}) {
  const { job } = await uploadTransferSource(deps, { orgId: ORG, actorUid: ME, resource, hostId: SITE, fileName: 'file.csv', content })
  const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
  const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping, ...choices } })
  const applied = await applyTransferJob(deps, {
    orgId: ORG,
    jobId: job.id,
    actorUid: ME,
    acknowledged: plan.acknowledgementsRequired as TransferWarningClass[],
    deadlineMs: Date.now() + 120_000,
    driver: 'spec',
  })
  return { plan, applied, mapping: match.mapping }
}

describe('deals', () => {
  const FILE = [
    'Opportunity Name,Opportunity ID,Stage,Amount,Close Date,Account Name,Contact Email,Opportunity Owner,Contact Roles',
    'Acme renewal,SF-1,Proposal,"$12,500.00",2026-11-30,Acme,ana@acme.com,Sam Owner,ana@acme.com (Decision Maker)',
    'Globex pilot,SF-2,,900,,Globex,,sam@agency.test,',
  ].join('\n')

  it('files each row in its stage, links the contact and company, and updates rather than duplicates on a second import', async () => {
    const first = await imported('crm.deals', FILE, { lookupChoices: { company: { globex: { action: 'create' } } } })
    expect(first.mapping).toMatchObject({ 0: 'title', 1: 'externalId', 2: 'stage', 3: 'amount', 4: 'expectedClose', 5: 'company', 6: 'contact', 7: 'owner' })
    expect(first.applied.results.map((result) => result.outcome)).toEqual(['created', 'created'])
    const deals = docsIn('deals')
    expect(deals).toHaveLength(2)
    const acme = deals.find((deal) => deal.data['externalId'] === 'SF-1')?.data
    expect(acme).toMatchObject({
      title: 'Acme renewal',
      pipelineId: 'sales',
      stageId: 'proposal',
      status: 'open',
      forecastCategory: 'bestCase',
      amountCents: 1_250_000,
      currency: 'usd',
      companyId: 'acme',
      companyName: 'Acme',
      contactId: 'ana',
      ownerUid: 'uid-sam',
      visibleTo: SITE_TOKENS,
      hostId: SITE,
      contactRoles: [{ contactId: 'ana', role: 'Decision Maker', primary: true }],
    })
    // No stage named: the default pipeline's first open stage.
    expect(deals.find((deal) => deal.data['externalId'] === 'SF-2')?.data).toMatchObject({ stageId: 'qualify' })

    // The same file again, a figure changed: two updates, still two deals.
    const second = await imported('crm.deals', FILE.replace('"$12,500.00"', '"$15,000.00"'), {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(second.plan.summary).toMatchObject({ update: 1, unchanged: 1, create: 0 })
    expect(docsIn('deals')).toHaveLength(2)
    expect(docsIn('deals').find((deal) => deal.data['externalId'] === 'SF-1')?.data['amountCents']).toBe(1_500_000)
  })

  it('never moves a matched deal’s stage from a file, and fails a row naming a stage the pipeline lacks', async () => {
    await imported('crm.deals', FILE, { lookupChoices: { company: { globex: { action: 'leaveBlank' } } } })
    const moved = await imported('crm.deals', 'Opportunity ID,Opportunity Name,Stage\nSF-1,Acme renewal,Closed Won\nSF-9,New,Nowhere', {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(moved.plan.rows.rows.find((row) => row.index === 0)?.verdict).toBe('unchanged')
    expect(moved.applied.results.find((result) => result.row === 1)).toMatchObject({
      outcome: 'failed',
      message: '“Sales” has no stage called “Nowhere”.',
    })
    expect(docsIn('deals').find((deal) => deal.data['externalId'] === 'SF-1')?.data['stageId']).toBe('proposal')
  })
})

describe('tasks', () => {
  it('links the contact by email and the deal by name, closes a completed task, and finds it again by its id', async () => {
    mockMemory.seed(at('deals', 'd-acme'), { title: 'Acme renewal', titleLower: 'acme renewal', visibleTo: SITE_TOKENS })
    const file = 'Subject,Task ID,Status,Priority,Due Date,Contact Email,Opportunity Name\nCall Ana,T-1,Completed,High,2026-11-01,ana@acme.com,Acme renewal'
    const first = await imported('crm.tasks', file)
    expect(first.applied.results.map((result) => result.outcome)).toEqual(['created'])
    const task = docsIn('crmTasks')[0]?.data
    expect(task).toMatchObject({
      title: 'Call Ana',
      externalId: 'T-1',
      status: 'done',
      statusLabel: 'Completed',
      priority: 'high',
      contactId: 'ana',
      dealId: 'd-acme',
      visibleTo: SITE_TOKENS,
      completedByUid: ME,
    })
    expect(typeof task?.['completedAtMs']).toBe('number')
    const again = await imported('crm.tasks', file.replace('Call Ana', 'Call Ana back'), {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(again.plan.summary).toMatchObject({ update: 1, create: 0 })
    expect(docsIn('crmTasks')).toHaveLength(1)
    expect(docsIn('crmTasks')[0]?.data['title']).toBe('Call Ana back')
  })
})

describe('leads', () => {
  it('files a lead through the capture door, with its campaign and custom field, and never Qualified by a file', async () => {
    mockMemory.seed(at('contactFields', 'f1'), { key: 'budget', label: 'Budget', type: 'number', order: 0, object: 'lead', visibleTo: ['org'] })
    const file = 'Email,First Name,Last Name,Company,Lead Status,Campaigns,Budget\nbo@globex.test,Bo,Ray,Globex,Qualified,Spring push,5000\ncy@initech.test,Cy,,Initech,Working,Autumn,'
    const { plan, applied } = await imported('crm.leads', file, {
      // "Autumn" is no campaign of the organization's: the person refuses that row.
      picklistChoices: { campaigns: { autumn: { action: 'refuseRow' } } },
    })
    // Qualified is a conversion's to set: held back and acknowledged.
    expect(plan.rows.rows[0]?.heldBack).toContain('status')
    expect(mockLeadDoor.map((lead) => lead.email)).toEqual(['bo@globex.test'])
    expect(applied.results.map((result) => result.outcome)).toEqual(['created', 'failed'])
    const lead = mockMemory.read(at('leads', personKey('bo@globex.test') as string))
    expect(lead).toMatchObject({
      email: 'bo@globex.test',
      name: 'Bo Ray',
      firstName: 'Bo',
      company: 'Globex',
      status: 'new',
      campaignIds: ['cmp-spring'],
      custom: { budget: 5000 },
      sources: ['import'],
    })
  })
})

describe('what is only exported', () => {
  it('writes the activities, each pipeline’s stages and the custom fields, and refuses a file for any of them', async () => {
    mockMemory.seed(at('crmActivities', 'a1'), {
      kind: 'call',
      body: 'Talked pricing',
      atMs: Date.UTC(2026, 9, 1),
      byUid: 'uid-sam',
      contactId: 'ana',
      visibleTo: SITE_TOKENS,
    })
    mockMemory.seed(at('contactFields', 'f1'), { key: 'region', label: 'Region', type: 'select', options: ['EMEA', 'APAC'], order: 1, object: 'company', visibleTo: ['org'] })
    const ctx = (resource: string) => ({ resource, orgId: ORG, hostId: SITE, actorUid: ME })
    const read = async (resource: string, fieldIds: string[]) =>
      (await transferRecordsHooks(await resolveTransferResource(resource)).readPage(ctx(resource), null, fieldIds, {})).rows

    expect(await read('crm.activities', ['kind', 'body', 'by', 'contact', 'at'])).toEqual([
      { kind: 'Call', body: 'Talked pricing', by: 'sam@agency.test', contact: 'ana@acme.com', at: '2026-10-01T00:00:00.000Z' },
    ])
    expect(await read('crm.pipelines', ['pipeline', 'stage', 'position', 'kind', 'forecastCategory'])).toEqual([
      { pipeline: 'Sales', stage: 'Qualify', position: 1, kind: 'Open', forecastCategory: 'Pipeline' },
      { pipeline: 'Sales', stage: 'Proposal', position: 2, kind: 'Open', forecastCategory: 'Best Case' },
      { pipeline: 'Sales', stage: 'Closed Won', position: 3, kind: 'Won', forecastCategory: 'Closed' },
    ])
    expect(await read('crm.fields', ['label', 'key', 'object', 'type', 'options'])).toEqual([
      { label: 'Region', key: 'region', object: 'Companies', type: 'Dropdown', options: ['EMEA', 'APAC'] },
    ])
    for (const resource of ['crm.activities', 'crm.pipelines', 'crm.fields']) {
      const refused = await uploadTransferSource(deps, {
        orgId: ORG, actorUid: ME, resource, hostId: SITE, fileName: 'x.csv', content: 'a\n1',
      }).catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(TransferEngineError)
      expect((refused as TransferEngineError).message).toMatch(/are exported, not imported\.$/)
    }
  })
})

/*
 * SETTINGS → PRIVACY'S PEOPLE FILES (AGL-3552). Every contact and every lead
 * a workspace holds is exported on every plan, Free included: the plan is
 * asked of an import (`requireCrmSuite`), never of the export, which reads
 * the whole workspace for a reader who sees all of it.
 */
describe('the people files, on Free', () => {
  // The export streams through web streams, which this suite's DOM environment lacks.
  beforeAll(() => {
    const web = jest.requireActual('node:stream/web') as typeof import('node:stream/web')
    const util = jest.requireActual('node:util') as typeof import('node:util')
    Object.assign(globalThis, {
      ReadableStream: globalThis.ReadableStream ?? web.ReadableStream,
      TextEncoder: globalThis.TextEncoder ?? util.TextEncoder,
      TextDecoder: globalThis.TextDecoder ?? util.TextDecoder,
    })
  })

  const text = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return out + decoder.decode()
      out += decoder.decode(value, { stream: true })
    }
  }
  const exported = async (resource: string, fieldIds: string[]) => {
    const file = await streamTransferExport(deps, {
      orgId: ORG,
      actorUid: ME,
      resource,
      hostId: null,
      fieldIds,
      scope: { kind: 'all' },
      format: 'csv',
      bom: false,
    })
    return { rows: file.rows, lines: (await text(file.stream)).trim().split(/\r?\n/) }
  }

  it('writes every contact and every lead of the workspace, each capture surface by name', async () => {
    mockMemory.seed(`orgs/${ORG}`, { plan: 'free' })
    mockMemory.seed(at('contacts', 'bo'), { email: 'bo@other.test', name: 'Bo', visibleTo: ['host:site-2'] })
    mockMemory.seed(at('leads', 'cy'), {
      email: 'cy@initech.test',
      status: 'new',
      sources: ['signup', 'form:contact', 'manual'],
      visibleTo: SITE_TOKENS,
    })
    mockMemory.seed(at('leads', 'di'), { email: 'di@other.test', status: 'working', source: 'booking', visibleTo: ['host:site-2'] })

    const contacts = await exported('crm.contacts', ['email'])
    expect(contacts.rows).toBe(2)
    expect(contacts.lines.slice(1).sort()).toEqual(['ana@acme.com', 'bo@other.test'])

    const leads = await exported('crm.leads', ['email', 'sources'])
    expect(leads.rows).toBe(2)
    expect(leads.lines.slice(1).sort()).toEqual(['cy@initech.test,Sign-up; Form contact; Added by hand', 'di@other.test,Booking'])
  })
})
