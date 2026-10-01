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

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { createCrmPersonRecords, type CrmPersonRecordsDeps } from './person-records'

/**
 * The CRM answering `plugin-person-records` (AGL-3080): the people other
 * plugins ask it for, by address or by the refs it handed out, and the
 * containers they file somebody under — each through the CRM's own address
 * index and its own rule for which site sees which record.
 */

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (!existing) throw Object.assign(new Error(`NOT_FOUND ${path}`), { code: 5 })
      const next = { ...existing }
      for (const [key, field] of Object.entries(value)) {
        if (field && typeof field === 'object' && '__arrayUnion' in field) {
          const before = Array.isArray(next[key]) ? next[key] : []
          next[key] = [...before, ...(field.__arrayUnion as unknown[]).filter((item) => !before.includes(item))]
        } else {
          next[key] = field
        }
      }
      docs.set(path, next)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

type Filter = { field: string; op: string; value: unknown }

function matches(data: Record<string, any>, filter: Filter): boolean {
  const field = data[filter.field]
  if (filter.op === 'array-contains-any') {
    return Array.isArray(field) && (filter.value as unknown[]).some((token) => field.includes(token))
  }
  return field === filter.value
}

function collectionRef(path: string): any {
  const query = (filters: Filter[], limit?: number, order?: { field: string; desc: boolean }): any => ({
    where: (field: string, op: string, value: unknown) => query([...filters, { field, op, value }], limit, order),
    orderBy: (field: string, direction?: string) => query(filters, limit, { field, desc: direction === 'desc' }),
    limit: (count: number) => query(filters, count, order),
    get: async () => {
      let matched = childPaths(path).filter((child) =>
        filters.every((filter) => matches(docs.get(child) ?? {}, filter)),
      )
      if (order) {
        matched = [...matched].sort((a, b) => {
          const left = Number(docs.get(a)?.[order.field] ?? 0)
          const right = Number(docs.get(b)?.[order.field] ?? 0)
          return order.desc ? right - left : left - right
        })
      }
      const found = (limit == null ? matched : matched.slice(0, limit)).map(snapshotOf)
      return { empty: !found.length, docs: found }
    },
  })
  return {
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath ? docRef(parentPath) : null
    },
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => query([{ field, op, value }]),
  }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotOf(ref.path)),
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '<server-timestamp>',
    arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
  },
}))

const restamped: string[] = []
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({
  restampCrmListFieldsAt: async (ref: { path: string }, collection: string) => {
    restamped.push(`${collection}:${ref.path}`)
    return 'restamped'
  },
}))

// The barrel is only reached for the default deps, which these cases replace.
jest.mock('@aglyn/tenant-data-admin', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/dynamic-list-materialize', () => ({}))

/** What the dynamic-list sweep would read out of a Contacts view, per view. */
let viewEmails: Record<string, { emails: string[]; complete: boolean }> = {}

const deps: CrmPersonRecordsDeps = {
  firestore: () => firestore,
  orgIdForHost: async (hostId) => (hostId === 'orphan' ? null : 'org-1'),
  groupIdForHost: async (hostId) => (hostId === 'host-1' ? 'group-a' : hostId),
  contactViewEmails: async ({ viewId }) => viewEmails[viewId] ?? { emails: [], complete: true },
}
const records = createCrmPersonRecords(deps)

const LEAD_KEY = personKey('lead@example.com') as string

beforeEach(() => {
  docs.clear()
  restamped.length = 0
  viewEmails = {}
  docs.set('orgs/org-1/contacts/c-1', {
    email: 'pat@example.com',
    name: 'Pat',
    visibleTo: ['host:host-1'],
  })
  docs.set('orgs/org-1/contacts/c-2', {
    email: 'sam@work.example.com',
    alternateEmails: ['sam@example.com'],
    visibleTo: ['org'],
  })
  docs.set(`orgs/org-1/emailIndex/${personKey('sam@example.com')}`, {
    email: 'sam@example.com',
    contactId: 'c-2',
  })
  docs.set(`orgs/org-1/leads/${LEAD_KEY}`, {
    email: 'lead@example.com',
    status: 'new',
    visibleTo: ['host:host-1'],
  })
})

describe('finding a person by address', () => {
  it('answers the contact, with its address normalized and its document whole', async () => {
    expect(await records.find({ hostId: 'host-1', email: ' Pat@Example.COM ' })).toEqual({
      kind: 'contact',
      id: 'c-1',
      email: 'pat@example.com',
      data: docs.get('orgs/org-1/contacts/c-1'),
    })
  })

  it('finds the person an address a merge folded in now belongs to', async () => {
    expect((await records.find({ orgId: 'org-1', email: 'sam@example.com' }))?.id).toBe('c-2')
  })

  it('answers null for a record the site may not see, when asked for its view', async () => {
    expect(await records.find({ hostId: 'host-2', email: 'pat@example.com', onlyVisibleToSite: true })).toBeNull()
    expect((await records.find({ hostId: 'host-2', email: 'pat@example.com' }))?.id).toBe('c-1')
  })

  it('answers a lead only for a caller that asked for any kind', async () => {
    expect(await records.find({ hostId: 'host-1', email: 'lead@example.com' })).toBeNull()
    expect(
      await records.find({ hostId: 'host-1', email: 'lead@example.com', anyKind: true, onlyVisibleToSite: true }),
    ).toMatchObject({ kind: 'lead', id: LEAD_KEY, email: 'lead@example.com' })
    expect(
      await records.find({ hostId: 'host-2', email: 'lead@example.com', anyKind: true, onlyVisibleToSite: true }),
    ).toBeNull()
  })

  it('answers null for an address nothing can key', async () => {
    expect(await records.find({ hostId: 'host-1', email: 'nope' })).toBeNull()
  })

  it('throws for a site with no organization, as the org-data lookup did', async () => {
    await expect(records.find({ hostId: 'orphan', email: 'pat@example.com' })).rejects.toThrow(/no organization/)
  })
})

describe('reading the records it handed out', () => {
  it('answers each in the order asked, null for one gone or of a kind it does not keep', async () => {
    const read = await records.read({
      orgId: 'org-1',
      records: [
        { kind: 'lead', id: LEAD_KEY },
        { kind: 'contact', id: 'gone' },
        { kind: 'deal', id: 'd-1' },
        { kind: 'contact', id: 'c-1' },
      ],
    })
    expect(read.map((record) => record && `${record.kind}:${record.id}`)).toEqual([
      `lead:${LEAD_KEY}`,
      null,
      null,
      'contact:c-1',
    ])
  })
})

describe('filing a person under containers', () => {
  it('files a contact inside the site’s consent-group facet', async () => {
    expect(
      await records.fileUnder!({
        hostId: 'host-1',
        record: { kind: 'contact', id: 'c-1' },
        containerKind: 'campaign',
        ids: ['k-1', 'k-1', 'k-2'],
      }),
    ).toEqual({ filed: true })
    expect(docs.get('orgs/org-1/contacts/c-1')?.['facets.group-a.campaignIds']).toEqual(['k-1', 'k-2'])
    expect(restamped).toEqual([])
  })

  it('files a lead in its own field and restamps what the Leads list filters by', async () => {
    expect(
      await records.fileUnder!({
        hostId: 'host-1',
        record: { kind: 'lead', id: LEAD_KEY },
        containerKind: 'campaign',
        ids: ['k-1'],
      }),
    ).toEqual({ filed: true })
    expect(docs.get(`orgs/org-1/leads/${LEAD_KEY}`)?.['campaignIds']).toEqual(['k-1'])
    expect(restamped).toEqual([`leads:orgs/org-1/leads/${LEAD_KEY}`])
  })

  it('files nothing on a record the site cannot see, or one that is gone', async () => {
    for (const record of [
      { kind: 'contact', id: 'c-1', hostId: 'host-2' },
      { kind: 'contact', id: 'gone', hostId: 'host-1' },
    ]) {
      expect(
        await records.fileUnder!({
          hostId: record.hostId,
          record: { kind: record.kind, id: record.id },
          containerKind: 'campaign',
          ids: ['k-1'],
        }),
      ).toEqual({ filed: false })
    }
    expect(docs.get('orgs/org-1/contacts/c-1')?.['facets.host-2.campaignIds']).toBeUndefined()
  })
})

describe('the people a saved view selects', () => {
  const ask = (viewId: string, overrides: Record<string, unknown> = {}) =>
    records.peopleInView!({ orgId: 'org-1', hostId: 'host-1', viewId, viewerUid: 'rep', limit: 50, ...overrides })

  const lead = (id: string, data: Record<string, unknown>) =>
    docs.set(`orgs/org-1/leads/${id}`, { visibleTo: ['host:host-1'], lastSeenAtMs: 1, ...data })

  it('does not exist for a member who may not list it', async () => {
    docs.set('orgs/org-1/crmViews/private', { section: 'contacts', shared: false, ownerUid: 'other', filters: [] })
    expect(await ask('private')).toEqual({ ok: false, reason: 'not-found' })
    expect(await ask('gone')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('refuses a view that is not of people', async () => {
    docs.set('orgs/org-1/crmViews/deals', { section: 'deals', shared: true, filters: [] })
    expect(await ask('deals')).toEqual({ ok: false, reason: 'not-people' })
  })

  it('takes the site’s open leads for a Leads view naming no status, newest first, held not shared', async () => {
    docs.clear()
    docs.set('orgs/org-1/crmViews/open', { section: 'leads', shared: true, filters: [] })
    lead('l-new', { status: 'new', lastSeenAtMs: 3 })
    lead('l-working', { status: 'working', lastSeenAtMs: 2 })
    lead('l-lost', { status: 'unqualified', lastSeenAtMs: 4 })
    lead('l-converted', { status: 'new', convertedContactId: 'c-9', lastSeenAtMs: 5 })
    lead('l-sibling', { status: 'new', visibleTo: ['host:host-2'], lastSeenAtMs: 6 })
    expect(await ask('open')).toEqual({
      ok: true,
      people: [
        { kind: 'lead', id: 'l-new' },
        { kind: 'lead', id: 'l-working' },
      ],
      total: 2,
      truncated: false,
    })
  })

  it('narrows a Leads view to the one status it names', async () => {
    docs.set('orgs/org-1/crmViews/working', {
      section: 'leads',
      shared: false,
      ownerUid: 'rep',
      filters: [{ field: 'status', op: 'equals', value: 'working' }],
    })
    lead('l-new', { status: 'new' })
    lead('l-working', { status: 'working' })
    expect(await ask('working')).toMatchObject({ ok: true, people: [{ kind: 'lead', id: 'l-working' }] })
  })

  it('resolves a Contacts view’s addresses to the contacts the site may see, and says when it was cut', async () => {
    docs.set('orgs/org-1/crmViews/warm', { section: 'contacts', shared: true, filters: [] })
    viewEmails['warm'] = { emails: ['sam@example.com', 'pat@example.com', 'pat@example.com'], complete: false }
    expect(await ask('warm')).toEqual({
      ok: true,
      people: [
        { kind: 'contact', id: 'c-1' },
        { kind: 'contact', id: 'c-2' },
      ],
      total: 2,
      truncated: true,
    })
    expect(await ask('warm', { hostId: 'host-2' })).toMatchObject({
      ok: true,
      people: [{ kind: 'contact', id: 'c-2' }],
    })
  })

  it('refuses whole a Contacts view filtering on what reading it cannot apply', async () => {
    docs.set('orgs/org-1/crmViews/odd', {
      section: 'contacts',
      shared: true,
      filters: [{ field: 'nextTaskAtMs', op: 'isEmpty', value: '', label: 'Next task' }],
    })
    const answer = await ask('odd')
    expect(answer).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(answer.ok === false && answer.unsupported?.length).toBeTruthy()
  })
})

describe('whether a person ever wrote in', () => {
  it('answers from the inbound emails filed on the contact or the lead, unknown for a kind it does not keep', async () => {
    docs.set('orgs/org-1/crmActivities/a-1', { contactId: 'c-1', direction: 'inbound' })
    docs.set('orgs/org-1/crmActivities/a-2', { contactId: 'c-2', direction: 'outbound' })
    docs.set('orgs/org-1/crmActivities/a-3', { leadId: LEAD_KEY, direction: 'inbound' })
    expect(
      await records.wroteIn!({
        orgId: 'org-1',
        records: [
          { kind: 'contact', id: 'c-1' },
          { kind: 'contact', id: 'c-2' },
          { kind: 'lead', id: LEAD_KEY },
          { kind: 'deal', id: 'd-1' },
        ],
      }),
    ).toEqual([true, false, true, null])
  })
})
