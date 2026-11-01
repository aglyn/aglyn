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
 * THE ROLLUP (AGL-4123). A company's timeline lists every activity that
 * carries its id, so the rule that stamps that id is the rule that decides
 * what a company's page says happened: the writer's company, else the deal's,
 * else the contact's, and the contact's only through a facet.
 */

import type { CrmActivityRecordReads } from './crm-activity-link'
import {
  crmActivityCompanyId,
  crmActivityLinkFromPicks,
  crmActivityPicksEqual,
  crmActivityPicksFrom,
  resolveCrmActivityCompany,
  stampCrmActivityCompany,
} from './crm-activity-link'

const contactAt = (companyId: string, group = 'site-1') => ({
  capturedByHostIds: [group],
  facets: { [group]: { companyId } },
})

describe('crmActivityCompanyId', () => {
  it('keeps a company the writer named, over the deal and the contact', () => {
    expect(
      crmActivityCompanyId(
        { companyId: 'co-named' },
        { deal: { companyId: 'co-deal' }, contact: contactAt('co-contact'), groupId: 'site-1' },
      ),
    ).toBe('co-named')
  })

  it('takes the deal’s company before the contact’s', () => {
    expect(
      crmActivityCompanyId(
        {},
        { deal: { companyId: 'co-deal' }, contact: contactAt('co-contact'), groupId: 'site-1' },
      ),
    ).toBe('co-deal')
  })

  it('falls through a deal with no company to the contact’s', () => {
    expect(
      crmActivityCompanyId({}, { deal: {}, contact: contactAt('co-contact'), groupId: 'site-1' }),
    ).toBe('co-contact')
  })

  it('reads the facet of the holder the writer names, never another holder’s', () => {
    const contact = {
      companyIds: ['co-sibling'],
      facets: { 'site-2': { companyId: 'co-sibling' } },
    }
    expect(crmActivityCompanyId({}, { contact, groupId: 'site-1' })).toBeNull()
  })

  it('reads the organization’s own facet for a site with no link of its own (AGL-4122)', () => {
    const contact = { facets: { org: { companyId: 'co-org' } } }
    expect(crmActivityCompanyId({}, { contact, groupId: 'site-1' })).toBe('co-org')
    expect(crmActivityCompanyId({}, { contact })).toBe('co-org')
    const both = { facets: { org: { companyId: 'co-org' }, 'site-1': { companyId: 'co-site' } } }
    expect(crmActivityCompanyId({}, { contact: both, groupId: 'site-1' })).toBe('co-site')
  })

  it('reads the person’s primary holder for a writer at the organization', () => {
    expect(crmActivityCompanyId({}, { contact: contactAt('co-contact') })).toBe('co-contact')
  })

  it('answers nothing when nothing names a company', () => {
    expect(crmActivityCompanyId({}, {})).toBeNull()
    expect(crmActivityCompanyId({ companyId: '' }, { deal: { companyId: 7 } })).toBeNull()
  })
})

describe('stampCrmActivityCompany', () => {
  it('adds the company beside the links the writer gave', () => {
    expect(
      stampCrmActivityCompany(
        { contactId: 'c-1', dealId: 'd-1' },
        { deal: { companyId: 'co-1' } },
      ),
    ).toEqual({ contactId: 'c-1', dealId: 'd-1', companyId: 'co-1' })
  })

  it('leaves no blank key on a link with no company to find', () => {
    expect(stampCrmActivityCompany({ leadId: 'l-1' }, {})).toEqual({ leadId: 'l-1' })
  })
})

describe('resolveCrmActivityCompany', () => {
  const reads = (records: {
    deal?: Record<string, unknown> | Error
    contact?: Record<string, unknown> | Error
  }) => {
    const answer = async (record?: Record<string, unknown> | Error) => {
      if (record instanceof Error) throw record
      return record ?? null
    }
    return {
      deal: jest.fn(() => answer(records.deal)),
      contact: jest.fn(() => answer(records.contact)),
    } satisfies CrmActivityRecordReads
  }

  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  it('reads nothing for a company the writer named', async () => {
    const lookup = reads({})
    await expect(
      resolveCrmActivityCompany({ contactId: 'c-1', companyId: 'co-1' }, {}, lookup),
    ).resolves.toEqual({ contactId: 'c-1', companyId: 'co-1' })
    expect(lookup.deal).not.toHaveBeenCalled()
    expect(lookup.contact).not.toHaveBeenCalled()
  })

  it('reads the contact only when the deal names no company', async () => {
    const dealHasOne = reads({ deal: { companyId: 'co-deal' } })
    await expect(
      resolveCrmActivityCompany({ dealId: 'd-1', contactId: 'c-1' }, {}, dealHasOne),
    ).resolves.toMatchObject({ companyId: 'co-deal' })
    expect(dealHasOne.contact).not.toHaveBeenCalled()

    const dealHasNone = reads({ deal: {}, contact: contactAt('co-contact') })
    await expect(
      resolveCrmActivityCompany(
        { dealId: 'd-1', contactId: 'c-1' },
        { groupId: 'site-1' },
        dealHasNone,
      ),
    ).resolves.toMatchObject({ companyId: 'co-contact' })
  })

  it('spends no read on what the writer already holds', async () => {
    const lookup = reads({})
    await resolveCrmActivityCompany(
      { dealId: 'd-1', contactId: 'c-1' },
      { deal: {}, contact: contactAt('co-contact'), groupId: 'site-1' },
      lookup,
    )
    expect(lookup.deal).not.toHaveBeenCalled()
    expect(lookup.contact).not.toHaveBeenCalled()
  })

  it('never costs the entry: a refused read leaves the links it has', async () => {
    const lookup = reads({ deal: new Error('denied'), contact: contactAt('co-contact') })
    await expect(
      resolveCrmActivityCompany({ dealId: 'd-1', contactId: 'c-1' }, { groupId: 'site-1' }, lookup),
    ).resolves.toEqual({ dealId: 'd-1', contactId: 'c-1', companyId: 'co-contact' })

    const refused = reads({ contact: new Error('denied') })
    await expect(
      resolveCrmActivityCompany({ contactId: 'c-1' }, {}, refused),
    ).resolves.toEqual({ contactId: 'c-1' })
  })
})

describe('the Name and Related To fields', () => {
  it('opens on a deal with its Primary, on a company with no one, on a contact with no What', () => {
    expect(crmActivityPicksFrom({ dealId: 'd-1' }, 'c-primary')).toEqual({
      contactId: 'c-primary',
      related: { kind: 'deal', id: 'd-1' },
    })
    expect(crmActivityPicksFrom({ companyId: 'co-1' })).toEqual({
      contactId: null,
      related: { kind: 'company', id: 'co-1' },
    })
    expect(crmActivityPicksFrom({ contactId: 'c-1' })).toEqual({ contactId: 'c-1', related: null })
  })

  it('reads a filed activity’s What as its deal, the company being its rollup', () => {
    expect(
      crmActivityPicksFrom({ contactId: 'c-1', dealId: 'd-1', companyId: 'co-1' }),
    ).toEqual({ contactId: 'c-1', related: { kind: 'deal', id: 'd-1' } })
  })

  it('keeps a contact the link already names over the deal’s Primary', () => {
    expect(crmActivityPicksFrom({ contactId: 'c-1', dealId: 'd-1' }, 'c-primary').contactId).toBe('c-1')
  })

  it('turns the fields into links, and keeps a lead’s own', () => {
    expect(
      crmActivityLinkFromPicks({ contactId: 'c-1', related: { kind: 'deal', id: 'd-1' } }),
    ).toEqual({ contactId: 'c-1', dealId: 'd-1' })
    expect(
      crmActivityLinkFromPicks({ contactId: null, related: { kind: 'company', id: 'co-1' } }),
    ).toEqual({ companyId: 'co-1' })
    expect(crmActivityLinkFromPicks({ contactId: null, related: null }, 'l-1')).toEqual({
      leadId: 'l-1',
    })
  })

  it('compares two sets of picks by the records they name', () => {
    const picks = { contactId: 'c-1', related: { kind: 'deal' as const, id: 'd-1' } }
    expect(crmActivityPicksEqual(picks, { ...picks, related: { ...picks.related } })).toBe(true)
    expect(crmActivityPicksEqual(picks, { ...picks, contactId: null })).toBe(false)
    expect(crmActivityPicksEqual(picks, { ...picks, related: null })).toBe(false)
  })
})
