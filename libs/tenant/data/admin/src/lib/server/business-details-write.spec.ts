/**
 * @jest-environment node
 *
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
  BUSINESS_NAME_MAX_LENGTH,
  BUSINESS_PHONE_MAX_LENGTH,
  BUSINESS_SOCIAL_LINKS_MAX,
  SITE_SLOGAN_MAX_LENGTH,
} from '@aglyn/aglyn/app-utils/business-details'
import { settingsFirestoreDouble } from '../testing/settings-firestore-double'
import {
  BUSINESS_API_BOUNDS,
  businessDetailsChanges,
  businessDetailsView,
  readBusinessDetailsPatch,
  writeBusinessDetails,
} from './business-details-write'

const NOW = new Date('2026-11-19T12:00:00Z')

describe('readBusinessDetailsPatch (AGL-4235)', () => {
  it('holds each member to the card’s own limit, at the boundary', () => {
    const cases: Array<[string, number]> = [
      ['name', BUSINESS_NAME_MAX_LENGTH],
      ['slogan', SITE_SLOGAN_MAX_LENGTH],
      ['phone', BUSINESS_PHONE_MAX_LENGTH],
    ]
    for (const [member, limit] of cases) {
      expect(readBusinessDetailsPatch({ [member]: 'a'.repeat(limit) })).toEqual({ patch: { [member]: 'a'.repeat(limit) } })
      expect(readBusinessDetailsPatch({ [member]: 'a'.repeat(limit + 1) })).toEqual({
        errors: { [member]: `Must be ${limit} characters or fewer` },
      })
    }
  })

  it('takes the card’s email rule, and names an unknown member anywhere in the body', () => {
    expect(readBusinessDetailsPatch({ email: ' hello@example.com ' })).toEqual({ patch: { email: 'hello@example.com' } })
    expect(readBusinessDetailsPatch({ email: 'not an email' })).toEqual({
      errors: { email: 'Must be an email address, like you@example.com' },
    })
    expect(
      readBusinessDetailsPatch({ fax: '1', address: { zip: '1' }, socialLinks: [{ url: 'https://example.com', icon: 'x' }] }),
    ).toEqual({
      errors: {
        fax: 'Not writable on business details',
        'address.zip': 'Not a part of the address',
        'socialLinks[0].icon': 'Not a member of a social link',
      },
    })
  })

  it('reads null and an empty string as emptying a member', () => {
    expect(readBusinessDetailsPatch({ phone: null, slogan: '', address: null, socialLinks: null })).toEqual({
      patch: { phone: '', slogan: '', address: null, socialLinks: [] },
    })
  })

  it('holds the links to the editor’s maximum and to an address each', () => {
    const link = { label: 'Site', url: 'https://example.com' }
    expect('patch' in readBusinessDetailsPatch({ socialLinks: Array(BUSINESS_SOCIAL_LINKS_MAX).fill(link) })).toBe(true)
    expect(readBusinessDetailsPatch({ socialLinks: Array(BUSINESS_SOCIAL_LINKS_MAX + 1).fill(link) })).toEqual({
      errors: { socialLinks: `Must hold ${BUSINESS_SOCIAL_LINKS_MAX} links or fewer` },
    })
    expect(readBusinessDetailsPatch({ socialLinks: [{ label: 'x' }] })).toEqual({ errors: { 'socialLinks[0].url': 'Required' } })
    expect(readBusinessDetailsPatch({ address: { city: 'a'.repeat(BUSINESS_API_BOUNDS.addressPart + 1) } })).toEqual({
      errors: { 'address.city': `Must be ${BUSINESS_API_BOUNDS.addressPart} characters or fewer` },
    })
  })
})

describe('businessDetailsChanges: the card’s save (AGL-4136 rules, AGL-4235)', () => {
  it('mirrors the email into business.supportEmail as the card does', () => {
    expect(businessDetailsChanges({}, { email: 'hello@example.com' })).toEqual([
      { path: 'seo.entity.email', value: 'hello@example.com' },
      { path: 'business.supportEmail', value: 'hello@example.com' },
    ])
  })

  it('deletes the email and its copy when it is emptied, never storing them blank', () => {
    const stored = { seo: { entity: { email: 'old@example.com' } }, business: { supportEmail: 'old@example.com' } }
    expect(businessDetailsChanges(stored, { email: '' })).toEqual([
      { path: 'seo.entity.email', remove: true },
      { path: 'business.supportEmail', remove: true },
    ])
  })

  it('mirrors the address, formatted, into business.address only when the address changed', () => {
    const stored = { business: { address: '9 Old Rd\nAustin' } }
    // A save that never touched the address keeps the one-block copy.
    expect(businessDetailsChanges(stored, { phone: '+1 512-555-0100' })).toEqual([
      { path: 'seo.entity.telephone', value: '+1 512-555-0100' },
    ])
    const changes = businessDetailsChanges(stored, { address: { street: '12 Bean St', city: 'Portland' } })
    expect(changes).toEqual([
      { path: 'seo.entity.address.streetAddress', value: '12 Bean St' },
      { path: 'seo.entity.address.addressLocality', value: 'Portland' },
      { path: 'business.address', value: expect.stringContaining('12 Bean St') },
    ])
  })

  it('clears every part and the copy when the address is emptied', () => {
    const stored = {
      seo: { entity: { address: { streetAddress: '12 Bean St', addressLocality: 'Portland' } } },
      business: { address: '12 Bean St, Portland' },
    }
    expect(businessDetailsChanges(stored, { address: null })).toEqual([
      { path: 'seo.entity.address.streetAddress', remove: true },
      { path: 'seo.entity.address.addressLocality', remove: true },
      { path: 'business.address', remove: true },
    ])
  })

  it('keeps an address part the request leaves out', () => {
    const stored = { seo: { entity: { address: { streetAddress: '12 Bean St', addressLocality: 'Portland' } } } }
    expect(businessDetailsChanges(stored, { address: { city: 'Salem' } })).toEqual([
      { path: 'seo.entity.address.addressLocality', value: 'Salem' },
      { path: 'business.address', value: expect.stringContaining('Salem') },
    ])
  })

  it('replaces the social links with the cleaned list', () => {
    expect(businessDetailsChanges({}, { socialLinks: [{ label: ' Instagram ', url: ' https://instagram.com/bakery ' }] })).toEqual([
      { path: 'business.socialLinks', value: [{ label: 'Instagram', url: 'https://instagram.com/bakery' }] },
    ])
  })

  it('changes nothing when the request repeats what is stored', () => {
    const stored = { seo: { entity: { name: 'Bakery', email: 'hello@example.com' } }, business: { supportEmail: 'hello@example.com' } }
    expect(businessDetailsChanges(stored, { name: 'Bakery', email: 'hello@example.com' })).toEqual([])
  })
})

describe('businessDetailsView (AGL-4235)', () => {
  it('shows what the card shows: the site’s one email, from the copy when only it holds one', () => {
    expect(businessDetailsView('host-1', { business: { supportEmail: 'hello@example.com', socialLinks: [{ label: 'X', url: 'https://x.com/b' }, { label: 'none' }] } })).toEqual({
      object: 'business_details',
      site: 'host-1',
      name: null,
      slogan: null,
      phone: null,
      email: 'hello@example.com',
      address: { street: null, city: null, region: null, postalCode: null, country: null },
      socialLinks: [{ label: 'X', url: 'https://x.com/b' }],
    })
  })
})

describe('writeBusinessDetails (AGL-4235)', () => {
  it('writes through the site-settings writer, with the outbox entry', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': { displayName: 'Bakery' } })
    const written = await writeBusinessDetails(double.firestore, { hostId: 'host-1', patch: { email: 'hello@example.com' }, now: NOW })
    expect(written).toEqual(expect.objectContaining({ ok: true, changed: ['seo.entity.email', 'business.supportEmail'] }))
    expect(double.read('hosts/host-1')).toEqual({
      displayName: 'Bakery',
      seo: { entity: { email: 'hello@example.com' } },
      business: { supportEmail: 'hello@example.com' },
      updatedAt: NOW,
    })
    expect(double.outbox()).toHaveLength(1)
  })
})
