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
 * A new contact is filed under the company its email domain names
 * (AGL-2613) — and only then.
 *
 * What is pinned: the lookup is ONE scoped query on the domain, capped at
 * two so "exactly one" is a fact; a public mailbox asks nothing; two visible
 * companies at one domain link nothing; no company creates nothing unless
 * the org said so, in which case the company and the link land in one
 * commit; and nothing here ever rejects, because the capture already
 * succeeded and a form must not fail for the CRM's sake.
 *
 * The link writer is the REAL one, so the facet, the mirror and the count
 * are asserted as the Admin SDK would write them.
 */

const docs = new Map<string, Record<string, any>>()
let autoId = 0
/** Every query the fake answered, with its clauses. */
let queries: Array<{ path: string; filters: unknown[]; limit?: number }> = []
let mockOrg: Record<string, unknown> = {}
let mockLookupFails = false

function readPath(data: Record<string, any>, key: string): unknown {
  return key.split('.').reduce<any>((value, part) => value?.[part], data)
}

function applyUpdate(path: string, value: Record<string, any>) {
  const existing = docs.get(path)
  if (existing === undefined) {
    throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
  }
  const next: Record<string, any> = { ...existing }
  for (const [key, field] of Object.entries(value)) {
    let target = next
    let leaf = key
    if (key.includes('.')) {
      const parts = key.split('.')
      leaf = parts.pop() as string
      for (const part of parts) {
        target[part] = { ...(target[part] ?? {}) }
        target = target[part]
      }
    }
    if (field && typeof field === 'object' && '__arrayUnion' in field) {
      const before: unknown[] = Array.isArray(target[leaf]) ? target[leaf] : []
      target[leaf] = [
        ...before,
        ...(field.__arrayUnion as unknown[]).filter((item) => !before.includes(item)),
      ]
    } else if (field && typeof field === 'object' && '__increment' in field) {
      target[leaf] = Number(target[leaf] ?? 0) + Number(field.__increment)
    } else {
      target[leaf] = field
    }
  }
  docs.set(path, next)
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    set: async (value: Record<string, any>) => void docs.set(path, { ...value }),
    update: async (value: Record<string, any>) => applyUpdate(path, value),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<{ field: string; op: string; value: unknown }>, max?: number) => ({
    where: (field: string, op: string, value: unknown) =>
      make([...filters, { field, op, value }], max),
    limit: (n: number) => make(filters, n),
    get: async () => {
      if (mockLookupFails) throw new Error('FAILED_PRECONDITION: index missing')
      queries.push({ path, filters, limit: max })
      const prefix = `${path}/`
      const hits = [...docs.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .filter(([, data]) =>
          filters.every((filter) => {
            const stored = readPath(data, filter.field)
            if (filter.op === '==') return stored === filter.value
            if (filter.op === 'array-contains-any') {
              return (
                Array.isArray(stored) &&
                stored.some((token) => (filter.value as unknown[]).includes(token))
              )
            }
            throw new Error(`fake firestore: unsupported op ${filter.op}`)
          }),
        )
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return {
        size: hits.length,
        docs: hits.map(([key, data]) => ({ id: key.split('/').pop(), data: () => data })),
      }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
  })
  return make([], undefined)
}

const fakeFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      set: (ref: any, value: Record<string, any>) => void queued.push(() => ref.set(value)),
      update: (ref: any, value: Record<string, any>) => void queued.push(() => ref.update(value)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    increment: (by: number) => ({ __increment: by }),
    delete: () => ({ __delete: true }),
  },
}))

const getOrgForHost = jest.fn(async (hostId: string) =>
  hostId === 'site-1' ? { orgId: 'org-1', org: mockOrg } : null,
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: (hostId: string) => getOrgForHost(hostId),
  // The real resolution: an org that declared no pooling resolves every
  // site to a group of one.
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('../../../../aglyn/src/lib/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  // The real link writer — the facet, the mirror and the count as the Admin
  // SDK writes them are what this file asserts.
  ...jest.requireActual('../../../data/admin/src/lib/server/contact-company-link'),
}))

import { associateCompanyByDomain } from './associate-company-by-domain'

const CONTACT = 'orgs/org-1/contacts/con-1'
const created = { hostId: 'site-1', contactId: 'con-1', email: 'Jane@Acme.com' }

beforeEach(() => {
  docs.clear()
  autoId = 0
  queries = []
  mockOrg = {}
  mockLookupFails = false
  getOrgForHost.mockClear()
  docs.set(CONTACT, {
    email: 'jane@acme.com',
    visibleTo: ['host:site-1'],
    facets: { 'site-1': { sources: { form: true }, interactions: [] } },
  })
})

describe('associateCompanyByDomain', () => {
  it('asks nothing for a public mailbox address', async () => {
    const outcome = await associateCompanyByDomain({ ...created, email: 'jane@gmail.com' })
    expect(outcome).toEqual({ outcome: 'none', reason: 'no-domain' })
    expect(getOrgForHost).not.toHaveBeenCalled()
    expect(queries).toEqual([])
  })

  it('links the one visible company at the domain, counting the contact on it', async () => {
    docs.set('orgs/org-1/companies/co-acme', {
      name: 'Acme',
      domain: 'acme.com',
      visibleTo: ['host:site-1'],
      contactsCount: 4,
    })
    // Another client's Acme at the same domain is outside this site's scope
    // and must be neither a match nor an ambiguity.
    docs.set('orgs/org-1/companies/co-other', {
      name: 'Acme (other client)',
      domain: 'acme.com',
      visibleTo: ['host:elsewhere'],
    })

    const outcome = await associateCompanyByDomain(created)

    expect(outcome).toEqual({ outcome: 'linked', companyId: 'co-acme' })
    // One query, scoped and bounded — the shape the composite index serves.
    expect(queries).toEqual([
      {
        path: 'orgs/org-1/companies',
        filters: [
          { field: 'domain', op: '==', value: 'acme.com' },
          { field: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:site-1'] },
        ],
        limit: 2,
      },
    ])
    const contact = docs.get(CONTACT)
    expect(contact?.facets['site-1'].companyId).toBe('co-acme')
    expect(contact?.companyIds).toEqual(['co-acme'])
    expect(docs.get('orgs/org-1/companies/co-acme')?.contactsCount).toBe(5)
  })

  it('links nothing when two visible companies share the domain', async () => {
    docs.set('orgs/org-1/companies/co-1', { domain: 'acme.com', visibleTo: ['host:site-1'] })
    docs.set('orgs/org-1/companies/co-2', { domain: 'acme.com', visibleTo: ['org'] })

    expect(await associateCompanyByDomain(created)).toEqual({
      outcome: 'none',
      reason: 'ambiguous',
    })
    expect(docs.get(CONTACT)?.companyIds).toBeUndefined()
  })

  it('creates nothing when no company carries the domain and the org has not asked for one', async () => {
    expect(await associateCompanyByDomain(created)).toEqual({
      outcome: 'none',
      reason: 'no-match',
    })
    expect([...docs.keys()].filter((key) => key.includes('/companies/'))).toEqual([])
    expect(docs.get(CONTACT)?.companyIds).toBeUndefined()
  })

  it('creates the company from the domain when the org has switched that on, in one commit', async () => {
    mockOrg = { crm: { autoCreateCompanies: true } }

    const outcome = await associateCompanyByDomain(created)

    expect(outcome).toMatchObject({ outcome: 'created' })
    const companyId = (outcome as { companyId: string }).companyId
    expect(docs.get(`orgs/org-1/companies/${companyId}`)).toMatchObject({
      name: 'Acme',
      nameLower: 'acme',
      domain: 'acme.com',
      // Scoped exactly as the contact was: the capturing site alone.
      visibleTo: ['host:site-1'],
      hostId: 'site-1',
      contactsCount: 1,
      createdAt: 'server-timestamp',
    })
    const contact = docs.get(CONTACT)
    expect(contact?.facets['site-1'].companyId).toBe(companyId)
    expect(contact?.companyIds).toEqual([companyId])
  })

  it('stamps the org scope on a created company when the org shares by default', async () => {
    mockOrg = { crm: { autoCreateCompanies: true }, defaultResourceScope: 'org' }
    const outcome = await associateCompanyByDomain(created)
    const companyId = (outcome as { companyId: string }).companyId
    expect(docs.get(`orgs/org-1/companies/${companyId}`)?.visibleTo).toEqual(['org'])
  })

  it('answers none for a site with no org, and never rejects on a failed lookup', async () => {
    expect(await associateCompanyByDomain({ ...created, hostId: 'nowhere' })).toEqual({
      outcome: 'none',
      reason: 'no-org',
    })
    mockLookupFails = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(associateCompanyByDomain(created)).resolves.toEqual({
      outcome: 'none',
      reason: 'failed',
    })
    spy.mockRestore()
  })
})
