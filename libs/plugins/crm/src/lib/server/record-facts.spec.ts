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
 * The CRM's readers on the record-facts seam (AGL-2917), over a Firestore
 * double that answers the queries the readers make: who may read a record,
 * at which level, on which plan, and which of the rows hanging off it they
 * see. The facts themselves are pinned field by field in
 * `model/record-facts.spec.ts`; this spec pins the gates and the reads.
 */

type Data = Record<string, unknown>

const mockDocs = new Map<string, Data>()
const mockMembers = new Map<string, Data>()
const mockHostOrgs = new Map<string, string>()

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return { id: path.split('/').pop() as string, exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function mockCollection(path: string) {
  const query = (filters: Array<[string, unknown]>, order: [string, 'asc' | 'desc'] | null, max: number) => ({
    where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]], order, max),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => query(filters, [field, direction], max),
    limit: (next: number) => query(filters, order, next),
    get: async () => {
      const prefix = `${path}/`
      let docs = [...mockDocs.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map((key) => mockSnapshot(key))
        .filter((doc) => filters.every(([field, value]) => doc.data()?.[field] === value))
      if (order) {
        const [field, direction] = order
        docs = docs.sort((a, b) => {
          const left = Number(a.data()?.[field] ?? 0)
          const right = Number(b.data()?.[field] ?? 0)
          return direction === 'asc' ? left - right : right - left
        })
      }
      return { docs: docs.slice(0, max) }
    },
  })
  return {
    ...query([], null, 10_000),
    doc: (id: string) => ({
      get: async () => mockSnapshot(`${path}/${id}`),
      collection: (name: string) => mockCollection(`${path}/${id}/${name}`),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({ collection: (name: string) => mockCollection(name) }) }) },
  // A lead is read through the seam now (AGL-3275); this file's claim is what
  // the facts reader RETURNS, so the double just resolves the org row.
  readLeadForHost: async (hostId: string, id: string) => {
    const path = `orgs/${mockHostOrgs.get(hostId) ?? 'org-1'}/leads/${id}`
    return mockDocs.has(path)
      ? {
          exists: true,
          id,
          data: () => mockDocs.get(path),
          get: (f: string) => (mockDocs.get(path) as any)?.[f],
        }
      : null
  },
  resolveOrgIdForHost: async (hostId: string) => mockHostOrgs.get(hostId) ?? null,
  getOrgDoc: async (orgId: string) => {
    const org = mockDocs.get(`orgs/${orgId}`)
    return org ? { $id: orgId, ...org } : null
  },
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const member = mockMembers.get(`${orgId}:${uid}`)
    return member ? { orgId, member } : null
  },
  memberHasOrgPermission: async (_orgId: string, member: Data, permission: string) =>
    permission === 'data.manage' && ['owner', 'admin', 'editor'].includes(String(member['role'])),
  consentGroupForSite: async (hostId: string, org: Data) => mockConsentGroupForHost(org, hostId),
}))

import { consentGroupForHost as mockConsentGroupForHost } from '@aglyn/aglyn/server'
import { pluginRecordFactsReader } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { PluginRecordFactsRequest } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import {
  CRM_FACTS_LEAD_NEEDS_SITE,
  CRM_FACTS_NOT_A_MEMBER,
  CRM_FACTS_ORG_REFUSAL,
  CRM_FACTS_SITE_REFUSAL,
  CRM_FACTS_UNKNOWN_SITE,
  registerCrmRecordFactsReaders,
} from './record-facts'

const NOW = new Date('2026-09-16T15:00:00.000Z')
const day = (iso: string) => Date.parse(`${iso}T12:00:00.000Z`)

function seed() {
  mockDocs.clear()
  mockMembers.clear()
  mockHostOrgs.clear()
  mockHostOrgs.set('host-1', 'org-1')
  mockHostOrgs.set('host-2', 'org-1')
  mockHostOrgs.set('host-9', 'org-9')
  mockDocs.set('orgs/org-1', { plan: 'pro' })
  mockDocs.set('orgs/org-free', { plan: 'free' })
  mockMembers.set('org-1:owner', { role: 'owner' })
  mockMembers.set('org-1:site-editor', { role: 'editor', allHosts: false, hostAccess: { 'host-1': 'editor' } })
  mockMembers.set('org-1:viewer', { role: 'viewer' })
  mockMembers.set('org-free:owner', { role: 'owner' })
  mockDocs.set('orgs/org-1/contacts/contact-1', {
    email: 'jane@example.com',
    visibleTo: ['host:host-1'],
    facets: { 'host-1': { name: 'Jane Doe', jobTitle: 'Facilities manager', sources: { form: true }, interactions: [] } },
  })
  mockDocs.set('orgs/org-1/contacts/contact-2', {
    email: 'kim@example.com',
    visibleTo: ['host:host-2'],
    facets: { 'host-2': { name: 'Kim Lee', sources: {}, interactions: [] } },
  })
  mockDocs.set('orgs/org-1/crmActivities/a-1', {
    kind: 'call',
    atMs: day('2026-09-10'),
    body: 'Talked through the quote.',
    contactId: 'contact-1',
    visibleTo: ['host:host-1'],
  })
  // Filed against the same person from another site: not this site's to read.
  mockDocs.set('orgs/org-1/crmActivities/a-2', {
    kind: 'note',
    atMs: day('2026-09-11'),
    body: 'Host two only.',
    contactId: 'contact-1',
    visibleTo: ['host:host-2'],
  })
  mockDocs.set('orgs/org-1/crmTasks/t-1', {
    title: 'Send the quote',
    kind: 'email',
    priority: 'high',
    status: 'open',
    dueAtMs: day('2026-09-18'),
    contactId: 'contact-1',
    visibleTo: ['org'],
  })
  mockDocs.set('orgs/org-1/deals/d-1', {
    title: 'Warehouse re-roof',
    pipelineId: 'p-1',
    stageId: 'qualified',
    status: 'open',
    amountCents: 500_000,
    currency: 'usd',
    contactId: 'contact-1',
    contactName: 'Jane Doe',
    updatedAt: day('2026-09-12'),
    visibleTo: ['host:host-1'],
  })
  mockDocs.set('orgs/org-1/pipelines/p-1', {
    name: 'Sales',
    stages: [
      { id: 'qualified', name: 'Qualified', order: 0, probability: 10, kind: 'open' },
      { id: 'won', name: 'Won', order: 1, probability: 100, kind: 'won' },
    ],
    visibleTo: ['org'],
  })
  mockDocs.set('orgs/org-1/leads/lead-1', { name: 'Sam Rivera', status: 'new', sources: ['form:quote'], submissionCount: 1 })
  mockDocs.set('orgs/org-1/contactFields/f-1', { key: 'budget', label: 'Budget', type: 'number', order: 0, visibleTo: ['org'] })
  mockDocs.set('orgs/org-1/contactFields/f-2', { key: 'hidden', label: 'Hidden', type: 'text', order: 1, visibleTo: ['host:host-2'] })
}

const request = (patch: Partial<PluginRecordFactsRequest>): PluginRecordFactsRequest => ({
  orgId: 'org-1',
  hostId: 'host-1',
  id: 'contact-1',
  uid: 'owner',
  org: null,
  now: NOW,
  ...patch,
})

const read = (resource: string, patch: Partial<PluginRecordFactsRequest>) => {
  const found = pluginRecordFactsReader(resource)
  if (!found) throw new Error(`no reader for ${resource}`)
  return found.reader.read(request(patch))
}

beforeEach(() => {
  seed()
  resetPluginServicesForTests()
  registerCrmRecordFactsReaders()
})

describe('the CRM’s readers on the record-facts seam (AGL-2917)', () => {
  it('registers a reader for every record and the import catalog, owned by the CRM', () => {
    for (const resource of ['crm.contact', 'crm.company', 'crm.deal', 'crm.lead', 'crm.import']) {
      expect([resource, pluginRecordFactsReader(resource)?.pluginId]).toEqual([resource, 'crm'])
    }
  })

  it('reads a contact on its site with the rows that site may see, and nothing another site filed', async () => {
    const result = await read('crm.contact', { uid: 'site-editor' })
    expect(result).toMatchObject({
      ok: true,
      facts: {
        record: 'contact',
        name: 'Jane Doe',
        timeline: [{ on: '2026-09-10', kind: 'Call', text: 'Talked through the quote.' }],
        openTasks: [{ title: 'Send the quote', due: '2026-09-18', overdue: false }],
        deals: [{ title: 'Warehouse re-roof', stage: 'Qualified', amount: 'USD 5000.00' }],
      },
    })
    expect(JSON.stringify(result)).not.toContain('Host two only.')
    expect(JSON.stringify(result)).not.toContain('jane@example.com')
  })

  it('reads every row at the organization level, for an org-wide member only', async () => {
    const result = await read('crm.contact', { hostId: null })
    expect(result.ok && (result.facts['timeline'] as unknown[]).length).toBe(2)
    expect(await read('crm.contact', { hostId: null, uid: 'site-editor' })).toEqual({
      ok: false,
      status: 403,
      error: CRM_FACTS_ORG_REFUSAL,
    })
  })

  it('refuses in the CRM’s own words: no member, no data.manage, no reach, a site of another org, a record the site cannot see', async () => {
    expect(await read('crm.contact', { uid: 'stranger' })).toEqual({ ok: false, status: 403, error: CRM_FACTS_NOT_A_MEMBER })
    expect(await read('crm.contact', { uid: 'viewer' })).toEqual({ ok: false, status: 403, error: CRM_FACTS_SITE_REFUSAL })
    expect(await read('crm.contact', { uid: 'site-editor', hostId: 'host-2', id: 'contact-2' })).toEqual({
      ok: false,
      status: 403,
      error: CRM_FACTS_SITE_REFUSAL,
    })
    expect(await read('crm.contact', { hostId: 'host-9' })).toEqual({ ok: false, status: 404, error: CRM_FACTS_UNKNOWN_SITE })
    expect(await read('crm.contact', { id: 'contact-2' })).toMatchObject({ ok: false, status: 404 })
    expect(await read('crm.contact', { id: 'nobody' })).toMatchObject({ ok: false, status: 404 })
  })

  it('asks the plan once the caller is known, and refuses staff on a plan without the CRM too', async () => {
    const refusal = await read('crm.contact', { orgId: 'org-free', hostId: null })
    expect(refusal).toMatchObject({ ok: false, status: 403 })
    expect(refusal.ok === false && refusal.error).toMatch(/^Reading a CRM record is part of the CRM/)
    expect(await read('crm.contact', { orgId: 'org-free', hostId: null, uid: 'support', staff: true })).toMatchObject({
      ok: false,
      status: 403,
    })
    // Staff on a plan that carries it read as every CRM route lets them.
    expect(await read('crm.contact', { uid: 'support', staff: true })).toMatchObject({ ok: true })
  })

  it('reads a deal with its pipeline’s stages, and a lead only on its own site', async () => {
    expect(await read('crm.deal', { id: 'd-1' })).toMatchObject({
      ok: true,
      facts: { record: 'deal', stages: [{ id: 'qualified' }, { id: 'won' }], stageId: 'qualified', contact: 'Jane Doe' },
    })
    expect(await read('crm.lead', { id: 'lead-1' })).toMatchObject({
      ok: true,
      facts: { record: 'lead', name: 'Sam Rivera', status: 'New', sources: ['Form'], captures: 1 },
    })
    expect(await read('crm.lead', { id: 'lead-1', hostId: null })).toEqual({
      ok: false,
      status: 400,
      error: CRM_FACTS_LEAD_NEEDS_SITE,
    })
    expect(await read('crm.lead', { id: 'lead-9' })).toMatchObject({ ok: false, status: 404 })
  })

  it('lists an import’s fields with the custom fields the site may see', async () => {
    const result = await read('crm.import', { id: 'contacts' })
    expect(result.ok).toBe(true)
    const keys = result.ok ? (result.facts['fields'] as Array<{ key: string }>).map((field) => field.key) : []
    expect(keys).toContain('email')
    expect(keys).toContain('custom:budget')
    expect(keys).not.toContain('custom:hidden')
    expect(await read('crm.import', { id: 'invoices' })).toMatchObject({ ok: false, status: 400 })
  })
})
