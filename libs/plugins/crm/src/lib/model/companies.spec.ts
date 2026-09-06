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
 * The rules a company write and a contact–company link obey (AGL-2597).
 *
 * Three writers touch the same association — the company page, the contact
 * page and the delete — and the facet and its `companyIds` mirror have to
 * stay in step across all of them. These pin the rule itself, with the
 * Firestore sentinels replaced by tagged values so an assertion can say
 * WHICH operation was chosen and not merely that one was.
 */

import {
  companyDetachUpdate,
  companyDraftFields,
  contactCompanyLinkUpdate,
  EMPTY_COMPANY_DRAFT,
  suggestCompanyForEmail,
} from './companies'

jest.mock('firebase/firestore', () => ({
  arrayUnion: (...values: unknown[]) => ({ op: 'arrayUnion', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'arrayRemove', values }),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
}))

const COMPANIES = [
  { id: 'c-acme', name: 'Acme', domain: 'acme.com' },
  { id: 'c-globex', name: 'Globex', domain: 'globex.example' },
  { id: 'c-none', name: 'No domain', domain: null },
]

describe('suggestCompanyForEmail', () => {
  it('matches on the normalized domain of the address', () => {
    expect(suggestCompanyForEmail('Jane@ACME.com', COMPANIES)?.id).toBe(
      'c-acme',
    )
  })

  it('suggests nothing for a public mailbox, whatever the list holds', () => {
    // A company filed under a mailbox provider's domain must not swallow
    // every consumer contact into one phantom account.
    const withGmail = [...COMPANIES, { id: 'c-gmail', name: 'G', domain: 'gmail.com' }]
    expect(suggestCompanyForEmail('jane@gmail.com', withGmail)).toBeNull()
  })

  it('suggests nothing for an address that is not one', () => {
    expect(suggestCompanyForEmail('not-an-email', COMPANIES)).toBeNull()
    expect(suggestCompanyForEmail('', COMPANIES)).toBeNull()
  })
})

describe('companyDraftFields', () => {
  it('refuses a draft with no name', () => {
    const result = companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: '  ' })
    expect(result.ok).toBe(false)
  })

  it('stores the search keys beside the name and normalizes what it keeps', () => {
    const result = companyDraftFields({
      ...EMPTY_COMPANY_DRAFT,
      name: '  Acme   Coffee ',
      domain: 'https://www.Acme.com/about?x=1',
      website: 'acme.com',
      phone: '(512) 555-0123',
      industry: 'Hospitality',
      ownerUid: 'uid-1',
      address: { line1: '1 Main St', country: 'us' },
      notes: 'Big account',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.set).toMatchObject({
      name: 'Acme Coffee',
      nameLower: 'acme coffee',
      domain: 'acme.com',
      website: 'https://acme.com/',
      phone: '+15125550123',
      industry: 'Hospitality',
      ownerUid: 'uid-1',
      address: { line1: '1 Main St', country: 'US' },
      notes: 'Big account',
    })
    // The word-prefix tokens the list's index carries, so "cof" finds it.
    expect(result.set['nameTokens']).toEqual(
      expect.arrayContaining(['a', 'acme', 'c', 'cof', 'coffee']),
    )
    expect(result.cleared).toEqual([])
  })

  it('names every blank optional field so an edit can delete it', () => {
    const result = companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: 'Acme' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleared).toEqual([
      'domain',
      'website',
      'phone',
      'industry',
      'ownerUid',
      'notes',
    ])
    // The address is nullable rather than absent: one stored shape for "none".
    expect(result.set['address']).toBeNull()
    expect('domain' in result.set).toBe(false)
  })

  it('refuses a domain that is not a hostname rather than storing nothing', () => {
    const result = companyDraftFields({
      ...EMPTY_COMPANY_DRAFT,
      name: 'Acme',
      domain: 'acme',
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses a phone number it cannot read confidently', () => {
    const result = companyDraftFields({
      ...EMPTY_COMPANY_DRAFT,
      name: 'Acme',
      phone: '12345',
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses a website that is not http(s)', () => {
    const result = companyDraftFields({
      ...EMPTY_COMPANY_DRAFT,
      name: 'Acme',
      website: 'javascript:alert(1)',
    })
    expect(result).toMatchObject({ ok: false })
  })
})

/** A contact held by two sites, one of which has filed them under Acme. */
const contactAt = (
  companyId: string | undefined,
  others: Record<string, string | undefined> = {},
) => ({
  email: 'jane@acme.com',
  companyIds: [companyId, ...Object.values(others)].filter(Boolean),
  facets: {
    'g-1': { sources: {}, interactions: [], companyId },
    ...Object.fromEntries(
      Object.entries(others).map(([group, id]) => [
        group,
        { sources: {}, interactions: [], companyId: id },
      ]),
    ),
  },
})

describe('contactCompanyLinkUpdate', () => {
  it('is a no-op when the facet already says what was asked', () => {
    expect(contactCompanyLinkUpdate(contactAt('c-acme'), 'g-1', 'c-acme')).toBeNull()
    expect(contactCompanyLinkUpdate(contactAt(undefined), 'g-1', null)).toBeNull()
  })

  it('links through a dotted facet path and an arrayUnion on the mirror', () => {
    const update = contactCompanyLinkUpdate(contactAt(undefined), 'g-1', 'c-acme')
    expect(update).toEqual({
      'facets.g-1.companyId': 'c-acme',
      companyIds: { op: 'arrayUnion', values: ['c-acme'] },
      updatedAt: { op: 'serverTimestamp' },
    })
    // Never a nested object: that would replace every other holder's facet.
    expect(update && 'facets' in update).toBe(false)
  })

  it('moves between companies by rewriting the mirror, dropping the old id', () => {
    const update = contactCompanyLinkUpdate(contactAt('c-acme'), 'g-1', 'c-globex')
    expect(update).toMatchObject({
      'facets.g-1.companyId': 'c-globex',
      companyIds: ['c-globex'],
    })
  })

  it('keeps an old id in the mirror while another holder still names it', () => {
    // Site g-2 also filed Jane under Acme; g-1 moving her must not take
    // g-2's link out of the query index.
    const update = contactCompanyLinkUpdate(
      contactAt('c-acme', { 'g-2': 'c-acme' }),
      'g-1',
      'c-globex',
    )
    expect(update).toMatchObject({
      'facets.g-1.companyId': 'c-globex',
      companyIds: ['c-acme', 'c-globex'],
    })
  })

  it('unlinks with a facet delete and an arrayRemove, unless held elsewhere', () => {
    expect(contactCompanyLinkUpdate(contactAt('c-acme'), 'g-1', null)).toEqual({
      'facets.g-1.companyId': { op: 'delete' },
      companyIds: { op: 'arrayRemove', values: ['c-acme'] },
      updatedAt: { op: 'serverTimestamp' },
    })
    const shared = contactCompanyLinkUpdate(
      contactAt('c-acme', { 'g-2': 'c-acme' }),
      'g-1',
      null,
    )
    expect(shared).toEqual({
      'facets.g-1.companyId': { op: 'delete' },
      updatedAt: { op: 'serverTimestamp' },
    })
  })
})

describe('companyDetachUpdate', () => {
  it('removes the id from the mirror and clears EVERY facet naming it', () => {
    const update = companyDetachUpdate(
      contactAt('c-acme', { 'g-2': 'c-acme', 'g-3': 'c-globex' }),
      'c-acme',
    )
    expect(update).toEqual({
      companyIds: { op: 'arrayRemove', values: ['c-acme'] },
      'facets.g-1.companyId': { op: 'delete' },
      'facets.g-2.companyId': { op: 'delete' },
      updatedAt: { op: 'serverTimestamp' },
    })
    // g-3's link to a different company is not touched.
    expect('facets.g-3.companyId' in update).toBe(false)
  })
})
