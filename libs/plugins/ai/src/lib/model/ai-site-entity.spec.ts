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

import { LOCAL_BUSINESS_TYPES } from '@aglyn/aglyn/app-utils/local-business'
import { siteEntityJsonLd } from '@aglyn/aglyn/app-utils/site-entity-json-ld'
import { AI_SITE_KINDS } from './ai-site-kinds'
import { AI_SITE_KIND_SCHEMA, aiSiteEntityUpdates, aiSiteEntityValues, aiSiteSchemaOf } from './ai-site-entity'

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

/** A host's `seo` with dotted updates applied, as Firestore would. */
function applied(seo: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(seo)) as Record<string, unknown>
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('.').slice(1)
    let at = next
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {}) as Record<string, unknown>
    at[parts[parts.length - 1]] = value
  }
  return next
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

  it('nothing a second time', () => {
    const first = aiSiteEntityUpdates({}, aiSiteEntityValues(PLUMBER))
    expect(aiSiteEntityUpdates(applied({}, first), aiSiteEntityValues(PLUMBER))).toEqual({})
  })

  it('a start with no details writes its name, description, type and guidance, and no empty field', () => {
    const updates = aiSiteEntityUpdates({}, aiSiteEntityValues({ businessType: 'a cycling blog', siteKind: 'blog', businessName: 'Slow Roads' }))
    expect(Object.keys(updates).sort()).toEqual(['seo.agent.whenToUse', 'seo.entity.description', 'seo.entity.name'])
  })

  it('makes every page’s JSON-LD the kind’s type, with telephone, email, address, hours, areas and profiles', () => {
    const seo = applied({ title: 'Pipeworks', description: 'Welcome' }, aiSiteEntityUpdates({}, aiSiteEntityValues(PLUMBER)))
    const node = siteEntityJsonLd({ displayName: 'Pipeworks', seo } as never, { origin: 'https://pipeworks.aglyn.app' })
    expect(node).toMatchObject({
      '@type': 'Plumber',
      name: 'Pipeworks',
      telephone: '(512) 555-0142',
      contactPoint: { '@type': 'ContactPoint', email: 'hello@pipeworks.co', telephone: '(512) 555-0142' },
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
