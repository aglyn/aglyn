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
 * The rules a company write obeys (AGL-2597): what a company draft is stored
 * as, and which company an address suggests.
 *
 * A contact's link to a company is the server's to write (AGL-2804); its
 * planner is pinned in `@aglyn/aglyn`'s CRM spec, and the writes built from
 * it in the routes' own specs.
 */

import { effectiveCrmPicklist } from '@aglyn/aglyn'
import {
  companyDraftFields,
  companyDraftFrom,
  EMPTY_COMPANY_DRAFT,
  suggestCompanyForEmail,
} from './companies'

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
      fax: '(512) 555-0124',
      type: 'customer',
      industry: 'Hospitality',
      rating: 'HOT',
      ownership: 'Private',
      accountSource: 'trade show',
      annualRevenue: '$1,250,000.50',
      currency: 'eur',
      numberOfEmployees: '1,200',
      accountNumber: ' ACME-001 ',
      site: 'Headquarters',
      tickerSymbol: 'ACME',
      sicCode: '5812',
      parentCompanyId: 'parent-1',
      ownerUid: 'uid-1',
      address: { line1: '1 Main St', country: 'us' },
      shippingAddress: { line1: '1 Dock Rd', country: 'us' },
      tags: 'Enterprise',
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
      fax: '+15125550124',
      // Each picklist as its list spells it (AGL-3514).
      type: 'Customer',
      industry: 'Hospitality',
      rating: 'Hot',
      ownership: 'Private',
      accountSource: 'Trade show',
      annualRevenueCents: 125_000_050,
      currency: 'eur',
      numberOfEmployees: 1200,
      accountNumber: 'ACME-001',
      site: 'Headquarters',
      tickerSymbol: 'ACME',
      sicCode: '5812',
      parentCompanyId: 'parent-1',
      ownerUid: 'uid-1',
      address: { line1: '1 Main St', country: 'US' },
      shippingAddress: { line1: '1 Dock Rd', country: 'US' },
      tags: ['enterprise'],
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
      'type',
      'industry',
      'rating',
      'ownership',
      'accountSource',
      'ownerUid',
      'annualRevenueCents',
      // No revenue, so no currency to describe it.
      'currency',
      'numberOfEmployees',
      'fax',
      'accountNumber',
      'site',
      'tickerSymbol',
      'sicCode',
      'parentCompanyId',
      'tags',
      'notes',
    ])
    // The addresses are nullable rather than absent: one stored shape for "none".
    expect(result.set['address']).toBeNull()
    expect(result.set['shippingAddress']).toBeNull()
    expect('domain' in result.set).toBe(false)
  })

  it('stores the tags as a contact stores them: lowercased, deduplicated, capped', () => {
    const result = companyDraftFields({
      ...EMPTY_COMPANY_DRAFT,
      name: 'Acme',
      tags: ' VIP, west | vip,, East ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.set['tags']).toEqual(['vip', 'west', 'east'])
    expect(result.cleared).not.toContain('tags')
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

  it('judges each picklist against the org’s list, keeping the value the company already holds (AGL-3514)', () => {
    const lists = {
      industry: effectiveCrmPicklist('industry', {
        values: [{ id: 'roofing', label: 'Roofing', active: true }],
      }),
    }
    const refused = companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: 'Acme', industry: 'Artisanal roofing' }, { lists })
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^Industry must be one of: /) })
    // A company whose industry was typed before Industry was a picklist keeps it.
    const kept = companyDraftFields(
      { ...EMPTY_COMPANY_DRAFT, name: 'Acme', industry: 'Artisanal roofing' },
      { lists, current: { industry: 'Artisanal roofing' } },
    )
    expect(kept).toMatchObject({ ok: true, set: { industry: 'Artisanal roofing' } })
    expect(
      companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: 'Acme', industry: 'roofing' }, { lists }),
    ).toMatchObject({ ok: true, set: { industry: 'Roofing' } })
  })

  it('refuses an account field it cannot store, naming it', () => {
    expect(companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: 'Acme', fax: '123' })).toEqual({
      ok: false,
      error: 'The fax number must be a phone number with a country code, like +15125550123.',
    })
    expect(companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: 'Acme', numberOfEmployees: 'lots' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Employees must be a whole number/),
    })
    expect(companyDraftFields({ ...EMPTY_COMPANY_DRAFT, name: 'Acme', annualRevenue: 'ten' })).toEqual({
      ok: false,
      error: 'The annual revenue is not an amount.',
    })
  })

  it('starts a stored company’s draft from every field, revenue in major units', () => {
    expect(
      companyDraftFrom({
        name: 'Acme',
        annualRevenueCents: 125_000_050,
        currency: 'EUR',
        numberOfEmployees: 1200,
        type: 'Customer',
        rating: null,
        shippingAddress: { city: 'Austin' },
        parentCompanyId: 'parent-1',
      }),
    ).toMatchObject({
      annualRevenue: '1250000.50',
      currency: 'eur',
      numberOfEmployees: '1200',
      type: 'Customer',
      rating: '',
      shippingAddress: { city: 'Austin' },
      parentCompanyId: 'parent-1',
    })
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
