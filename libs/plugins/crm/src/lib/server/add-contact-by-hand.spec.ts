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
 * A person added by hand with no site, no email, or neither (AGL-4122). The
 * rules that decide who somebody is live here: blank emails are nobody, a phone
 * number matches only inside the caller's view, and the opt-in lands where the
 * form said it did.
 */

const mockMemory = (
  jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')
).memoryFirestore()
const mockIndex: Array<[string, string[]]> = []
const mockChecks: unknown[] = []
const mockErased = new Set<string>()
let mockRecords = 0

jest.mock('firebase-admin/firestore', () =>
  (jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')).memoryFirestoreModule,
)
jest.mock('@aglyn/tenant-data-admin', () => {
  const link = jest.requireActual('../../../../../tenant/data/admin/src/lib/server/contact-company-link')
  return {
    __esModule: true,
    firebaseAdmin: { app: () => ({ firestore: () => mockMemory.firestore }) },
    restampCrmListFieldsAt: async () => undefined,
    contactCompanyLinkFields: link.contactCompanyLinkFields,
  }
})
jest.mock('@aglyn/tenant-data-admin/server/capture-email-check', () => ({
  scheduleCapturedEmailCheck: (item: unknown) => void mockChecks.push(item),
}))
jest.mock('@aglyn/tenant-data-admin/server/contact-company-link', () => ({
  settleCompanyContactsCounts: async () => undefined,
}))
jest.mock('@aglyn/tenant-data-admin/server/contact-email-index', () => ({
  emailIndexBeside: () => null,
  findContactByEmail: async (
    contacts: { where: (...args: unknown[]) => { limit: (n: number) => { get: () => Promise<{ docs: unknown[] }> } } },
    email: string,
  ) => (await contacts.where('email', '==', email).limit(1).get()).docs[0] ?? null,
  writeContactEmailIndex: async (_index: unknown, id: string, emails: string[]) =>
    void mockIndex.push([id, emails]),
}))
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({
  countCrmRecords: async () => ({ crmRecordsCount: mockRecords }),
}))
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  hostRefusesCaptureForErasure: async (hostId: string) => mockErased.has(hostId),
}))
jest.mock('@aglyn/tenant-data-admin/server/upsert-contact', () => ({
  storableProfile: (input: Record<string, unknown> | undefined) => ({ ...input }),
}))
jest.mock('./org-caller', () => ({
  orgHostIds: async () => ['host-a', 'host-b'],
}))

import { addContactByHand } from './add-contact-by-hand'

const ORG = 'org-1'
const CONTACTS = `orgs/${ORG}/contacts`
const WHOLE_ORG = { plan: 'pro', entitlements: {} }
const KEPT_APART = { ...WHOLE_ORG, crm: { defaultRecordScope: 'host' } }

const rows = (): Array<Record<string, any>> =>
  [...mockMemory.docs.entries()]
    .filter(([path]) => path.startsWith(`${CONTACTS}/`))
    .map(([path, data]) => ({ id: path.split('/').pop(), ...(data as Record<string, any>) }))

const add = (input: Partial<Parameters<typeof addContactByHand>[0]> = {}) =>
  addContactByHand({
    orgId: ORG,
    org: WHOLE_ORG,
    sourceHostId: null,
    email: null,
    ...input,
  })

beforeEach(() => {
  mockMemory.docs.clear()
  mockIndex.length = 0
  mockChecks.length = 0
  mockErased.clear()
  mockRecords = 0
})

describe('a person with no site and no email', () => {
  it('is the organization’s, under its own facet, and names no site', async () => {
    const verdict = await add({ name: 'Jordan Lee', facet: { mobilePhone: '+15125550107' } })
    expect(verdict).toEqual({ contactId: expect.any(String), created: true })
    const [row] = rows()
    expect(row).toMatchObject({
      hostId: null,
      capturedByHostIds: [],
      visibleTo: ['org'],
      phone: '+15125550107',
    })
    expect(row.facets.org).toMatchObject({ name: 'Jordan Lee', mobilePhone: '+15125550107' })
  })

  /** A Firestore `orderBy` drops a document that lacks the field. */
  it('stores a blank email, so a sort by email still lists them', async () => {
    await add({ name: 'Jordan Lee' })
    expect(rows()[0].email).toBe('')
  })

  it('writes no index entry and asks for no deliverability check', async () => {
    await add({ name: 'Jordan Lee' })
    expect(mockIndex).toEqual([])
    expect(mockChecks).toEqual([])
  })
})

describe('who the person already is', () => {
  it('never takes two blank emails for one person', async () => {
    await add({ name: 'Jordan Lee' })
    await add({ name: 'Pat Lee' })
    expect(rows()).toHaveLength(2)
  })

  it('matches by phone when there is no email, and merges what was given', async () => {
    const first = await add({ name: 'Jordan Lee', facet: { phone: '+15125550107' } })
    const second = await add({ facet: { phone: '+15125550107', jobTitle: 'Owner' } })
    expect(second).toEqual({ contactId: (first as { contactId: string }).contactId, created: false })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].facets.org).toMatchObject({ name: 'Jordan Lee', jobTitle: 'Owner' })
  })

  it('finds a person who gave only a mobile by that number', async () => {
    await add({ name: 'Jordan Lee', facet: { mobilePhone: '+15125550107' } })
    await expect(add({ facet: { mobilePhone: '+15125550107' } })).resolves.toMatchObject({
      created: false,
    })
  })

  it('never merges on a name alone', async () => {
    await add({ name: 'Jordan Lee' })
    await add({ name: 'Jordan Lee' })
    expect(rows()).toHaveLength(2)
  })

  /** A switchboard is not a person, and an agency's two clients stay apart. */
  it('matches a phone only among the records the site can see in a kept-apart org', async () => {
    mockMemory.seed(`${CONTACTS}/theirs`, {
      email: '',
      phone: '+15125550107',
      visibleTo: ['host:host-b'],
      facets: { 'host-b': {} },
    })
    const verdict = await add({
      org: KEPT_APART,
      sourceHostId: 'host-a',
      facet: { phone: '+15125550107' },
    })
    expect(verdict).toMatchObject({ created: true })
    expect(rows()).toHaveLength(2)
  })

  it('merges an address already on a contact into their own holder', async () => {
    mockMemory.seed(`${CONTACTS}/known`, {
      email: 'jordan@example.com',
      capturedByHostIds: ['host-a'],
      visibleTo: ['org'],
      facets: { 'host-a': { sources: {}, interactions: [] } },
    })
    const verdict = await add({ email: 'jordan@example.com', facet: { jobTitle: 'Owner' } })
    expect(verdict).toEqual({ contactId: 'known', created: false })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].facets['host-a'].jobTitle).toBe('Owner')
    expect(rows()[0].facets.org).toBeUndefined()
  })
})

describe('the opt-in', () => {
  it('records on every site when no Source site was named', async () => {
    await add({ email: 'jordan@example.com', marketingConsent: true })
    expect(Object.keys(rows()[0].marketingConsentByHost).sort()).toEqual(['host-a', 'host-b'])
  })

  it('records for the Source site alone when one was named', async () => {
    await add({ email: 'jordan@example.com', sourceHostId: 'host-a', marketingConsent: true })
    expect(Object.keys(rows()[0].marketingConsentByHost)).toEqual(['host-a'])
  })

  it('records nothing with no address: there is nowhere to send it', async () => {
    await add({ name: 'Jordan Lee', marketingConsent: true })
    expect(rows()[0].marketingConsentByHost).toBeUndefined()
  })

  it('leaves consent unwritten when the box was not ticked', async () => {
    await add({ email: 'jordan@example.com' })
    expect(rows()[0].marketingConsentByHost).toBeUndefined()
  })
})

describe('a Source site', () => {
  it('holds the facet and is recorded as where they came from', async () => {
    await add({ name: 'Jordan Lee', sourceHostId: 'host-a' })
    const [row] = rows()
    expect(row).toMatchObject({ hostId: 'host-a', capturedByHostIds: ['host-a'], visibleTo: ['org'] })
    expect(row.facets['host-a']).toMatchObject({ name: 'Jordan Lee' })
    expect(row.facets.org).toBeUndefined()
  })

  it('keeps the record to that site in an org that keeps its sites apart', async () => {
    await add({ name: 'Jordan Lee', sourceHostId: 'host-a', org: KEPT_APART })
    expect(rows()[0].visibleTo).toEqual(['host:host-a'])
  })
})

describe('what refuses a new person', () => {
  it('keeps an erased person erased, on any site, whichever door they come back through', async () => {
    mockErased.add('host-b')
    await expect(add({ email: 'gone@example.com' })).resolves.toEqual({ refused: 'erased' })
    expect(rows()).toEqual([])
  })

  it('answers for the records band', async () => {
    mockRecords = 1_000_000
    await expect(add({ name: 'Jordan Lee', org: { plan: 'free' } })).resolves.toEqual({
      refused: 'band',
    })
    expect(rows()).toEqual([])
  })
})
