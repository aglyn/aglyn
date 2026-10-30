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
 * The CRM's setup writers (AGL-3746), against the real model and plan
 * table: only the store, the site's org and the member are doubles.
 *
 *  - THE REFUSAL is the rules': the CRM in the plan, an owner, admin or
 *    editor not suspended, `data.manage`, and a scope the member reaches.
 *  - THE WRITE is the console's document, and asked again it makes nothing
 *    twice: under the attempt key, and by name.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  memberHasOrgPermission: jest.fn(),
  resolveOrgIdForHost: jest.fn(),
  resolveOrgMembership: jest.fn(),
}))
jest.mock('firebase-admin/firestore', () => ({ __esModule: true, FieldPath: { documentId: () => '__name__' } }))
jest.mock('./suite-gate', () => ({
  __esModule: true,
  crmSuiteRefusalMessage: (act: string) => `${act} is part of the CRM, which is not included in your current plan.`,
}))

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { type CrmDealStage, effectiveCrmPicklist } from '@aglyn/aglyn/app-utils/crm'
import type { PluginDraftRequest } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { CrmFieldDefinitionDoc } from '../model/crm-setup-content'
import type { PipelineDoc } from '../model/deal-board-model'
import {
  CRM_SETUP_FIELD_SCOPE_REFUSAL,
  CRM_SETUP_PERMISSION_REFUSAL,
  CRM_SETUP_PICKLIST_SCOPE_REFUSAL,
  CRM_SETUP_ROLE_REFUSAL,
  CRM_SETUP_SCOPE_REFUSAL,
  type CrmSetupMember,
  type CrmSetupStore,
  createCrmFieldSetupWriter,
  createCrmPicklistValuesSetupWriter,
  createCrmPipelineSetupWriter,
} from './crm-setup-writers.server'

const NOW = new Date('2026-10-12T15:00:00.000Z')
const ORG = { plan: 'pro', subscriptionStatus: 'active' }

// ── Store double ─────────────────────────────────────────────────────────

let pipelines: Map<string, PipelineDoc>
let fields: Map<string, CrmFieldDefinitionDoc>
let writes: number
let member: CrmSetupMember | null
let picklists: Map<string, Record<string, unknown>>
let regrouped: Array<{ object: string; label: string; group: string | null }>

const store: CrmSetupStore = {
  pipelines: async (_orgId, tokens) =>
    [...pipelines.values()].filter((one) => (one.visibleTo ?? []).some((token) => tokens.includes(token))),
  pipeline: async (_orgId, id) => pipelines.get(id) ?? null,
  savePipeline: async (_orgId, write, now) => {
    writes += 1
    if (write.create) pipelines.set(write.id, { ...(write.create as unknown as PipelineDoc), $id: write.id })
    if (write.update) pipelines.set(write.id, { ...(pipelines.get(write.id) as PipelineDoc), ...write.update, updatedAt: now } as PipelineDoc)
    for (const id of write.defaultsOff) pipelines.set(id, { ...(pipelines.get(id) as PipelineDoc), isDefault: false })
  },
  fields: async () => [...fields.values()],
  field: async (_orgId, id) => fields.get(id) ?? null,
  createField: async (_orgId, id, document) => {
    writes += 1
    fields.set(id, { ...(document as unknown as CrmFieldDefinitionDoc), $id: id })
  },
  setFieldOptions: async (_orgId, id, options) => {
    writes += 1
    fields.set(id, { ...(fields.get(id) as CrmFieldDefinitionDoc), options })
  },
  picklist: async (_orgId, id) => picklists.get(id) ?? null,
  changePicklist: async (_orgId, id, change, stamp) => {
    const stored = picklists.get(id) ?? null
    const { write, result } = change(stored)
    if (write) {
      writes += 1
      picklists.set(id, { ...(stored ?? { hostId: stamp.hostId, visibleTo: ['org'] }), ...write })
    }
    return result
  },
  regroup: async (_orgId, object, _target, label, group) => {
    regrouped.push({ object, label, group })
    return 1
  },
}

const deps = {
  store,
  orgIdForHost: async (hostId: string) => (hostId === 'h1' ? 'o1' : null),
  member: async () => member,
}

function request(id: string, content: Record<string, unknown>, extra: Partial<PluginDraftRequest> = {}): PluginDraftRequest {
  return { orgId: 'o1', hostId: 'h1', uid: 'u1', org: ORG, now: NOW, id, name: 'item', content, ...extra }
}

beforeEach(() => {
  pipelines = new Map()
  fields = new Map()
  picklists = new Map()
  regrouped = []
  writes = 0
  member = { role: 'editor', canManageData: true, member: { role: 'editor', allHosts: true } }
})

describe('who may set up the CRM', () => {
  const writer = createCrmPipelineSetupWriter(deps)
  const context = { orgId: 'o1', hostId: 'h1', uid: 'u1', org: ORG, now: NOW }

  it('admits an org-wide editor with data.manage on a plan carrying the CRM', async () => {
    expect(checkEntitlement(ORG as never, 'crm')).toBe(true)
    await expect(writer.refusal(context)).resolves.toBeNull()
  })

  it('refuses another org’s site, a Free plan, a viewer, a suspended member, and no data.manage', async () => {
    await expect(writer.refusal({ ...context, hostId: 'elsewhere' })).resolves.toEqual({ status: 404, error: 'Unknown site' })
    await expect(writer.refusal({ ...context, org: { plan: 'free' } })).resolves.toMatchObject({ status: 403 })
    member = { role: 'viewer', canManageData: true, member: { role: 'viewer', allHosts: true } }
    await expect(writer.refusal(context)).resolves.toEqual({ status: 403, error: CRM_SETUP_ROLE_REFUSAL })
    member = { role: 'admin', canManageData: true, member: { role: 'admin', orgSuspended: true } }
    await expect(writer.refusal(context)).resolves.toEqual({ status: 403, error: CRM_SETUP_ROLE_REFUSAL })
    member = { role: 'editor', canManageData: false, member: { role: 'editor', allHosts: true } }
    await expect(writer.refusal(context)).resolves.toEqual({ status: 403, error: CRM_SETUP_PERMISSION_REFUSAL })
  })

  it('refuses a member whose sites do not reach the scope, and an org-wide field to a site collaborator', async () => {
    member = { role: 'editor', canManageData: true, member: { role: 'editor', allHosts: false, hostAccess: { other: 'editor' }, scopeTokens: ['host:other'] } }
    await expect(writer.refusal(context)).resolves.toEqual({ status: 403, error: CRM_SETUP_SCOPE_REFUSAL })
    member = { role: 'editor', canManageData: true, member: { role: 'editor', allHosts: false, hostAccess: { h1: 'editor' }, scopeTokens: ['host:h1'] } }
    await expect(createCrmFieldSetupWriter(deps).refusal(context)).resolves.toEqual({
      status: 403,
      error: CRM_SETUP_FIELD_SCOPE_REFUSAL,
    })
  })
})

describe('the crm-pipeline writer', () => {
  const writer = createCrmPipelineSetupWriter(deps)
  const ask = { name: 'Agency sales', stages: ['Discovery', 'Proposal', 'Negotiation'], wonStage: 'Won', lostStage: 'Lost' }

  it('creates the pipeline under the attempt key, as the first one the default', async () => {
    const written = await writer.write(request('job-i0', ask))
    expect(written).toMatchObject({
      ok: true,
      replayed: false,
      id: 'job-i0',
      name: 'Agency sales',
      facts: { stages: ['Discovery (25%)', 'Proposal (50%)', 'Negotiation (75%)'], wonStage: 'Won', lostStage: 'Lost' },
    })
    // An org that never chose shares its records with every site, so the
    // pipeline is stamped org-wide; the site it came from is its provenance.
    expect(pipelines.get('job-i0')).toMatchObject({ isDefault: true, visibleTo: ['org'], hostId: 'h1', createdByUid: 'u1' })
    await expect(writer.read({ hostId: 'h1', id: 'job-i0' })).resolves.toMatchObject({ id: 'job-i0', name: 'Agency sales' })
  })

  it('asked again — under the same key or another — makes nothing twice', async () => {
    await writer.write(request('job-i0', ask))
    await expect(writer.write(request('job-i0', ask))).resolves.toMatchObject({ ok: true, replayed: true, id: 'job-i0' })
    await expect(writer.write(request('job2-i0', { ...ask, name: 'AGENCY SALES' }))).resolves.toMatchObject({
      ok: true,
      replayed: true,
      id: 'job-i0',
      name: 'Agency sales',
    })
    expect(pipelines.size).toBe(1)
    expect(writes).toBe(1)
  })

  it('adds a stage to an existing pipeline and keeps the ones it was not told about', async () => {
    pipelines.set('default', {
      $id: 'default',
      name: 'Sales',
      isDefault: true,
      archivedAt: null,
      visibleTo: ['org'],
      stages: [
        { id: 'new', name: 'New', order: 0, probability: 10, kind: 'open', forecastCategory: 'pipeline' },
        { id: 'won', name: 'Closed Won', order: 1, probability: 100, kind: 'won', forecastCategory: 'closed' },
        { id: 'lost', name: 'Closed Lost', order: 2, probability: 0, kind: 'lost', forecastCategory: 'omitted' },
      ],
    } as PipelineDoc)
    const written = await writer.write(request('job-i1', { name: 'sales', stages: ['Nurturing (5%)', 'New'] }))
    expect(written).toMatchObject({ ok: true, id: 'default', replayed: false })
    const stages = pipelines.get('default')?.stages as CrmDealStage[]
    expect(stages.map((stage) => stage.id)).toEqual(['nurturing', 'new', 'won', 'lost'])
    expect(pipelines.get('default')?.name).toBe('Sales')
  })

  it('returns a refusal and a bad ask as refusals, never throwing', async () => {
    await expect(writer.write(request('j', { stages: ['A'] }))).resolves.toEqual({ ok: false, status: 400, error: 'A pipeline needs a name.' })
    pipelines.set('p2', { $id: 'p2', name: 'Partners', stages: [], archivedAt: null, visibleTo: ['org'] } as unknown as PipelineDoc)
    pipelines.set('p1', { $id: 'p1', name: 'Sales', stages: [], archivedAt: null, visibleTo: ['org'] } as unknown as PipelineDoc)
    await expect(writer.write(request('j', { name: 'Partners', renameFrom: 'Sales' }))).resolves.toMatchObject({ ok: false, status: 409 })
    member = null
    await expect(writer.write(request('j', ask))).resolves.toEqual({ ok: false, status: 403, error: CRM_SETUP_ROLE_REFUSAL })
    expect(writes).toBe(0)
  })
})

describe('the crm-field writer', () => {
  const writer = createCrmFieldSetupWriter(deps)
  const budget = { object: 'deal', label: 'Budget', type: 'number' }

  it('creates the field under the attempt key, and asked again makes nothing', async () => {
    await expect(writer.write(request('job-i0', budget))).resolves.toMatchObject({
      ok: true,
      replayed: false,
      id: 'job-i0',
      name: 'Budget',
      facts: { object: 'deal', key: 'budget', type: 'number' },
    })
    expect(fields.get('job-i0')).toMatchObject({ order: 0, retiredAt: null, visibleTo: ['org'], hostId: 'h1', object: 'deal' })
    await expect(writer.write(request('job-i0', budget))).resolves.toMatchObject({ replayed: true, id: 'job-i0' })
    await expect(writer.write(request('job2-i0', { ...budget, label: 'BUDGET' }))).resolves.toMatchObject({ replayed: true, id: 'job-i0' })
    expect(fields.size).toBe(1)
    expect(writes).toBe(1)
  })

  it('gives an existing Choice field the choices it lacks', async () => {
    fields.set('tier', { $id: 'tier', key: 'tier', label: 'Tier', type: 'select', options: ['Gold'], order: 0, object: 'lead' } as CrmFieldDefinitionDoc)
    await expect(
      writer.write(request('j', { object: 'lead', label: 'Tier', type: 'select', options: ['Gold', 'Silver'] })),
    ).resolves.toMatchObject({ ok: true, replayed: false, id: 'tier', facts: { options: ['Gold', 'Silver'] } })
  })

  it('refuses a type the CRM does not have', async () => {
    await expect(writer.write(request('j', { ...budget, type: 'money' }))).resolves.toMatchObject({ ok: false, status: 400 })
  })
})

describe('the crm-picklist-values writer (AGL-3756)', () => {
  const writer = createCrmPicklistValuesSetupWriter(deps)
  const context = { orgId: 'o1', hostId: 'h1', uid: 'u1', org: ORG, now: NOW }

  it('is gated as the Fields page is, org-wide', async () => {
    await expect(writer.refusal(context)).resolves.toBeNull()
    await expect(writer.refusal({ ...context, org: { plan: 'free' } })).resolves.toMatchObject({ status: 403 })
    member = { role: 'viewer', canManageData: true, member: { role: 'viewer', allHosts: true } }
    await expect(writer.refusal(context)).resolves.toEqual({ status: 403, error: CRM_SETUP_ROLE_REFUSAL })
    member = { role: 'editor', canManageData: true, member: { role: 'editor', allHosts: false, hostAccess: { h1: 'editor' }, scopeTokens: ['host:h1'] } }
    await expect(writer.refusal(context)).resolves.toEqual({ status: 403, error: CRM_SETUP_PICKLIST_SCOPE_REFUSAL })
    await expect(writer.write(request('j', { list: 'opportunityType', values: ['Renewal'] }))).resolves.toEqual({
      ok: false,
      status: 403,
      error: CRM_SETUP_PICKLIST_SCOPE_REFUSAL,
    })
    expect(writes).toBe(0)
  })

  it('adds a deal type at the end, stamped org-wide, and adds nothing asked again', async () => {
    const first = await writer.write(request('j1', { list: 'opportunityType', values: ['Renewal', 'new business'] }))
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      id: 'opportunityType',
      name: 'Type (Deals)',
      facts: { added: ['Renewal'], existing: ['New Business'], inactive: [] },
    })
    const stored = effectiveCrmPicklist('opportunityType', picklists.get('opportunityType'))
    expect(stored.values.map((one) => one.label)).toEqual(['Existing Business', 'New Business', 'Renewal'])
    expect(picklists.get('opportunityType')).toMatchObject({ hostId: 'h1', visibleTo: ['org'] })
    const again = await writer.write(request('j2', { list: 'opportunityType', values: ['RENEWAL'] }))
    expect(again).toMatchObject({ ok: true, replayed: true, facts: { added: [], existing: ['Renewal'] } })
    expect(writes).toBe(1)
    await expect(writer.read({ hostId: 'h1', id: 'opportunityType' })).resolves.toMatchObject({
      facts: { values: ['Existing Business', 'New Business', 'Renewal'] },
    })
  })

  it('adds a lead status under its meaning, and finds Nurturing already standard', async () => {
    const written = await writer.write(request('j', { list: 'leadStatus', values: ['Nurturing', 'Contacted'], meaning: 'Working' }))
    expect(written).toMatchObject({ ok: true, facts: { added: ['Contacted'], existing: ['Nurturing'] } })
    const contacted = effectiveCrmPicklist('leadStatus', picklists.get('leadStatus')).values.find((one) => one.label === 'Contacted')
    expect(contacted).toMatchObject({ meaning: 'working', active: true })
    await expect(writer.write(request('k', { list: 'leadStatus', values: ['Won'], meaning: 'qualified' }))).resolves.toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('files a lead source under its group and regroups the leads already holding it', async () => {
    const written = await writer.write(request('j', { list: 'leadSource', values: ['Podcast'], group: 'Inbound' }))
    expect(written).toMatchObject({ ok: true, facts: { added: ['Podcast'] } })
    expect(effectiveCrmPicklist('leadSource', picklists.get('leadSource')).values.at(-1)).toMatchObject({ label: 'Podcast', group: 'inbound' })
    expect(regrouped).toEqual([{ object: 'lead', label: 'Podcast', group: 'inbound' }])
  })

  it('leaves an inactive value as it is and reports it', async () => {
    picklists.set('rating', { values: [{ id: 'hot', label: 'Hot', active: false }], defaultValueId: null })
    const written = await writer.write(request('j', { list: 'rating', values: ['hot'] }))
    expect(written).toMatchObject({ ok: true, replayed: true, facts: { added: [], inactive: ['Hot'] } })
    expect(writes).toBe(0)
  })

  it('adds choices to a custom Choice field, matched without capitals, and refuses a field that is not one', async () => {
    fields.set('f1', {
      $id: 'f1', key: 'tier', label: 'Tier', type: 'select', options: ['Gold'], object: 'company', order: 0, visibleTo: ['org'], hostId: 'h1',
    } as CrmFieldDefinitionDoc)
    fields.set('f2', {
      $id: 'f2', key: 'seats', label: 'Seats', type: 'number', object: 'company', order: 1, visibleTo: ['org'], hostId: 'h1',
    } as CrmFieldDefinitionDoc)
    const written = await writer.write(request('j', { list: 'custom', object: 'company', field: 'tier', values: ['gold', 'Platinum'] }))
    expect(written).toMatchObject({ ok: true, id: 'custom:f1', facts: { added: ['Platinum'], existing: ['Gold'] } })
    expect(fields.get('f1')?.options).toEqual(['Gold', 'Platinum'])
    await expect(writer.read({ hostId: 'h1', id: 'custom:f1' })).resolves.toMatchObject({ name: 'Tier', facts: { values: ['Gold', 'Platinum'] } })
    await expect(writer.write(request('k', { list: 'custom', object: 'company', field: 'Seats', values: ['10'] }))).resolves.toMatchObject({
      ok: false,
      status: 409,
    })
    await expect(writer.write(request('l', { list: 'custom', object: 'deal', field: 'Tier', values: ['x'] }))).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
  })
})
