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
 * THE CRM'S SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080), called the way
 * the erasure calls it: `locate` before anybody erases, `erase` after
 * everybody else. The whole erasure, every plugin's share together, runs in
 * `apps/console/specs/person-erasure.spec.ts`.
 */

import {
  registerPluginEventHandler,
  resetPluginEventHandlersForTests,
  type PluginEventPayloads,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import { createHash } from 'node:crypto'
import { createCrmPersonEraser } from './person-eraser'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
  },
}))

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
}

/** The value at a dotted path — what a query on a facet field reads. */
const valueAt = (doc: Record<string, any> | undefined, path: string) =>
  path.split('.').reduce<any>((node, key) => (node == null ? undefined : node[key]), doc)

function applyPatch(existing: Record<string, any>, patch: Record<string, any>) {
  const next = JSON.parse(JSON.stringify(existing))
  for (const [path, value] of Object.entries(patch)) {
    // A dotted key is a path into the document, as `update()` reads one.
    const keys = path.split('.')
    let node = next
    for (const key of keys.slice(0, -1)) node = node[key] ??= {}
    const field = keys[keys.length - 1]
    if (value && typeof value === 'object' && '__delete' in value) delete node[field]
    else if (value && typeof value === 'object' && '__increment' in value) {
      node[field] = Number(node[field] ?? 0) + Number(value.__increment)
    } else node[field] = value
  }
  return next
}

function snapshot(path: string) {
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
    get: async () => snapshot(path),
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyPatch(existing, value))
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, string, unknown]>, max?: number): any => ({
    where: (field: string, op: string, value: unknown) => make([...filters, [field, op, value]], max),
    limit: (n: number) => make(filters, n),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) =>
          filters.every(([field, op, value]) => {
            const stored = valueAt(snap.data(), field)
            return op === 'array-contains' ? Array.isArray(stored) && stored.includes(value) : stored === value
          }),
        )
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  return make([])
}

const store: any = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      delete: (ref: any) => void queued.push(() => ref.delete()),
      update: (ref: any, value: Record<string, any>) => void queued.push(() => ref.update(value)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

const ORG = 'org1'
const EMAIL = 'jane@example.com'
const KEY = createHash('sha256').update(EMAIL).digest('hex')
const TARGET = { orgId: ORG, email: EMAIL, key: KEY, dryRun: false, atMs: 1000 }

const eraser = createCrmPersonEraser({ firestore: () => store })

/** What the erasure told the plugins it removed (AGL-3330). */
const removed: Array<PluginEventPayloads['host.records.removed']> = []

function seed() {
  docs.set('hosts/h1', { orgId: ORG })
  docs.set('hosts/h2', { orgId: ORG })
  docs.set('hosts/other', { orgId: 'org2' })
  docs.set(`orgs/${ORG}/contacts/c1`, {
    email: EMAIL,
    companyIds: ['co1', 'co2'],
    visibleTo: ['host:h1', 'host:h2'],
    facets: {
      h1: {
        notes: 'private',
        // Salesforce's standard fields (AGL-3515) — personal data, gone with the row.
        birthdate: '1984-07-21',
        mobilePhone: '+15125550101',
        otherAddress: { line1: '2 Side St' },
      },
      h2: { notes: 'also private' },
    },
  })
  docs.set(`orgs/${ORG}/contacts/c9`, {
    email: 'someone@else.com',
    companyIds: ['co1'],
    // Somebody who reports to the person being erased, in each site's facet.
    facets: {
      h1: { reportsToContactId: 'c1', jobTitle: 'Analyst' },
      h2: { reportsToContactId: 'c1' },
    },
  })
  docs.set(`orgs/${ORG}/companies/co1`, { name: 'Acme', contactsCount: 2 })
  docs.set(`orgs/${ORG}/companies/co2`, { name: 'Globex', contactsCount: 1 })
  docs.set(`orgs/${ORG}/deals/d1`, { title: 'Renewal', contactId: 'c1', amountCents: 5000 })
  docs.set(`orgs/${ORG}/deals/d2`, { title: 'Other', contactId: 'c9' })
  docs.set(`orgs/${ORG}/crmTasks/t1`, { title: 'Call Jane', contactId: 'c1' })
  docs.set(`orgs/${ORG}/crmTasks/t2`, { title: 'Call someone', contactId: 'c9' })
  docs.set(`orgs/${ORG}/crmActivities/a1`, { body: 'Spoke to Jane', contactId: 'c1' })
  docs.set(`orgs/${ORG}/crmActivities/a2`, { body: 'Spoke to Jane again', contactId: 'c1' })
  docs.set(`orgs/${ORG}/leads/${KEY}`, { email: EMAIL, sources: ['form:form-1', 'booking'] })
  docs.set(`hosts/h1/leads/${KEY}`, { email: EMAIL, sources: ['form:form-2'] })
  docs.set(`hosts/other/leads/${KEY}`, { email: EMAIL, name: 'Jane' })
}

beforeEach(() => {
  docs.clear()
  removed.length = 0
  resetPluginEventHandlersForTests()
  registerPluginEventHandler('host.records.removed', (payload) => void removed.push(payload), {
    pluginId: 'forms',
  })
  seed()
})

describe('locate', () => {
  it('names every contact whose address is the person’s, and writes nothing', async () => {
    const before = new Map(docs)
    expect(await eraser.locate(TARGET)).toEqual(['c1'])
    expect(docs).toEqual(before)
  })
})

describe('erase', () => {
  const erase = () => eraser.erase({ ...TARGET, contactIds: ['c1'] })

  it('deletes the shared contact document whole, whoever holds it', async () => {
    // Not a detach: both sites' facets go with the row.
    const report = await erase()
    expect(docs.has(`orgs/${ORG}/contacts/c1`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/contacts/c9`)).toBe(true)
    expect(report).toMatchObject({ contacts: 1 })
  })

  it('clears every other contact’s reports-to that named the person, in each holder’s facet (AGL-3515)', async () => {
    await erase()
    const other = docs.get(`orgs/${ORG}/contacts/c9`)
    expect(other?.facets.h1).toEqual({ jobTitle: 'Analyst' })
    expect(other?.facets.h2).toEqual({})
    expect(JSON.stringify([...docs.values()])).not.toContain('1984-07-21')
  })

  it('erases only the contacts it was handed', async () => {
    const report = await eraser.erase({ ...TARGET, contactIds: [] })
    expect(docs.has(`orgs/${ORG}/contacts/c1`)).toBe(true)
    expect(report).toMatchObject({ contacts: 0 })
  })

  it('moves each linked company’s contact count down once', async () => {
    const report = await erase()
    expect(docs.get(`orgs/${ORG}/companies/co1`)?.contactsCount).toBe(1)
    expect(docs.get(`orgs/${ORG}/companies/co2`)?.contactsCount).toBe(0)
    expect(report).toMatchObject({ companyLinks: 2 })
  })

  it('unlinks the person’s deals and keeps them; deletes their tasks and activities', async () => {
    const report = await erase()
    expect(docs.get(`orgs/${ORG}/deals/d1`)).toMatchObject({ title: 'Renewal', amountCents: 5000 })
    expect(docs.get(`orgs/${ORG}/deals/d1`)).not.toHaveProperty('contactId')
    expect(docs.get(`orgs/${ORG}/deals/d2`)?.contactId).toBe('c9')
    expect(docs.has(`orgs/${ORG}/crmTasks/t1`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/crmTasks/t2`)).toBe(true)
    expect(docs.has(`orgs/${ORG}/crmActivities/a1`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/crmActivities/a2`)).toBe(false)
    expect(report).toMatchObject({ deals: 1, tasks: 1, activities: 2 })
  })

  it('takes the person off every deal’s contact roles, and its Primary with them (AGL-3521)', async () => {
    docs.set(`orgs/${ORG}/deals/d3`, {
      title: 'Committee',
      contactId: 'c9',
      contactRoles: [
        { contactId: 'c9', role: 'Economic Buyer', primary: true },
        { contactId: 'c1', role: 'Evaluator', primary: false },
      ],
      contactRoleContactIds: ['c9', 'c1'],
      contactRoleKeys: ['economic buyer', 'evaluator'],
    })
    docs.set(`orgs/${ORG}/deals/d4`, {
      title: 'Led by them',
      contactId: 'c1',
      contactRoles: [
        { contactId: 'c1', role: 'Decision Maker', primary: true },
        { contactId: 'c9', primary: false },
      ],
      contactRoleContactIds: ['c1', 'c9'],
    })
    const report = await erase()
    expect(docs.get(`orgs/${ORG}/deals/d3`)).toMatchObject({
      contactId: 'c9',
      contactRoles: [{ contactId: 'c9', role: 'Economic Buyer', primary: true }],
      contactRoleContactIds: ['c9'],
      contactRoleKeys: ['economic buyer'],
    })
    expect(docs.get(`orgs/${ORG}/deals/d4`)).toMatchObject({
      contactRoles: [{ contactId: 'c9', primary: false }],
      contactRoleContactIds: ['c9'],
    })
    expect(docs.get(`orgs/${ORG}/deals/d4`)).not.toHaveProperty('contactId')
    expect(report).toMatchObject({ deals: 3 })
  })

  it('deletes the org’s lead and every legacy row on its sites, and no other workspace’s', async () => {
    const report = await erase()
    expect(docs.has(`orgs/${ORG}/leads/${KEY}`)).toBe(false)
    expect(docs.has(`hosts/h1/leads/${KEY}`)).toBe(false)
    // Another workspace's relationship with the same person is not this
    // request's to end.
    expect(docs.has(`hosts/other/leads/${KEY}`)).toBe(true)
    expect(report).toMatchObject({ leads: 2 })
  })

  it('tells the plugins which leads it removed, once they are gone (AGL-3330)', async () => {
    let leftWhenTold: boolean | null = null
    resetPluginEventHandlersForTests()
    registerPluginEventHandler(
      'host.records.removed',
      (payload) => {
        leftWhenTold = docs.has(`orgs/${ORG}/leads/${KEY}`) || docs.has(`hosts/h1/leads/${KEY}`)
        removed.push(payload)
      },
      { pluginId: 'forms' },
    )
    await erase()
    expect(leftWhenTold).toBe(false)
    expect(removed).toEqual([
      {
        orgId: ORG,
        hostIds: expect.arrayContaining(['h1', 'h2']),
        collection: 'leads',
        records: [
          { id: KEY, data: { email: EMAIL, sources: ['form:form-1', 'booking'] } },
          { id: KEY, data: { email: EMAIL, sources: ['form:form-2'] } },
        ],
      },
    ])
  })

  it('raises nothing when the person was on no lead', async () => {
    docs.delete(`orgs/${ORG}/leads/${KEY}`)
    docs.delete(`hosts/h1/leads/${KEY}`)
    await erase()
    expect(removed).toEqual([])
  })

  it('counts on a dry run, and writes nothing', async () => {
    const before = new Map(docs)
    const report = await eraser.erase({ ...TARGET, dryRun: true, contactIds: ['c1'] })
    expect(report).toMatchObject({ contacts: 1, leads: 2 })
    expect(docs).toEqual(before)
    expect(removed).toEqual([])
  })
})
