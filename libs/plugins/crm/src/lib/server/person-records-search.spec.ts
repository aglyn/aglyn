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

import { crmContactListFields } from '@aglyn/aglyn/app-utils/crm'
import { memoryFirestore } from '../testing/memory-firestore'
import {
  CRM_PERSON_SEARCH_MAX,
  createCrmPersonRecords,
  crmPersonSearchWord,
  type CrmPersonRecordsDeps,
} from './person-records'

/**
 * The CRM answering a typed search for a person (AGL-3609) — the register's
 * customer lookup, through `plugin-person-records` rather than an import of
 * this plugin. One query on the scoped tokens the Contacts list searches, so
 * what it finds is exactly what that list would find under the same site.
 */

jest.mock('firebase-admin/firestore', () => ({ FieldValue: {} }))
jest.mock('@aglyn/tenant-data-admin', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/dynamic-list-materialize', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/contact-email-index', () => ({}))

const memory = memoryFirestore()

function deps(): CrmPersonRecordsDeps {
  return {
    firestore: () => memory.firestore,
    orgIdForHost: async (hostId) => (hostId === 'orphan' ? null : 'org-1'),
    groupIdForHost: async (hostId) => hostId,
    contactViewEmails: async () => ({ emails: [], complete: true }),
  }
}

/** A contact as every writer stores one: its list fields stamped from it. */
function seedContact(id: string, contact: Record<string, unknown>): void {
  memory.seed(`orgs/org-1/contacts/${id}`, { ...contact, ...crmContactListFields(contact) })
}

beforeEach(() => {
  memory.docs.clear()
  seedContact('c-dana', {
    name: 'Dana Whitfield',
    email: 'dana@acme.com',
    phone: '+1 (555) 123-4567',
    visibleTo: ['host:shop'],
  })
  seedContact('c-other-site', {
    name: 'Dana Other',
    email: 'dana.other@example.com',
    visibleTo: ['host:elsewhere'],
  })
  seedContact('c-org', { name: 'Danielle Org', email: 'dani@org.test', visibleTo: ['org'] })
})

describe('the word a search asks for', () => {
  it('reads punctuation and digits as a phone number', () => {
    expect(crmPersonSearchWord('(555) 123-4567')).toBe('5551234567')
    expect(crmPersonSearchWord('4567')).toBe('4567')
    expect(crmPersonSearchWord('12')).toBe('')
  })

  it('asks for the longest word of a name, capped at a token', () => {
    expect(crmPersonSearchWord('  Dana   Whitfield ')).toBe('whitfield')
    expect(crmPersonSearchWord('dana@acme.com')).toBe('dana@acme.co')
    expect(crmPersonSearchWord('')).toBe('')
  })
})

describe('searching contacts for a site (AGL-3609)', () => {
  const search = (text: string, hostId = 'shop', limit = 10) =>
    createCrmPersonRecords(deps()).search!({ hostId, text, limit })

  it('finds a contact by a word of the name, the address or the phone', async () => {
    expect((await search('whit')).map((person) => person.id)).toEqual(['c-dana'])
    expect((await search('dana@acme')).map((person) => person.id)).toEqual(['c-dana'])
    expect((await search('555-123-4567')).map((person) => person.id)).toEqual(['c-dana'])
    expect((await search('4567')).map((person) => person.id)).toEqual(['c-dana'])
  })

  it('answers only what the site may see: its own records and org-wide ones', async () => {
    const found = (await search('dan')).map((person) => person.id).sort()
    expect(found).toEqual(['c-dana', 'c-org'])
    expect(found).not.toContain('c-other-site')
  })

  it('answers the contact with its address and stored record', async () => {
    const [dana] = await search('whitfield')
    expect(dana).toMatchObject({ kind: 'contact', id: 'c-dana', email: 'dana@acme.com' })
    expect(dana?.data['phone']).toBe('+1 (555) 123-4567')
  })

  it('answers nobody for nothing searchable, and caps how many it reads', async () => {
    expect(await search('  ')).toEqual([])
    expect(await search('dan', 'shop', 0)).toEqual([])
    for (let at = 0; at < CRM_PERSON_SEARCH_MAX + 5; at += 1) {
      seedContact(`c-bulk-${at}`, { name: `Bulk ${at}`, email: `bulk${at}@x.test`, visibleTo: ['org'] })
    }
    expect(await search('bulk', 'shop', 500)).toHaveLength(CRM_PERSON_SEARCH_MAX)
  })

  it('refuses a site that belongs to no organization rather than searching everywhere', async () => {
    await expect(search('dana', 'orphan')).rejects.toThrow(/no organization/)
  })
})
