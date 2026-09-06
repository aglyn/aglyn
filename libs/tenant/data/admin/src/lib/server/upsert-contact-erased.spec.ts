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

/*
 * THE ERASED PERSON DOES NOT COME BACK (AGL-2623).
 *
 * The same harness as `upsert-contact-verdict.spec.ts` — a contacts
 * collection as a map, the org on the free plan with room — with the
 * erasure lookup substituted so each case decides whether the site has
 * erased the address. What is under test is where the door asks and what it
 * answers, not the lookup itself, which has its own spec.
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
  },
}))

let mockErased = false
const mockRefuses = jest.fn(async (_hostId: string, _email: string) => mockErased)
jest.mock('./email-suppression', () => ({
  hostRefusesCaptureForErasure: (hostId: string, email: string) =>
    mockRefuses(hostId, email),
}))

const contacts: Record<string, Record<string, any>> = {}
let added: Record<string, any>[] = []

function mergeApply(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__inc' in value) {
      target[key] = (Number(target[key]) || 0) + (value as any).__inc
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('__serverTimestamp' in value) &&
      !('__arrayUnion' in value)
    ) {
      target[key] = { ...(target[key] ?? {}) }
      mergeApply(target[key], value)
    } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
      const current: unknown[] = Array.isArray(target[key]) ? target[key] : []
      for (const entry of (value as any).__arrayUnion) {
        if (!current.includes(entry)) current.push(entry)
      }
      target[key] = current
    } else {
      target[key] = value
    }
  }
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
    added.push(data)
    const id = `auto-${added.length}`
    contacts[id] = JSON.parse(JSON.stringify(data))
    return { id }
  },
}

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

jest.mock('./crm-records', () => ({
  countCrmRecords: async (_orgRef: unknown, contacts: any) => {
    const contactsCount = (await contacts.count().get()).data().count
    return { contactsCount, companiesCount: 0, dealsCount: 0, crmRecordsCount: contactsCount }
  },
}))

jest.mock('./organizations', () => ({
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'free' } }),
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

const capture = (email: string) =>
  upsertHostContact({
    hostId: 'h1',
    email,
    source: 'form',
    interaction: { summary: 'Submitted a form' },
  })

beforeEach(() => {
  for (const key of Object.keys(contacts)) delete contacts[key]
  added = []
  mockErased = false
  mockRefuses.mockClear()
})

describe('a capture on a site that erased the address', () => {
  it('refuses to create the record, and names the reason', async () => {
    mockErased = true
    expect(await capture('Jane@Example.com')).toEqual({ refused: 'erased' })
    expect(added).toEqual([])
    expect(Object.keys(contacts)).toEqual([])
  })

  it('asks the site by the normalized address', async () => {
    mockErased = true
    await capture('  Jane@Example.com ')
    expect(mockRefuses).toHaveBeenCalledWith('h1', 'jane@example.com')
  })

  it('creates as before when the site has not erased the address', async () => {
    expect(await capture('jane@example.com')).toEqual({ contactId: 'auto-1', created: true })
    expect(mockRefuses).toHaveBeenCalledTimes(1)
  })

  it('never asks on a merge — a row that exists is a person who was not erased', async () => {
    // The erasure removed the row a capture would merge into, so an existing
    // row is evidence the person was never erased (or was re-added by an
    // admin who released the suppression). The read is a create-branch cost.
    contacts['c1'] = { email: 'jane@example.com', facets: { h1: { sources: {}, interactions: [] } } }
    mockErased = true
    expect(await capture('jane@example.com')).toEqual({ contactId: 'c1', created: false })
    expect(mockRefuses).not.toHaveBeenCalled()
  })
})
