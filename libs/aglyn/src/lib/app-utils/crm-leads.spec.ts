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
  crmLeadDisplayName,
  crmLeadStatus,
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
      'company',
      'jobTitle',
      'phone',
      'website',
      'address',
      'tags',
      'leadSource',
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

  it('recognizes only the four statuses', () => {
    expect(isCrmLeadStatus('working')).toBe(true)
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

  it('treats new and working as open, and the two closed states as not', () => {
    expect(CRM_LEAD_OPEN_STATUSES).toEqual(['new', 'working'])
    expect(isCrmLeadOpen({})).toBe(true)
    expect(isCrmLeadOpen({ status: 'working' })).toBe(true)
    expect(isCrmLeadOpen({ status: 'qualified' })).toBe(false)
    expect(isCrmLeadOpen({ status: 'unqualified' })).toBe(false)
  })
})
