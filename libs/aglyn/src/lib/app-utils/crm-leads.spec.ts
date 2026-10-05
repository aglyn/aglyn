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
  CRM_LEAD_OPEN_STATUSES,
  CRM_LEAD_PROFILE_KEYS,
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_STATUSES,
  CRM_LEAD_TAGS_MAX,
  crmLeadComposedName,
  crmLeadDisplayName,
  crmLeadListFields,
  crmLeadStatus,
  CRM_LIST_FIELD_INPUTS,
  effectiveCrmPicklist,
  judgeCrmLeadPicklists,
  isCrmLeadOpen,
  isCrmLeadStatus,
  normalizeCrmLeadProfile,
  normalizeCrmLeadTags,
} from './crm'

/**
 * The lead's own profile (AGL-3231): every field through the normalizer
 * the record keeps it in, a key present and empty as a clear, a key absent
 * as untouched, and a value the record cannot hold refused under its field.
 */
describe('normalizeCrmLeadProfile', () => {
  it('normalizes each field the way the record stores it', () => {
    expect(
      normalizeCrmLeadProfile({
        company: ' Acme   Brands ',
        jobTitle: 'CMO',
        phone: '(512) 555-0107',
        website: 'acme.com',
        address: { city: ' Austin ', country: 'us' },
        tags: 'ICP2, a-list, icp2',
        leadSource: 'Sales Navigator',
      }),
    ).toEqual({
      patch: {
        company: 'Acme Brands',
        jobTitle: 'CMO',
        phone: '+15125550107',
        website: 'https://acme.com/',
        address: { city: 'Austin', country: 'US' },
        tags: ['icp2', 'a-list'],
        leadSource: 'Sales Navigator',
      },
      errors: {},
    })
  })

  it('reads an empty value as a clear and an absent key as untouched', () => {
    expect(
      normalizeCrmLeadProfile({
        company: '',
        phone: null,
        website: '  ',
        address: { city: '' },
        tags: [],
      }),
    ).toEqual({
      patch: { company: null, phone: null, website: null, address: null, tags: null },
      errors: {},
    })
    expect(normalizeCrmLeadProfile({})).toEqual({ patch: {}, errors: {} })
    expect(normalizeCrmLeadProfile(null)).toEqual({ patch: {}, errors: {} })
  })

  it('refuses a phone or a website it cannot hold, under the field, and keeps the rest', () => {
    const { patch, errors } = normalizeCrmLeadProfile({
      company: 'Acme',
      phone: 'call me',
      website: 'javascript:alert(1)',
    })
    expect(patch).toEqual({ company: 'Acme' })
    expect(Object.keys(errors).sort()).toEqual(['phone', 'website'])
  })

  it('caps tags where the contact caps them, from a list or a string', () => {
    const many = Array.from({ length: CRM_LEAD_TAGS_MAX + 5 }, (_, i) => `t${i}`)
    expect(normalizeCrmLeadTags(many)).toHaveLength(CRM_LEAD_TAGS_MAX)
    expect(normalizeCrmLeadTags(' A , b ,, B ')).toEqual(['a', 'b'])
    expect(normalizeCrmLeadTags(undefined)).toEqual([])
  })

  it('lists every profile key once, in the card’s order', () => {
    expect([...CRM_LEAD_PROFILE_KEYS]).toEqual([
      'salutation',
      'firstName',
      'lastName',
      'company',
      'jobTitle',
      'phone',
      'mobilePhone',
      'fax',
      'doNotCall',
      'website',
      'address',
      'tags',
      'leadSource',
      'industry',
      'rating',
      'annualRevenueCents',
      'currency',
      'numberOfEmployees',
    ])
  })

  it('names a lead by its name, else by its address', () => {
    expect(crmLeadDisplayName({ name: ' Ada ', email: 'ada@example.com' })).toBe('Ada')
    expect(crmLeadDisplayName({ email: 'ada@example.com' })).toBe('ada@example.com')
    expect(crmLeadDisplayName(null)).toBe('')
  })
})

/**
 * The lead working state (AGL-2608): a status the list filters on, and the
 * reading of a lead that has never been given one.
 */
describe('lead statuses', () => {
  it('labels every status', () => {
    for (const status of CRM_LEAD_STATUSES) {
      expect(CRM_LEAD_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('recognizes only the five statuses', () => {
    expect(isCrmLeadStatus('working')).toBe(true)
    expect(isCrmLeadStatus('nurturing')).toBe(true)
    expect(isCrmLeadStatus('converted')).toBe(false)
    expect(isCrmLeadStatus(undefined)).toBe(false)
  })

  /**
   * Every lead the capture door writes carries no status, and so does every
   * lead captured before the CRM existed. Reading that as `new` is what makes
   * the section list them on the day it ships.
   */
  it('reads an absent or unknown status as new', () => {
    expect(crmLeadStatus(undefined)).toBe('new')
    expect(crmLeadStatus({})).toBe('new')
    expect(crmLeadStatus({ status: 'archived' as never })).toBe('new')
    expect(crmLeadStatus({ status: 'unqualified' })).toBe('unqualified')
  })

  it('treats new, nurturing and working as open, and the two closed states as not', () => {
    expect(CRM_LEAD_OPEN_STATUSES).toEqual(['new', 'nurturing', 'working'])
    expect(isCrmLeadOpen({ status: 'nurturing' })).toBe(true)
    expect(isCrmLeadOpen({})).toBe(true)
    expect(isCrmLeadOpen({ status: 'working' })).toBe(true)
    expect(isCrmLeadOpen({ status: 'qualified' })).toBe(false)
    expect(isCrmLeadOpen({ status: 'unqualified' })).toBe(false)
  })
})

/*
 * SALESFORCE'S STANDARD LEAD FIELDS (AGL-3513): the name's parts, the
 * phones, Do not call, Salutation/Industry/Rating, size and revenue.
 */
describe("the lead's standard fields", () => {
  it('normalizes each as the contact and the company keep it', () => {
    expect(
      normalizeCrmLeadProfile({
        salutation: ' Dr. ',
        firstName: '  Maya  Ann ',
        lastName: 'Quinn',
        mobilePhone: '(512) 555-0108',
        fax: '+1 512 555 0109',
        doNotCall: true,
        industry: ' Food   & Beverage ',
        rating: 'Hot',
        annualRevenueCents: 125000050,
        currency: 'EUR',
        numberOfEmployees: '1,200',
      }),
    ).toEqual({
      patch: {
        salutation: 'Dr.',
        firstName: 'Maya Ann',
        lastName: 'Quinn',
        mobilePhone: '+15125550108',
        fax: '+15125550109',
        doNotCall: true,
        industry: 'Food & Beverage',
        rating: 'Hot',
        annualRevenueCents: 125000050,
        currency: 'eur',
        numberOfEmployees: 1200,
      },
      errors: {},
    })
  })

  it('clears with a blank, stores Do not call only as true, and refuses what it cannot hold', () => {
    expect(
      normalizeCrmLeadProfile({
        salutation: '',
        firstName: ' ',
        doNotCall: false,
        annualRevenueCents: null,
        numberOfEmployees: '',
      }).patch,
    ).toEqual({
      salutation: null,
      firstName: null,
      doNotCall: null,
      annualRevenueCents: null,
      numberOfEmployees: null,
    })
    const refused = normalizeCrmLeadProfile({
      mobilePhone: 'call me',
      fax: '12',
      annualRevenueCents: -5,
      currency: 'euro',
      numberOfEmployees: 'lots',
    })
    expect(Object.keys(refused.errors).sort()).toEqual([
      'annualRevenueCents',
      'currency',
      'fax',
      'mobilePhone',
      'numberOfEmployees',
    ])
    expect(refused.patch).toEqual({})
  })

  it('composes the name from the parts, and never splits a name-only lead', () => {
    expect(crmLeadComposedName({ name: 'Maya Q' }, { firstName: 'Maya', lastName: 'Quinn' })).toBe(
      'Maya Quinn',
    )
    // The part the write leaves alone is read from the lead.
    expect(crmLeadComposedName({ firstName: 'Maya', lastName: 'Quinn' }, { lastName: 'Ng' })).toBe(
      'Maya Ng',
    )
    expect(crmLeadComposedName({ firstName: 'Maya', lastName: 'Quinn' }, { firstName: null })).toBe(
      'Quinn',
    )
    // A write naming neither part, or clearing both, leaves the name as it stands.
    expect(crmLeadComposedName({ name: 'Maya Q' }, {})).toBeUndefined()
    expect(crmLeadComposedName({ firstName: 'Maya' }, { firstName: null })).toBeUndefined()
  })

  it("judges Salutation, Industry and Rating against the org's lists, keeping the current value", () => {
    const lists = {
      salutation: effectiveCrmPicklist('salutation', null),
      industry: effectiveCrmPicklist('industry', {
        values: [{ id: 'tech', label: 'Technology', active: false }],
      }),
      rating: effectiveCrmPicklist('rating', {
        values: [{ id: 'warm', label: 'Warm' }],
        defaultValueId: 'warm',
      }),
    }
    expect(
      judgeCrmLeadPicklists(lists, { salutation: 'dr.', industry: 'banking', rating: 'Freezing' }),
    ).toEqual({
      values: { salutation: 'Dr.', industry: 'Banking' },
      errors: { rating: expect.stringContaining('Rating') },
    })
    // A deactivated value the lead already holds is kept.
    expect(
      judgeCrmLeadPicklists(lists, { industry: 'Technology' }, { current: { industry: 'Technology' } })
        .values,
    ).toEqual({ industry: 'Technology' })
    // A create starts each field it does not name from its list's default.
    expect(judgeCrmLeadPicklists(lists, {}, { created: true }).values).toEqual({ rating: 'Warm' })
    expect(judgeCrmLeadPicklists(lists, { rating: '' }).values).toEqual({ rating: null })
  })

  it('keys Industry and Rating for the Leads list, and restamps on either', () => {
    const fields = crmLeadListFields({ industry: ' Food  & Beverage', rating: 'Hot' })
    expect(fields.industryKey).toBe('food & beverage')
    expect(fields.ratingKey).toBe('hot')
    expect(crmLeadListFields({}).industryKey).toBeNull()
    expect(CRM_LIST_FIELD_INPUTS.leads).toEqual(expect.arrayContaining(['industry', 'rating']))
  })
})
