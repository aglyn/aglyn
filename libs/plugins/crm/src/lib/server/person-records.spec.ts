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

function collectionRef(path: string): any {
  const query = (filters: Array<{ field: string; value: unknown }>, limit?: number): any => ({
    where: (field: string, _op: string, value: unknown) => query([...filters, { field, value }], limit),
    limit: (count: number) => query(filters, count),
    get: async () => {
      const matched = childPaths(path).filter((child) =>
        filters.every((filter) => (docs.get(child) ?? {})[filter.field] === filter.value),
      )
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
    where: (field: string, _op: string, value: unknown) => query([{ field, value }]),
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

const deps: CrmPersonRecordsDeps = {
  firestore: () => firestore,
  orgIdForHost: async (hostId) => (hostId === 'orphan' ? null : 'org-1'),
  groupIdForHost: async (hostId) => (hostId === 'host-1' ? 'group-a' : hostId),
}
const records = createCrmPersonRecords(deps)

const LEAD_KEY = personKey('lead@example.com') as string

beforeEach(() => {
  docs.clear()
  restamped.length = 0
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
