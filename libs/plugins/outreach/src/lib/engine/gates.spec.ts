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
 *
 * @jest-environment node
 */

import type { OutreachAttestations } from '../model/outreach.types'
import {
  evaluateOutreachGates,
  isColdOutreachContact,
  isOutreachCustomer,
  normalizeOutreachPersonalLine,
  type OutreachGateInput,
  type OutreachGateLookups,
  outreachAttestationHolds,
} from './gates'
import {
  countryFromEmailDomain,
  outreachCountryName,
  resolveOutreachRecipientCountry,
} from './recipient-country'

const GROUP = 'group-site-1'
const PROSPECT = 'casey@example.com'

/** A contact as stored: one holder's facet, keyed by its group. */
const contact = (facet: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  email: PROSPECT,
  name: 'Casey Morgan',
  facets: {
    [GROUP]: { sources: { import: true }, interactions: [], ...facet },
  },
  ...top,
})

const US_ADDRESS = { line1: '100 Example Ave', city: 'Anytown', state: 'TX', country: 'US' }

const attested = (atMs = 1_789_000_000_000): OutreachAttestations => ({
  us_business_address: { uid: 'u-avery', atMs },
  published_or_given: { uid: 'u-avery', atMs },
  verified_deliverable: { uid: 'u-avery', atMs },
})

const cleanLookups = (overrides: Partial<OutreachGateLookups> = {}): OutreachGateLookups => ({
  platformSuppressed: false,
  hostSuppressed: false,
  salesTopicState: 'subscribed',
  doNotContact: false,
  doNotContactDomain: false,
  workspaceMembers: [{ email: 'avery@example.org', verifiedAliases: ['avery@example.net'] }],
  openEnrollments: [],
  hasInboundEmail: false,
  ...overrides,
})

/** A cold contact the rep has done everything for. */
const input = (overrides: Partial<OutreachGateInput> = {}): OutreachGateInput => ({
  email: PROSPECT,
  contact: contact({ address: US_ADDRESS }),
  contactGroupId: GROUP,
  company: null,
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false },
  personalLine: 'Saw the new client portfolio page launch last week.',
  attestations: attested(),
  lookups: cleanLookups(),
  ...overrides,
})

const codesOf = (overrides: Partial<OutreachGateInput> = {}) =>
  evaluateOutreachGates(input(overrides)).blocks.map((block) => block.code)

describe('evaluateOutreachGates: a person who may be emailed', () => {
  it('allows a cold contact with every attestation, a personal line and a US address', () => {
    expect(evaluateOutreachGates(input())).toEqual({
      allowed: true,
      email: PROSPECT,
      cold: true,
      country: { country: 'US', source: 'contact' },
      blocks: [],
      missingAttestations: [],
    })
  })

  it('allows a warm contact without attestations or a personal line', () => {
    const result = evaluateOutreachGates(
      input({
        contact: contact({ sources: { form: true }, address: US_ADDRESS }),
        attestations: {},
        personalLine: '',
      }),
    )
    expect(result).toMatchObject({ allowed: true, cold: false, blocks: [] })
  })

  it('normalizes the address it is given', () => {
    expect(evaluateOutreachGates(input({ email: '  Casey@EXAMPLE.com ' })).email).toBe(PROSPECT)
  })
})

describe('gate 1: a valid address that is this contact’s and a person’s', () => {
  it('refuses a missing contact outright', () => {
    const result = evaluateOutreachGates(input({ contact: null }))
    expect(result.blocks).toEqual([
      { code: 'contact_missing', reason: 'This contact no longer exists in the CRM.' },
    ])
  })

  it('refuses an address that is not one, and stops there', () => {
    const result = evaluateOutreachGates(input({ email: 'casey at example' }))
    expect(result.blocks).toEqual([
      { code: 'invalid_email', reason: '"casey at example" isn\'t a valid email address.' },
    ])
    expect(result.email).toBeNull()
  })

  it('refuses an automated address nobody reads', () => {
    for (const email of ['noreply@example.com', 'no-reply@example.com', 'donotreply@example.com', 'postmaster@example.com']) {
      const result = evaluateOutreachGates(input({ email, contact: contact({ address: US_ADDRESS }, { email }) }))
      expect(result.blocks.map((block) => block.code)).toEqual(['invalid_email'])
    }
  })

  it("refuses an address that is not on the contact's record, and accepts an alternate one", () => {
    expect(codesOf({ email: 'someone-else@example.com' })).toEqual(['email_not_on_contact'])
    expect(
      codesOf({
        email: 'casey@mail.example.com',
        contact: contact({ address: US_ADDRESS }, { alternateEmails: ['casey@mail.example.com'] }),
      }),
    ).toEqual([])
  })
})

describe('gate 2: no personal mailbox for a cold contact', () => {
  const personal = 'casey@gmail.com'

  it('refuses a free-mail address for a cold contact, and says why', () => {
    const result = evaluateOutreachGates(
      input({ email: personal, contact: contact({ address: US_ADDRESS }, { email: personal }) }),
    )
    expect(result.blocks).toEqual([
      {
        code: 'free_mail',
        reason: 'casey@gmail.com is a personal mailbox. Cold outreach goes only to business addresses.',
      },
    ])
  })

  it('reads the same list the CRM does, subscriber mailboxes included', () => {
    for (const address of ['casey@yahoo.com', 'casey@outlook.com', 'casey@icloud.com', 'casey@proton.me', 'casey@comcast.net']) {
      expect(
        codesOf({ email: address, contact: contact({ address: US_ADDRESS }, { email: address }) }),
      ).toEqual(['free_mail'])
    }
  })

  it('lets a warm contact be emailed at a personal mailbox', () => {
    expect(
      codesOf({
        email: personal,
        contact: contact({ sources: { booking: true }, address: US_ADDRESS }, { email: personal }),
      }),
    ).toEqual([])
  })
})

describe('gate 3: the country', () => {
  it("refuses a country outside the sequence's list, naming it", () => {
    const result = evaluateOutreachGates(
      input({ contact: contact({ address: { city: 'Toronto', country: 'ca' } }) }),
    )
    expect(result.country).toEqual({ country: 'CA', source: 'contact' })
    expect(result.blocks).toEqual([
      {
        code: 'country_not_allowed',
        reason:
          "casey@example.com can't be emailed from this sequence: it's in Canada, which isn't one of its countries.",
      },
    ])
  })

  it("falls back to the company's address, then to a country-code domain", () => {
    expect(
      evaluateOutreachGates(input({ contact: contact(), company: { address: { country: 'GB' } } })).country,
    ).toEqual({ country: 'GB', source: 'company' })
    const byDomain = evaluateOutreachGates(
      input({ email: 'casey@example.co.uk', contact: contact({}, { email: 'casey@example.co.uk' }) }),
    )
    expect(byDomain.country).toEqual({ country: 'GB', source: 'domain' })
    expect(byDomain.blocks[0].reason).toBe(
      "casey@example.co.uk can't be emailed from this sequence: its domain places it in the United Kingdom, which isn't one of its countries.",
    )
  })

  it("trusts the contact's own address over what its domain suggests", () => {
    expect(
      codesOf({
        email: 'casey@example.ca',
        contact: contact({ address: US_ADDRESS }, { email: 'casey@example.ca' }),
      }),
    ).toEqual([])
  })

  it('keeps cold outreach to the US even when the sequence allows another country', () => {
    const settings = { window: null, allowedCountries: ['US', 'CA'], allowCustomers: false }
    const canadian = contact({ address: { country: 'CA' } })
    expect(evaluateOutreachGates(input({ settings, contact: canadian })).blocks).toEqual([
      {
        code: 'country_not_allowed',
        reason: "Cold outreach goes only to US business addresses, and it's in Canada.",
      },
    ])
    // A warm Canadian contact is the sequence's call to make.
    expect(
      codesOf({ settings, contact: contact({ sources: { form: true }, address: { country: 'CA' } }) }),
    ).toEqual([])
  })

  it('asks for the US attestation when nothing names a country', () => {
    const unknown = contact()
    expect(codesOf({ contact: unknown })).toEqual([])
    const result = evaluateOutreachGates(
      input({
        contact: contact({ sources: { form: true } }),
        attestations: {},
      }),
    )
    expect(result.blocks).toEqual([
      {
        code: 'country_unknown',
        reason:
          "We don't know which country casey@example.com is in. Confirm it's a US business address, or add the country to the contact.",
      },
    ])
  })

  it('cannot be attested past when the sequence does not send to the US', () => {
    const settings = { window: null, allowedCountries: ['CA'], allowCustomers: false }
    const result = evaluateOutreachGates(
      input({ settings, contact: contact({ sources: { form: true } }) }),
    )
    expect(result.blocks.map((block) => [block.code, block.reason])).toEqual([
      ['country_unknown', "We don't know which country casey@example.com is in. Add the country to the contact's address."],
    ])
  })

  it('reads a sequence with no stored countries as the United States alone', () => {
    expect(codesOf({ settings: {} })).toEqual([])
    expect(
      codesOf({ settings: undefined, contact: contact({ address: { country: 'DE' } }) }),
    ).toEqual(['country_not_allowed'])
  })
})

describe('gate 4: every list that says not to', () => {
  it('refuses each list by name', () => {
    const result = evaluateOutreachGates(
      input({
        lookups: cleanLookups({
          platformSuppressed: true,
          hostSuppressed: true,
          salesTopicState: 'opted-out',
          doNotContact: true,
          doNotContactDomain: true,
        }),
      }),
    )
    expect(result.blocks).toEqual([
      {
        code: 'platform_suppressed',
        reason:
          "casey@example.com is on the platform's suppression list after a hard bounce or a spam complaint.",
      },
      {
        code: 'host_suppressed',
        reason: "casey@example.com unsubscribed from this site's email, or mail to it bounced.",
      },
      { code: 'sales_opted_out', reason: 'casey@example.com opted out of sales outreach from this site.' },
      { code: 'do_not_contact', reason: "casey@example.com is on your organization's do-not-contact list." },
      {
        code: 'do_not_contact_domain',
        reason:
          "casey@example.com is at example.com, which is on your organization's do-not-contact list: no address there is emailed.",
      },
    ])
  })

  it('refuses a domain on the list on its own, whatever the address list says (AGL-3244)', () => {
    expect(codesOf({ lookups: cleanLookups({ doNotContactDomain: true }) })).toEqual(['do_not_contact_domain'])
  })

  it('refuses when a list could not be read, and says so rather than accusing the address', () => {
    const result = evaluateOutreachGates(
      input({
        lookups: cleanLookups({
          platformSuppressed: null,
          hostSuppressed: null,
          salesTopicState: null,
          doNotContact: null,
          doNotContactDomain: null,
          workspaceMembers: null,
          openEnrollments: null,
        }),
      }),
    )
    expect(result.allowed).toBe(false)
    expect(result.blocks.map((block) => block.code)).toEqual([
      'platform_suppressed',
      'host_suppressed',
      'sales_opted_out',
      'do_not_contact',
      'do_not_contact_domain',
      'workspace_member',
      'already_enrolled',
    ])
    for (const block of result.blocks) expect(block.reason).toMatch(/^We couldn't check/)
  })

  it('lets a pending sales-topic confirmation through: a sales email does not rest on a subscription', () => {
    expect(codesOf({ lookups: cleanLookups({ salesTopicState: 'pending' }) })).toEqual([])
  })
})

describe("gate 5: not one of the workspace's own people", () => {
  it('refuses a member by sign-in address or confirmed alias', () => {
    for (const address of ['avery@example.org', 'AVERY@example.net']) {
      const normalized = address.toLowerCase()
      expect(
        codesOf({ email: address, contact: contact({ address: US_ADDRESS }, { email: normalized }) }),
      ).toEqual(['workspace_member'])
    }
  })
})

describe('gate 6: not a customer, unless the sequence says so', () => {
  it('refuses a customer by stage, by the stage past it, or by an order on record', () => {
    expect(codesOf({ contact: contact({ address: US_ADDRESS, lifecycleStage: 'customer' }) })).toEqual(['customer'])
    expect(codesOf({ contact: contact({ address: US_ADDRESS, lifecycleStage: 'evangelist' }) })).toEqual([
      'customer',
    ])
    expect(codesOf({ contact: contact({ address: US_ADDRESS, ordersCount: 2 }) })).toEqual(['customer'])
    expect(
      codesOf({ contact: contact({ address: US_ADDRESS, sources: { order: true } }), attestations: {}, personalLine: '' }),
    ).toEqual(['customer'])
  })

  it('lets a customer into a sequence written for customers', () => {
    expect(
      codesOf({
        contact: contact({ address: US_ADDRESS, lifecycleStage: 'customer' }),
        settings: { window: null, allowedCountries: ['US'], allowCustomers: true },
      }),
    ).toEqual([])
  })

  it("reads only the sending group's facet", () => {
    const elsewhere = {
      email: PROSPECT,
      facets: {
        [GROUP]: { sources: { import: true }, interactions: [], address: US_ADDRESS },
        'group-other-client': { sources: { order: true }, lifecycleStage: 'customer', ordersCount: 4 },
      },
    }
    expect(isOutreachCustomer(elsewhere, GROUP)).toBe(false)
    expect(isOutreachCustomer(elsewhere, 'group-other-client')).toBe(true)
  })
})

describe('gate 7: one sequence at a time', () => {
  const open = (status: 'active' | 'paused' | 'finished' | 'replied', id = 'enrollment-9') => ({
    id,
    sequenceId: 'sequence-9',
    status,
  })

  it('refuses a person active or paused in another sequence', () => {
    expect(codesOf({ lookups: cleanLookups({ openEnrollments: [open('active')] }) })).toEqual(['already_enrolled'])
    expect(codesOf({ lookups: cleanLookups({ openEnrollments: [open('paused')] }) })).toEqual(['already_enrolled'])
  })

  it('ignores enrollments that ended, and the enrollment being re-checked before a send', () => {
    expect(
      codesOf({ lookups: cleanLookups({ openEnrollments: [open('finished'), open('replied')] }) }),
    ).toEqual([])
    expect(
      codesOf({
        enrollmentId: 'enrollment-1',
        lookups: cleanLookups({ openEnrollments: [open('active', 'enrollment-1')] }),
      }),
    ).toEqual([])
  })
})

describe('gate 8: what only the rep can vouch for, on a cold contact', () => {
  it('lists every missing attestation, in the order they are asked', () => {
    const result = evaluateOutreachGates(input({ attestations: {} }))
    expect(result.missingAttestations).toEqual([
      'us_business_address',
      'published_or_given',
      'verified_deliverable',
    ])
    expect(result.blocks).toEqual([
      {
        code: 'attestations_missing',
        reason:
          "Before emailing a cold contact, confirm that it's a US business address; that they or their company published it, or they gave it to you; and that it was verified as deliverable.",
      },
    ])
  })

  it('does not count an attestation without who made it and when', () => {
    const partial: OutreachAttestations = {
      ...attested(),
      published_or_given: { uid: '', atMs: 1_789_000_000_000 },
      verified_deliverable: { uid: 'u-avery', atMs: 0 },
    }
    const result = evaluateOutreachGates(input({ attestations: partial }))
    expect(result.missingAttestations).toEqual(['published_or_given', 'verified_deliverable'])
    expect(result.blocks[0].reason).toBe(
      'Before emailing a cold contact, confirm that they or their company published it, or they gave it to you; and that it was verified as deliverable.',
    )
    expect(outreachAttestationHolds(partial, 'us_business_address')).toBe(true)
    expect(outreachAttestationHolds(null, 'us_business_address')).toBe(false)
  })

  it('needs a personal line on a cold contact, and holds every line to one sentence', () => {
    expect(codesOf({ personalLine: '   ' })).toEqual(['personal_line_missing'])
    expect(codesOf({ personalLine: 'x'.repeat(301) })).toEqual(['personal_line_too_long'])
    expect(
      codesOf({ contact: contact({ sources: { form: true }, address: US_ADDRESS }), personalLine: 'x'.repeat(301) }),
    ).toEqual(['personal_line_too_long'])
    expect(normalizeOutreachPersonalLine('  Saw the\n launch.  ')).toBe('Saw the launch.')
  })
})

describe('cold', () => {
  it('is no inbound door on this facet and no email the person wrote', () => {
    for (const source of ['api', 'import', 'manual']) {
      expect(isColdOutreachContact(contact({ sources: { [source]: true } }), GROUP, false)).toBe(true)
    }
    for (const source of ['form', 'member', 'newsletter', 'order', 'booking']) {
      expect(isColdOutreachContact(contact({ sources: { [source]: true } }), GROUP, false)).toBe(false)
    }
    expect(isColdOutreachContact(contact(), GROUP, true)).toBe(false)
  })

  it("does not borrow another client's capture", () => {
    const shared = {
      email: PROSPECT,
      sources: { form: true },
      facets: { 'group-other-client': { sources: { form: true } } },
    }
    expect(isColdOutreachContact(shared, GROUP, false)).toBe(true)
  })
})

describe('every block at once', () => {
  it('reports each gate that refuses, in gate order', () => {
    const personal = 'avery@gmail.com'
    const result = evaluateOutreachGates(
      input({
        email: personal,
        contact: contact({ lifecycleStage: 'customer', address: { country: 'CA' } }, { email: personal }),
        attestations: {},
        personalLine: '',
        lookups: cleanLookups({
          doNotContact: true,
          workspaceMembers: [{ email: personal }],
          openEnrollments: [{ id: 'e-2', sequenceId: 's-2', status: 'active' }],
        }),
      }),
    )
    expect(result.blocks.map((block) => block.code)).toEqual([
      'free_mail',
      'country_not_allowed',
      'do_not_contact',
      'workspace_member',
      'customer',
      'already_enrolled',
      'attestations_missing',
      'personal_line_missing',
    ])
  })
})

describe('recipient country', () => {
  it('reads country-code domains, and not the ones sold as generic names', () => {
    expect(countryFromEmailDomain('casey@example.ca')).toBe('CA')
    expect(countryFromEmailDomain('casey@example.co.uk')).toBe('GB')
    expect(countryFromEmailDomain('casey@example.de')).toBe('DE')
    expect(countryFromEmailDomain('casey@example.com.au')).toBe('AU')
    expect(countryFromEmailDomain('CASEY@EXAMPLE.NL.')).toBe('NL')
    for (const generic of ['example.com', 'example.io', 'example.co', 'example.ai', 'example.me', 'example.tv']) {
      expect(countryFromEmailDomain(`casey@${generic}`)).toBeNull()
    }
    expect(countryFromEmailDomain('casey@localhost')).toBeNull()
  })

  it('prefers the contact, then the company, then the domain', () => {
    expect(
      resolveOutreachRecipientCountry({
        email: 'casey@example.de',
        contactAddress: { country: 'us' },
        companyAddress: { country: 'FR' },
      }),
    ).toEqual({ country: 'US', source: 'contact' })
    expect(
      resolveOutreachRecipientCountry({ email: 'casey@example.de', contactAddress: { country: 'Canada' } }),
    ).toEqual({ country: 'DE', source: 'domain' })
    expect(resolveOutreachRecipientCountry({ email: 'casey@example.com' })).toEqual({
      country: null,
      source: null,
    })
  })

  it('names a country the way a sentence says it', () => {
    expect(outreachCountryName('US')).toBe('the United States')
    expect(outreachCountryName('gb')).toBe('the United Kingdom')
    expect(outreachCountryName('CA')).toBe('Canada')
    expect(outreachCountryName('DE')).toBe('Germany')
  })
})
