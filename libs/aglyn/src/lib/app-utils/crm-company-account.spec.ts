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

import {
  CRM_COMPANY_PARENT_DEPTH_MAX,
  CRM_COMPANY_PICKLIST_FIELDS,
  CRM_LIST_FIELD_INPUTS,
  type CrmCompanyParentReader,
  crmCompanyListFields,
  crmCompanyParentRefusal,
  crmListFieldsTouched,
  crmPicklistDefinition,
  crmPicklistDefinitionsFor,
  effectiveCrmPicklist,
  isStandardCrmPicklistValue,
  judgeCrmCompanyPicklists,
  readCrmCompanyAccountFields,
} from './crm'

/**
 * A COMPANY CARRIES SALESFORCE'S ACCOUNT FIELDS (AGL-3514): Type, Industry,
 * Rating and Ownership as the org's picklists, Account Source as a lead
 * source value, the other account fields through one reader, and a parent
 * that is never the company itself or one below it.
 */
describe('the company picklists', () => {
  it('registers Type, Industry, Rating and Ownership on the Companies tab with Salesforce’s values', () => {
    expect(crmPicklistDefinitionsFor('company').map((definition) => definition.id)).toEqual([
      'accountType',
      'industry',
      'rating',
      'ownership',
    ])
    const labels = (id: 'accountType' | 'industry' | 'rating' | 'ownership') =>
      effectiveCrmPicklist(id, undefined).values.map((value) => value.label)
    expect(labels('accountType')).toEqual([
      'Analyst',
      'Press',
      'Competitor',
      'Prospect',
      'Customer',
      'Reseller',
      'Integrator',
      'Investor',
      'Partner',
      'Consulting',
      'Other',
    ])
    expect(labels('industry')).toHaveLength(32)
    expect(labels('industry')).toEqual(expect.arrayContaining(['Food & Beverage', 'Not For Profit', 'Other']))
    expect(labels('rating')).toEqual(['Hot', 'Warm', 'Cold'])
    expect(labels('ownership')).toEqual(['Public', 'Private', 'Subsidiary', 'Other'])
    expect(isStandardCrmPicklistValue('industry', 'food-and-beverage')).toBe(true)
  })

  it('names the field and its key each list rewrites on a rename', () => {
    expect(crmPicklistDefinition('accountType')?.targets).toEqual([
      { object: 'company', field: 'type', keyField: 'typeKey' },
    ])
    // Shared with leads (AGL-3513), so a lead converts into the same value.
    expect(crmPicklistDefinition('industry')?.targets).toEqual([
      { object: 'company', field: 'industry', keyField: 'industryKey' },
      { object: 'lead', field: 'industry', keyField: 'industryKey' },
    ])
    expect(crmPicklistDefinition('rating')?.targets).toEqual([
      { object: 'company', field: 'rating', keyField: 'ratingKey' },
      { object: 'lead', field: 'rating', keyField: 'ratingKey' },
    ])
    expect(crmPicklistDefinition('ownership')?.targets).toEqual([
      { object: 'company', field: 'ownership' },
    ])
    // Account Source is the lead source list's, so a rename follows it.
    expect(CRM_COMPANY_PICKLIST_FIELDS.find((entry) => entry.field === 'accountSource')?.picklistId).toBe(
      'leadSource',
    )
  })
})

describe('judgeCrmCompanyPicklists', () => {
  const industry = effectiveCrmPicklist('industry', {
    values: [{ id: 'roofing', label: 'Roofing', active: true }],
    defaultValueId: 'roofing',
  })

  it('stores each list’s spelling, clears a blank and leaves an unnamed field alone', () => {
    expect(
      judgeCrmCompanyPicklists({ industry }, { type: ' customer ', industry: 'ROOFING', rating: '' }),
    ).toEqual({ values: { type: 'Customer', industry: 'Roofing', rating: null }, errors: {} })
  })

  it('refuses a value outside the list naming the field, and keeps the value a company already holds', () => {
    const refused = judgeCrmCompanyPicklists({}, { industry: 'Roofing', accountSource: 'Billboard' })
    expect(Object.keys(refused.errors)).toEqual(['industry', 'accountSource'])
    expect(refused.errors.industry).toMatch(/^Industry must be one of: /)
    expect(refused.errors.accountSource).toMatch(/^Lead source must be one of: /)
    // An industry typed while the field was free text stays until it is changed.
    expect(
      judgeCrmCompanyPicklists({}, { industry: 'artisanal roofing' }, { current: { industry: 'Artisanal Roofing' } }),
    ).toEqual({ values: { industry: 'Artisanal Roofing' }, errors: {} })
  })

  it('starts a new company on each list’s default, and only a new one', () => {
    expect(judgeCrmCompanyPicklists({ industry }, {}, { created: true }).values).toEqual({ industry: 'Roofing' })
    expect(judgeCrmCompanyPicklists({ industry }, {}).values).toEqual({})
  })
})

describe('readCrmCompanyAccountFields', () => {
  it('normalizes each field it is given and ignores the rest', () => {
    expect(
      readCrmCompanyAccountFields({
        annualRevenueCents: 125_000_000_00,
        currency: ' EUR ',
        numberOfEmployees: 250,
        fax: '(512) 555-0124',
        accountNumber: '  ACME   001 ',
        site: 'Headquarters',
        tickerSymbol: 'ACME',
        sicCode: '5045',
        shippingAddress: { line1: ' 1 Dock Rd ', country: 'us' },
        name: 'ignored',
      }),
    ).toEqual({
      values: {
        annualRevenueCents: 125_000_000_00,
        currency: 'eur',
        numberOfEmployees: 250,
        fax: '+15125550124',
        accountNumber: 'ACME 001',
        site: 'Headquarters',
        tickerSymbol: 'ACME',
        sicCode: '5045',
        shippingAddress: { line1: '1 Dock Rd', country: 'US' },
      },
      errors: {},
    })
  })

  it('reads null and a blank as a clear', () => {
    expect(readCrmCompanyAccountFields({ fax: '', shippingAddress: null, numberOfEmployees: null })).toEqual({
      values: { fax: null, shippingAddress: null, numberOfEmployees: null },
      errors: {},
    })
  })

  it('names every field it cannot store', () => {
    expect(
      Object.keys(
        readCrmCompanyAccountFields({
          annualRevenueCents: 12.5,
          currency: 'dollars',
          numberOfEmployees: -1,
          fax: '123',
          tickerSymbol: 'X'.repeat(21),
          shippingAddress: 'Main St',
        }).errors,
      ),
    ).toEqual(['annualRevenueCents', 'currency', 'numberOfEmployees', 'fax', 'tickerSymbol', 'shippingAddress'])
  })
})

describe('crmCompanyParentRefusal', () => {
  // acme ← west ← west-retail, and globex on its own.
  const parents: Record<string, string | null> = {
    acme: null,
    west: 'acme',
    'west-retail': 'west',
    globex: null,
  }
  const read: CrmCompanyParentReader = async (id) =>
    id in parents ? { parentCompanyId: parents[id] } : null

  it('allows a company the writer can see, at any depth above it', async () => {
    await expect(crmCompanyParentRefusal('globex', 'west-retail', read)).resolves.toBeNull()
    await expect(crmCompanyParentRefusal(null, 'acme', read)).resolves.toBeNull()
  })

  it('refuses the company itself, one below it, and one that is not there', async () => {
    await expect(crmCompanyParentRefusal('acme', 'acme', read)).resolves.toMatch(/its own parent/)
    await expect(crmCompanyParentRefusal('acme', 'west-retail', read)).resolves.toMatch(/sits under this one/)
    await expect(crmCompanyParentRefusal('acme', 'initech', read)).resolves.toMatch(/no such parent/)
  })

  it('stops at a chain deeper than the bound, and at a loop it is not part of', async () => {
    const deep: Record<string, string | null> = {}
    for (let at = 0; at <= CRM_COMPANY_PARENT_DEPTH_MAX + 1; at += 1) deep[`c${at}`] = `c${at + 1}`
    const readDeep: CrmCompanyParentReader = async (id) => ({ parentCompanyId: deep[id] ?? null })
    await expect(crmCompanyParentRefusal('new', 'c0', readDeep)).resolves.toMatch(/at most/)
    const loop: CrmCompanyParentReader = async (id) => ({ parentCompanyId: id === 'a' ? 'b' : 'a' })
    await expect(crmCompanyParentRefusal('z', 'a', loop)).resolves.toBeNull()
  })
})

describe('the Companies list fields', () => {
  it('keys each filtered picklist beside its label, null for none', () => {
    const fields = crmCompanyListFields({
      name: 'Acme',
      visibleTo: ['org'],
      type: 'Customer',
      industry: '  Food   &  Beverage ',
      accountSource: 'Trade show',
    })
    expect(fields).toMatchObject({
      typeKey: 'customer',
      industryKey: 'food & beverage',
      ratingKey: null,
      accountSourceKey: 'trade show',
    })
  })

  it('restamps a company whose picklist label changes', () => {
    expect(CRM_LIST_FIELD_INPUTS.companies).toEqual(
      expect.arrayContaining(['type', 'industry', 'rating', 'accountSource']),
    )
    expect(crmListFieldsTouched('companies', { rating: 'Hot' })).toBe(true)
    expect(crmListFieldsTouched('companies', { fax: '+15125550124' })).toBe(false)
  })
})
