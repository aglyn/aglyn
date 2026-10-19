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
 * Who publishes an AI-built site (AGL-3979): the schema type its kind
 * publishes as, the Entity and AI-agent values its answers give, and the
 * host fields a publish fills — only where empty — read back through the
 * tenant's own JSON-LD serializer.
 */

import { defaultSiteSeo } from '@aglyn/aglyn/app-utils/default-site'
import { LOCAL_BUSINESS_TYPES } from '@aglyn/aglyn/app-utils/local-business'
import { siteEntityJsonLd } from '@aglyn/aglyn/app-utils/site-entity-json-ld'
import { AI_SITE_KINDS } from './ai-site-kinds'
import {
  AI_SITE_CONTACT_TYPE,
  AI_SITE_KIND_SCHEMA,
  aiSiteEntityUpdates,
  aiSiteEntityValues,
  aiSiteListingSeeded,
  aiSiteListingUpdates,
  aiSiteSchemaOf,
} from './ai-site-entity'
import { aiSiteSeoProposalForInputs } from './ai-site-start-seo'

const PLUMBER = {
  businessType: 'a family plumbing company',
  audience: 'homeowners in Austin',
  siteKind: 'trades',
  businessName: 'Pipeworks',
  city: 'Austin',
  phone: '(512) 555-0142',
  email: 'hello@pipeworks.co',
  street: '214 Main Street',
  region: 'TX',
  postalCode: '78701',
  country: 'US',
  hours: 'Mo-Fr 08:00-18:00\nSa 09:00-13:00',
  serviceArea: 'Austin\nRound Rock',
  priceRange: '$$',
  social: 'https://instagram.com/pipeworks\nhttps://www.facebook.com/pipeworks',
  languages: 'English, Spanish',
}

/** A host with dotted updates applied, as Firestore would. */
function appliedHost(host: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(host)) as Record<string, unknown>
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('.')
    let at = next
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {}) as Record<string, unknown>
    at[parts[parts.length - 1]] = value
  }
  return next
}

/** A host's `seo` with the updates to it applied. */
function applied(seo: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  return (appliedHost({ seo }, updates)['seo'] ?? {}) as Record<string, unknown>
}

describe('the schema type a kind of site publishes as', () => {
  it('has an entry for every kind, naming only types that publish', () => {
    const types = new Set<string>(LOCAL_BUSINESS_TYPES.map((entry) => entry.value))
    for (const kind of AI_SITE_KINDS) {
      const entry = AI_SITE_KIND_SCHEMA[kind.id]
      expect(entry).toBeDefined()
      if (entry.businessType) expect(types.has(entry.businessType)).toBe(true)
      for (const [, type] of entry.refine ?? []) expect(types.has(type)).toBe(true)
    }
  })

  it('reads the narrower type the words name', () => {
    expect(aiSiteSchemaOf({ siteKind: 'trades', businessType: 'a family plumbing company' }).businessType).toBe('Plumber')
    expect(aiSiteSchemaOf({ siteKind: 'trades', businessType: 'a landscaping crew' }).businessType).toBe('HomeAndConstructionBusiness')
    expect(aiSiteSchemaOf({ siteKind: 'professional', businessType: 'an estate law firm' }).businessType).toBe('LegalService')
    expect(aiSiteSchemaOf({ siteKind: 'restaurant', businessType: 'a corner bakery' }).businessType).toBe('FoodEstablishment')
    expect(aiSiteSchemaOf({ siteKind: 'business', businessType: 'freelance marketing for small businesses' }).businessType).toBe('ProfessionalService')
    expect(aiSiteSchemaOf({ siteKind: 'photography', businessType: 'wedding photographer' }).businessType).toBe('ProfessionalService')
  })

  it('a personal site is a Person; a blog is an Organization unless it gave a place', () => {
    expect(aiSiteSchemaOf({ siteKind: 'personal', businessType: 'my resume' })).toEqual({ person: true, businessType: null })
    expect(aiSiteSchemaOf({ siteKind: 'blog', businessType: 'a cycling blog' })).toEqual({ person: false, businessType: null })
    expect(aiSiteSchemaOf({ siteKind: 'nonprofit', businessType: 'a food pantry', hours: 'Sa 09:00-12:00' }).businessType).toBe('LocalBusiness')
  })

  it('a kind left to pick is the one the words suggest', () => {
    expect(aiSiteSchemaOf({ businessType: 'a yoga studio' }).businessType).toBe('SportsActivityLocation')
  })
})

describe('the Entity and AI-agent values a start gives', () => {
  it('fills contact, address, type, areas, hours, price, profiles and guidance from the answers', () => {
    const values = aiSiteEntityValues(PLUMBER)
    expect(values).toMatchObject({
      person: false,
      name: 'Pipeworks',
      email: 'hello@pipeworks.co',
      telephone: '(512) 555-0142',
      address: { streetAddress: '214 Main Street', addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701', addressCountry: 'US' },
      businessType: 'Plumber',
      areaServed: ['Austin', 'Round Rock'],
      openingHours: 'Mo-Fr 08:00-18:00\nSa 09:00-13:00',
      priceRange: '$$',
      sameAs: ['https://instagram.com/pipeworks', 'https://www.facebook.com/pipeworks'],
    })
    expect(values.description).toMatch(/^Pipeworks is a family plumbing company/)
    expect(values.whenToUse).toContain('Use this site for what Pipeworks offers, the areas it serves (Austin, Round Rock), its opening hours, its prices and how to get in touch.')
    expect(values.whenToUse).toContain('It serves customers in English, Spanish.')
    expect(values.howToUse).toBe('To reach a person at Pipeworks, call (512) 555-0142 or email hello@pipeworks.co. Pipeworks is at 214 Main Street, Austin, TX 78701, US.')
  })

  it('a business that names no other area serves its city, and gives no guidance on how to reach it without contact', () => {
    const values = aiSiteEntityValues({ businessType: 'a dog groomer', siteKind: 'business', city: 'Hillside' })
    expect(values.areaServed).toEqual(['Hillside'])
    expect(values.address.addressLocality).toBe('')
    expect(values.howToUse).toBe('')
  })
})

describe('what a publish writes on the host', () => {
  it('only fields that are empty: the owner’s own words are kept, an address only whole', () => {
    const seo = {
      title: 'Pipeworks',
      entity: { telephone: '(512) 555-9999', address: { addressLocality: 'Round Rock' }, sameAs: [] },
      agent: { whenToUse: 'Our own words.' },
    }
    const updates = aiSiteEntityUpdates(seo, aiSiteEntityValues(PLUMBER))
    expect(updates).not.toHaveProperty('seo.entity.telephone')
    expect(Object.keys(updates).some((path) => path.startsWith('seo.entity.address.'))).toBe(false)
    expect(updates).not.toHaveProperty('seo.agent.whenToUse')
    expect(updates).toMatchObject({
      'seo.entity.name': 'Pipeworks',
      'seo.entity.email': 'hello@pipeworks.co',
      'seo.entity.businessType': 'Plumber',
      'seo.entity.sameAs': ['https://instagram.com/pipeworks', 'https://www.facebook.com/pipeworks'],
      'seo.agent.howToUse': expect.stringContaining('call (512) 555-0142'),
    })
  })

  it('says what the contact answers, names the site’s logo, and fills the Business details card', () => {
    const updates = aiSiteEntityUpdates({}, aiSiteEntityValues(PLUMBER), { logoUrl: 'media:host-1/logo', business: {} })
    expect(updates).toMatchObject({
      'seo.entity.contactType': AI_SITE_CONTACT_TYPE,
      'seo.entity.logo': 'media:host-1/logo',
      'business.supportEmail': 'hello@pipeworks.co',
      'business.address': '214 Main Street, Austin, TX 78701, US',
    })
    // The owner's own words are kept, and a contact the start did not write is not labeled.
    const kept = aiSiteEntityUpdates(
      { entity: { logo: 'https://cdn.example.com/own.png', email: 'own@pipeworks.co', telephone: '(512) 555-9999' } },
      aiSiteEntityValues(PLUMBER),
      { logoUrl: 'media:host-1/logo', business: { supportEmail: 'own@pipeworks.co', address: 'PO Box 9' } },
    )
    expect(kept).not.toHaveProperty('seo.entity.logo')
    expect(kept).not.toHaveProperty('seo.entity.contactType')
    expect(kept).not.toHaveProperty('business.supportEmail')
    expect(kept).not.toHaveProperty('business.address')
  })

  it('a site with no logo names none, and a Person’s picture is never the site logo', () => {
    expect(aiSiteEntityUpdates({}, aiSiteEntityValues(PLUMBER))).not.toHaveProperty('seo.entity.logo')
    const person = aiSiteEntityUpdates({}, aiSiteEntityValues({ businessType: 'my resume', siteKind: 'personal', businessName: 'Ana Ruiz' }), {
      logoUrl: 'media:host-1/logo',
    })
    expect(person).not.toHaveProperty('seo.entity.logo')
  })

  it('nothing a second time', () => {
    const site = { logoUrl: 'media:host-1/logo' }
    const first = aiSiteEntityUpdates({}, aiSiteEntityValues(PLUMBER), site)
    const host = appliedHost({}, first) as { seo?: unknown; business?: unknown }
    expect(aiSiteEntityUpdates(host.seo, aiSiteEntityValues(PLUMBER), { ...site, business: host.business })).toEqual({})
  })

  it('a start with no details writes its name, description, type and guidance, and no empty field', () => {
    const updates = aiSiteEntityUpdates({}, aiSiteEntityValues({ businessType: 'a cycling blog', siteKind: 'blog', businessName: 'Slow Roads' }))
    expect(Object.keys(updates).sort()).toEqual(['seo.agent.whenToUse', 'seo.entity.description', 'seo.entity.name'])
  })

  it('makes every page’s JSON-LD the kind’s type, with telephone, email, address, hours, areas and profiles', () => {
    const seo = applied({ title: 'Pipeworks', description: 'Welcome' }, aiSiteEntityUpdates({}, aiSiteEntityValues(PLUMBER), { logoUrl: 'https://cdn.example.com/pipeworks.png' }))
    const node = siteEntityJsonLd({ displayName: 'Pipeworks', seo } as never, { origin: 'https://pipeworks.aglyn.app' })
    expect(node).toMatchObject({
      '@type': 'Plumber',
      name: 'Pipeworks',
      telephone: '(512) 555-0142',
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'hello@pipeworks.co', telephone: '(512) 555-0142' },
      logo: 'https://cdn.example.com/pipeworks.png',
      address: { '@type': 'PostalAddress', streetAddress: '214 Main Street', addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701' },
      areaServed: [
        { '@type': 'City', name: 'Austin' },
        { '@type': 'City', name: 'Round Rock' },
      ],
      openingHoursSpecification: [
        expect.objectContaining({ dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:00', closes: '18:00' }),
        expect.objectContaining({ dayOfWeek: ['Saturday'], opens: '09:00', closes: '13:00' }),
      ],
      priceRange: '$$',
      sameAs: expect.arrayContaining(['https://instagram.com/pipeworks', 'https://www.facebook.com/pipeworks']),
    })
  })

  it('a personal site publishes as a Person with none of a business’s fields', () => {
    const inputs = { businessType: 'my resume', siteKind: 'personal', businessName: 'Ana Ruiz', email: 'ana@ruiz.dev', hours: 'Mo 09:00-10:00' }
    const updates = aiSiteEntityUpdates({}, aiSiteEntityValues(inputs))
    expect(updates['seo.entity.type']).toBe('2')
    expect(updates).not.toHaveProperty('seo.entity.openingHours')
    const node = siteEntityJsonLd({ displayName: 'Ana Ruiz', seo: applied({}, updates) } as never, { origin: 'https://ana.aglyn.app' })
    expect(node?.['@type']).toBe('Person')
    expect(node).toMatchObject({ contactPoint: { email: 'ana@ruiz.dev' } })
  })
})

/*
 * The site's own listing (AGL-3979): the start's title and description go
 * over the ones the site was created with, and over nothing an owner wrote.
 */
describe('the site’s own listing at publish', () => {
  const NAME = 'Hillside Dog Grooming'
  const GROOMER = { businessType: 'a neighborhood dog groomer', audience: 'busy dog owners', city: 'Austin' }
  const listing = aiSiteSeoProposalForInputs(GROOMER, null, NAME)

  it('leads with the site’s name where the start named no business', () => {
    expect(listing?.values['seo.title']).toBe('Hillside Dog Grooming — Neighborhood dog groomer in Austin')
    expect(listing?.values['seo.description']).toMatch(/^Hillside Dog Grooming is a neighborhood dog groomer/)
    // A business the start names is its own name, whatever the site is called.
    expect(aiSiteSeoProposalForInputs({ ...GROOMER, businessName: 'Pawsome' }, null, NAME)?.values['seo.title']).toMatch(/^Pawsome — /)
  })

  it('writes both halves over the default the site was created with', () => {
    const seeded = defaultSiteSeo(NAME)
    expect(aiSiteListingSeeded(seeded, NAME)).toEqual({ title: true, description: true })
    expect(aiSiteListingUpdates(seeded, NAME, listing)).toEqual({
      'seo.title': listing?.values['seo.title'],
      'seo.description': listing?.values['seo.description'],
    })
    // Renamed after it was made, the seeded pair is still the seeded pair; blank was never chosen either.
    expect(aiSiteListingSeeded(defaultSiteSeo('Old Name'), NAME)).toEqual({ title: true, description: true })
    expect(aiSiteListingSeeded({}, NAME)).toEqual({ title: true, description: true })
    expect(aiSiteListingSeeded(defaultSiteSeo(''), '')).toEqual({ title: true, description: true })
  })

  it('never writes over a title or description the owner changed', () => {
    const seeded = defaultSiteSeo(NAME)
    const ownTitle = { ...seeded, title: 'Hillside Grooming | Austin dog spa' }
    expect(aiSiteListingUpdates(ownTitle, NAME, listing)).toEqual({ 'seo.description': listing?.values['seo.description'] })
    const ownDescription = { ...seeded, description: 'Gentle grooming for nervous dogs since 2009.' }
    expect(aiSiteListingUpdates(ownDescription, NAME, listing)).toEqual({ 'seo.title': listing?.values['seo.title'] })
    expect(aiSiteListingUpdates({ title: 'Our own title', description: 'Our own words.' }, NAME, listing)).toEqual({})
    expect(aiSiteListingUpdates(seeded, NAME, null)).toEqual({})
  })

  it('writes nothing a second time', () => {
    const seo = applied(defaultSiteSeo(NAME), aiSiteListingUpdates(defaultSiteSeo(NAME), NAME, listing))
    expect(aiSiteListingSeeded(seo, NAME)).toEqual({ title: false, description: false })
    expect(aiSiteListingUpdates(seo, NAME, listing)).toEqual({})
  })
})
