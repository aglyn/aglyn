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
 * What the CRM lists query by is derived from the record, one way
 * (AGL-3321): the search tokens, their scoped twins, a lead's status, lead
 * source and address verdict, and a contact's facet keys. The worked
 * examples are shared with `tools/scripts/backfill-crm-list-fields.mjs
 * --self-test` and `tools/scripts/lib/org-record-list-fields.test.mjs`, so the
 * backfill and the seeds cannot stamp a spelling the writers and the queries
 * do not use.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CRM_LIST_FIELD_INPUTS,
  type CrmListCollection,
  crmContactFacetKeys,
  crmContactListFields,
  crmFieldListFields,
  crmPhoneSearchWords,
  crmEmailStatusKey,
  crmFacetKey,
  crmLeadListFields,
  crmLeadSourceKey,
  crmListFields,
  crmListFieldsPatch,
  crmListFieldsTouched,
  crmNewRecordListFields,
  crmSearchTokens,
} from './crm'
import { nameSearchToken } from './name-search'

interface Fixture {
  collection: CrmListCollection
  record: Record<string, unknown>
  expected: Record<string, unknown>
}
interface Fixtures {
  records: Fixture[]
  newRecords: Fixture[]
  fieldDefinitions: Array<Omit<Fixture, 'collection'>>
}

const fixtures: Fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'org-record-list-fields.fixtures.json'),
    'utf8',
  ),
)

describe('crmSearchTokens', () => {
  it('stores every word prefix of every value, as the query token asks', () => {
    const tokens = crmSearchTokens(['Dana Whitfield', 'Acme Coffee'])
    for (const typed of ['dana', 'whit', 'acme', 'cof', 'Coffee']) {
      expect(tokens).toContain(nameSearchToken(typed))
    }
    expect(tokens).not.toContain('offee')
  })

  it('finds an address by the address and by each of its parts', () => {
    const tokens = crmSearchTokens(['dana.w+crm@acme-coffee.com'])
    expect(tokens).toContain(nameSearchToken('dana.w+crm@acme-coffee.com'))
    for (const part of ['dana', 'w', 'crm', 'acme', 'coffee', 'com']) {
      expect(tokens).toContain(part)
    }
  })

  it('reads an array value (tags) member by member and skips what is not text', () => {
    const tokens = crmSearchTokens([['sal-15', 'vip'], 42, null, undefined])
    expect(tokens).toEqual(expect.arrayContaining(['sal-15', 'sal', '15', 'vip']))
    expect(tokens).not.toContain('42')
  })
})

describe('what a contact is searched by', () => {
  it('finds a person by a word of their company and by the digits of their phone', () => {
    const fields = crmContactListFields({
      name: 'Ana Ruiz',
      email: 'ana@example.org',
      companyName: 'Ruiz & Hijos Coffee',
      phone: '+15551234567',
    })
    for (const typed of ['hijos', 'coff', '5551234', '555123', '4567', '15551234567']) {
      expect(fields.searchTokens).toContain(nameSearchToken(typed))
    }
    expect(crmPhoneSearchWords('12')).toEqual([])
  })

})

describe('crmLeadListFields', () => {

  it('writes a lead nobody touched as new, and the verdicts it can be asked by', () => {
    const fields = crmLeadListFields({
      email: 'dana@acme.com',
      visibleTo: ['host:a'],
      leadSource: '  Trade   Show ',
    })
    expect(fields.status).toBe('new')
    expect(fields.leadSourceKey).toBe('trade show')
    expect(fields.emailStatus).toBe('none')
    expect(fields.scopedSearchTokens).toContain('host:a~dana')
    expect(fields.scopedSearchTokens).toContain('host:a~acme')
  })

  it('keeps a worked status and names a verdict by its status', () => {
    const fields = crmLeadListFields({
      status: 'working',
      emailState: { status: 'bounced', atMs: 1, source: 'campaign', detail: null },
    })
    expect(fields.status).toBe('working')
    expect(fields.emailStatus).toBe('bounced')
    expect(fields.leadSourceKey).toBeNull()
  })
})

describe('the verdict and lead source keys', () => {
  it('reads a missing or malformed verdict as none', () => {
    expect(crmEmailStatusKey({})).toBe('none')
    expect(crmEmailStatusKey({ emailState: 'bounced' })).toBe('none')
    expect(crmEmailStatusKey(null)).toBe('none')
  })

  it('compares a lead source the way the picklist compares labels', () => {
    expect(crmLeadSourceKey('Referral')).toBe(crmLeadSourceKey(' referral '))
    expect(crmLeadSourceKey('')).toBeNull()
    expect(crmLeadSourceKey(undefined)).toBeNull()
  })
})

describe('crmContactFacetKeys', () => {
  it('keys every holder and any holder, by value and by presence', () => {
    const keys = crmContactFacetKeys({
      facets: {
        'group-a': {
          ownerUid: 'uid-1',
          lifecycleStage: 'lead',
          sources: { form: true, order: false },
          companyId: 'co-1',
          tags: ['VIP'],
          custom: { plan: 'Enterprise', seats: 12, trial: false, 'bad key!': 'x' },
          ordersCount: 2,
          ltvCents: 4500,
        },
        'group-b': { ownerUid: 'uid-2', sources: {} },
      },
    })
    expect(keys).toEqual(
      expect.arrayContaining([
        crmFacetKey('group-a', 'owner', 'uid-1'),
        crmFacetKey('group-a', 'owner'),
        crmFacetKey('group-a', 'stage', 'lead'),
        crmFacetKey('group-a', 'source', 'form'),
        crmFacetKey('group-a', 'company', 'co-1'),
        crmFacetKey('group-a', 'tag', 'vip'),
        crmFacetKey('group-a', 'custom.plan', 'enterprise'),
        crmFacetKey('group-a', 'custom.seats', '12'),
        crmFacetKey('group-a', 'custom.trial', 'false'),
        crmFacetKey('group-a', 'orders'),
        crmFacetKey('group-a', 'ltv'),
        crmFacetKey('group-b', 'owner', 'uid-2'),
        crmFacetKey('*', 'owner', 'uid-1'),
        crmFacetKey('*', 'owner', 'uid-2'),
      ]),
    )
    expect(keys).not.toContain(crmFacetKey('group-a', 'source', 'order'))
    expect(keys.some((key) => key.includes('bad key'))).toBe(false)
    expect(keys).not.toContain(crmFacetKey('group-b', 'stage'))
    expect(keys).not.toContain(crmFacetKey('group-b', 'orders'))
  })

  it('carries no keys for a contact nobody holds', () => {
    expect(crmContactFacetKeys({ email: 'x@y.z' })).toEqual([])
  })
})

describe('restamping', () => {
  it('patches only the fields a record carries wrongly, and nothing on a current one', () => {
    const record = { title: 'Acme renewal', visibleTo: ['org'] }
    const patch = crmListFieldsPatch('deals', record)
    expect(Object.keys(patch).sort()).toEqual([
      // The contact role arrays (AGL-3521), empty on a deal with no contact.
      'contactRoleContactIds',
      'contactRoleKeys',
      'leadSourceKey',
      'scopedContactRoleContactIds',
      'scopedSearchTokens',
      'searchTokens',
      'titleLower',
      'typeKey',
    ])
    expect(crmListFieldsPatch('deals', { ...record, ...patch })).toEqual({})
  })

  it("keys a deal's Type and Lead source as the picklist compares them (AGL-3516)", () => {
    const fields = crmListFields('deals', {
      title: 'Acme renewal',
      visibleTo: ['org'],
      type: ' New  Business',
      leadSource: 'Trade show',
    })
    expect(fields).toMatchObject({ typeKey: 'new business', leadSourceKey: 'trade show' })
    expect(crmListFieldsTouched('deals', { type: 'Existing Business' })).toBe(true)
    expect(crmListFieldsTouched('deals', { leadSource: null })).toBe(true)
    expect(crmListFieldsTouched('deals', { nextStep: 'Call' })).toBe(false)
    // A deal's contacts are found by the arrays its roles stamp (AGL-3521).
    expect(crmListFieldsTouched('deals', { contactRoles: [] })).toBe(true)
    expect(crmListFieldsTouched('deals', { contactId: 'c1' })).toBe(true)
  })

  it('starts a new contact, company or deal with nothing scheduled', () => {
    expect(crmNewRecordListFields('companies', { name: 'Acme' })).toMatchObject({ nextTaskAtMs: null })
    expect(crmNewRecordListFields('crmTasks', { title: 'Call' })).not.toHaveProperty('nextTaskAtMs')
    // An undated task is still one every task view orders, and so reaches.
    expect(crmNewRecordListFields('crmTasks', { title: 'Call' })).toMatchObject({ dueAtMs: null })
    expect(crmNewRecordListFields('crmTasks', { title: 'Call', dueAtMs: 9 })).not.toHaveProperty('dueAtMs')
    expect(crmNewRecordListFields('leads', { email: 'a@b.c' })).not.toHaveProperty('nextTaskAtMs')
    expect(crmNewRecordListFields('deals', { title: 'x', nextTaskAtMs: 5 })).not.toHaveProperty('nextTaskAtMs')
  })

  it('knows which writes move the list fields', () => {
    expect(crmListFieldsTouched('contacts', { 'facets.g.ownerUid': 'u' })).toBe(true)
    expect(crmListFieldsTouched('contacts', { updatedAt: 1 })).toBe(false)
    expect(crmListFieldsTouched('leads', { status: 'working' })).toBe(true)
    expect(CRM_LIST_FIELD_INPUTS.deals).toContain('title')
  })
})

describe('the worked examples the backfill and the seeds share', () => {
  it.each(fixtures.records.map((entry, at) => [at, entry] as const))(
    'list fields #%i',
    (_at, entry) => {
      expect(crmListFields(entry.collection, entry.record)).toEqual(entry.expected)
    },
  )
  it.each(fixtures.newRecords.map((entry, at) => [at, entry] as const))(
    'a new record’s fields #%i',
    (_at, entry) => {
      expect(crmNewRecordListFields(entry.collection, entry.record)).toEqual(entry.expected)
    },
  )
})

describe('a field definition, as the Fields table asks for it (AGL-3335)', () => {
  it.each(fixtures.fieldDefinitions.map((entry, at) => [at, entry] as const))(
    'definition fields #%i',
    (_at, entry) => {
      expect(crmFieldListFields(entry.record)).toEqual(entry.expected)
    },
  )

  it('finds a key by any word of it, and by its whole spelling', () => {
    const { searchTokens } = crmFieldListFields({ key: 'plan_interest', label: 'Plan' })
    expect(searchTokens).toEqual(expect.arrayContaining(['plan', 'interest', 'plan_i']))
  })
})
