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
 * A door that names a company keeps the whole association in step
 * (AGL-2613): the facet's `companyId`, the top-level `companyIds` mirror the
 * company page queries, and the company's `contactsCount` the companies list
 * shows. An import row, the console's create drawer and the REST API all
 * reach the upsert this way, and before this the mirror and the count were
 * left where they were — a person imported at Acme was not on Acme's page.
 */

import { upsertHostContact } from './upsert-contact'

jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (operand: number) => ({ __inc: operand }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => ({ __delete: true }),
  },
}))

const contacts: Record<string, Record<string, any>> = {}
let added: Array<{ id: string; data: Record<string, any> }> = []
/** Every count moved on a company, in order. */
let companyWrites: Array<{ id: string; data: Record<string, any> }> = []

/** A merge-set as Firestore applies one: given keys only, maps merged. */
function mergeApply(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__inc' in value) {
      target[key] = (Number(target[key]) || 0) + (value as any).__inc
    } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
      const current: unknown[] = Array.isArray(target[key]) ? target[key] : []
      for (const entry of (value as any).__arrayUnion) {
        if (!current.includes(entry)) current.push(entry)
      }
      target[key] = current
    } else if (value && typeof value === 'object' && '__arrayRemove' in value) {
      target[key] = (Array.isArray(target[key]) ? target[key] : []).filter(
        (entry: unknown) => !(value as any).__arrayRemove.includes(entry),
      )
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('__serverTimestamp' in value)
    ) {
      target[key] = { ...(target[key] ?? {}) }
      mergeApply(target[key], value)
    } else {
      target[key] = value
    }
  }
}

const companiesRef = {
  doc: (id: string) => ({
    update: async (data: Record<string, any>) => {
      companyWrites.push({ id, data })
    },
  }),
}

const contactsRef = {
  where: (field: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => {
        const hits = Object.entries(contacts).filter(([, data]) => data[field] === wanted)
        return {
          empty: hits.length === 0,
          docs: hits.map(([id, data]) => ({
            id,
            get: (key: string) => data[key],
            data: () => data,
            ref: {
              set: async (payload: Record<string, any>, options?: { merge?: boolean }) => {
                if (!options?.merge) throw new Error('expected merge set')
                mergeApply(data, payload)
              },
            },
          })),
        }
      },
    }),
  }),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(contacts).length }) }),
  }),
  add: async (data: Record<string, any>) => {
    const id = `auto-${added.length + 1}`
    added.push({ id, data })
    return { id }
  },
  // The org document, whose `companies` collection the count lands in.
  parent: {
    collection: (name: string) => {
      if (name !== 'companies') throw new Error(`unexpected collection ${name}`)
      return companiesRef
    },
  },
}

/*
 * The records band is the contacts aggregate here — the one company this
 * file seeds is the link under test, not a record the band would refuse —
 * so the door's verdict is exactly what these cases were written against.
 * The three-collection sum has its own spec.
 */
jest.mock('./crm-records', () => ({
  countCrmRecords: async (_orgRef: unknown, contacts: any) => {
    const contactsCount = (await contacts.count().get()).data().count
    return {
      contactsCount,
      companiesCount: 0,
      dealsCount: 0,
      crmRecordsCount: contactsCount,
    }
  },
}))

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ set: async () => undefined }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  consentGroupForSite: async (hostId: string) =>
    jest.requireActual('@aglyn/aglyn/app-utils/consent-groups').soloConsentGroup(hostId),
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/campaign-membership'),
  ORG_SCOPE_TOKEN: 'org',
  checkCrmRecordsQuota: () => ({ allowed: true }),
}))

const capture = (facet?: { companyId?: string }) =>
  upsertHostContact({
    hostId: 'h1',
    email: 'jo@example.com',
    source: 'import',
    interaction: { summary: 'Imported' },
    ...(facet ? { facet } : {}),
  })

beforeEach(() => {
  for (const key of Object.keys(contacts)) delete contacts[key]
  added = []
  companyWrites = []
})

describe('a create that names a company', () => {
  it('writes the facet, seeds the mirror, and counts the contact on the company', async () => {
    await capture({ companyId: 'co-acme' })
    expect(added).toHaveLength(1)
    expect(added[0].data.facets.h1.companyId).toBe('co-acme')
    expect(added[0].data.companyIds).toEqual(['co-acme'])
    expect(companyWrites).toEqual([{ id: 'co-acme', data: { contactsCount: { __inc: 1 } } }])
  })

  it('touches no company when the door named none', async () => {
    await capture()
    expect(added[0].data).not.toHaveProperty('companyIds')
    expect(companyWrites).toEqual([])
  })
})

describe('a merge that names a company', () => {
  const seed = (companyId?: string, others: Record<string, string> = {}) => {
    contacts['c1'] = {
      email: 'jo@example.com',
      visibleTo: ['host:h1'],
      companyIds: [companyId, ...Object.values(others)].filter(Boolean),
      facets: {
        h1: { sources: { form: true }, interactions: [], ...(companyId ? { companyId } : {}) },
        ...Object.fromEntries(
          Object.entries(others).map(([group, id]) => [
            group,
            { sources: { form: true }, interactions: [], companyId: id },
          ]),
        ),
      },
    }
  }

  it('links a person with no company, and counts them', async () => {
    seed()
    await capture({ companyId: 'co-acme' })
    expect(contacts['c1'].facets.h1.companyId).toBe('co-acme')
    expect(contacts['c1'].companyIds).toEqual(['co-acme'])
    expect(companyWrites).toEqual([{ id: 'co-acme', data: { contactsCount: { __inc: 1 } } }])
  })

  it('moves a person between companies, moving both counts', async () => {
    seed('co-acme')
    await capture({ companyId: 'co-globex' })
    expect(contacts['c1'].facets.h1.companyId).toBe('co-globex')
    expect(contacts['c1'].companyIds).toEqual(['co-globex'])
    expect(companyWrites).toEqual([
      { id: 'co-acme', data: { contactsCount: { __inc: -1 } } },
      { id: 'co-globex', data: { contactsCount: { __inc: 1 } } },
    ])
  })

  it('leaves the old id in the mirror, uncounted, while another holder names it', async () => {
    seed('co-acme', { h2: 'co-acme' })
    await capture({ companyId: 'co-globex' })
    expect(contacts['c1'].companyIds).toEqual(['co-acme', 'co-globex'])
    expect(contacts['c1'].facets.h2.companyId).toBe('co-acme')
    expect(companyWrites).toEqual([{ id: 'co-globex', data: { contactsCount: { __inc: 1 } } }])
  })

  it('writes nothing to the companies when the link is unchanged, or unnamed', async () => {
    seed('co-acme')
    await capture({ companyId: 'co-acme' })
    expect(companyWrites).toEqual([])
    await capture()
    expect(companyWrites).toEqual([])
    expect(contacts['c1'].companyIds).toEqual(['co-acme'])
  })
})
