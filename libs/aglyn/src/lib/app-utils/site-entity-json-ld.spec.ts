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

import { HostEntityType } from '../foundation/definitions/platform.types'
import { SITE_ENTITY_FRAGMENT } from './content-authors'
import {
  hostSeoEntityJsonLd,
  siteEntityJsonLd,
  siteEntitySchemaType,
} from './site-entity-json-ld'

const ORIGIN = 'https://acme.test'

describe('siteEntityJsonLd', () => {
  it('publishes a complete, top-level Organization', () => {
    expect(
      siteEntityJsonLd(
        {
          displayName: 'Acme',
          seo: {
            entity: {
              type: HostEntityType.ORGANIZATION,
              name: 'Acme Widgets LLC',
              description: 'Industrial fasteners, made in Texas.',
              logo: 'https://acme.test/logo.png',
              sameAs: ['https://www.linkedin.com/company/acme'],
              email: 'hello@acme.test',
              telephone: '+1-512-555-0100',
              contactType: 'sales',
              address: {
                streetAddress: '1 Widget Way',
                addressLocality: 'Austin',
                addressRegion: 'TX',
                postalCode: '78701',
                addressCountry: 'US',
              },
            },
          },
        },
        { origin: ORIGIN },
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${ORIGIN}/${SITE_ENTITY_FRAGMENT}`,
      name: 'Acme Widgets LLC',
      description: 'Industrial fasteners, made in Texas.',
      url: ORIGIN,
      logo: 'https://acme.test/logo.png',
      sameAs: ['https://www.linkedin.com/company/acme'],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: 'hello@acme.test',
        telephone: '+1-512-555-0100',
      },
      address: {
        '@type': 'PostalAddress',
        streetAddress: '1 Widget Way',
        addressLocality: 'Austin',
        addressRegion: 'TX',
        postalCode: '78701',
        addressCountry: 'US',
      },
    })
  })

  it('falls back to the site identity when the Entity form is empty', () => {
    /*
      The property that makes this worth having: a site whose author never
      found the Entity form still publishes a named, described entity, which is
      every site on the platform rather than the few that were configured.
    */
    const node = siteEntityJsonLd(
      {
        displayName: 'Acme',
        seo: { title: 'Acme — widgets', description: 'We make widgets.' },
      },
      { origin: ORIGIN },
    )
    expect(node).toMatchObject({
      '@type': 'Organization',
      name: 'Acme',
      description: 'We make widgets.',
      url: ORIGIN,
    })
  })

  it('prefers the SEO title over nothing when there is no display name', () => {
    expect(siteEntityJsonLd({ seo: { title: 'Acme' } })).toMatchObject({
      name: 'Acme',
    })
  })

  it('is undefined only when no name can be had from anywhere', () => {
    expect(siteEntityJsonLd({})).toBeUndefined()
    expect(siteEntityJsonLd(null)).toBeUndefined()
    expect(siteEntityJsonLd({ seo: { description: 'Orphan copy' } })).toBeUndefined()
  })

  it('does NOT change what `publisher` publishes', () => {
    // The fallback decides what the standalone node says and nothing else, so
    // the nested publisher keeps its own gate — no site's existing structured
    // data moves under this.
    expect(hostSeoEntityJsonLd({ name: '' })).toBeUndefined()
    expect(hostSeoEntityJsonLd({ name: 'Acme Widgets LLC' })).toEqual({
      '@type': 'Organization',
      name: 'Acme Widgets LLC',
    })
  })

  it('shares one @id with the nested publisher, so the two merge', () => {
    const node = siteEntityJsonLd({ displayName: 'Acme' }, { origin: ORIGIN })
    expect(node?.['@id']).toBe('https://acme.test/#organization')
  })

  it('omits the @id when no origin is known', () => {
    // An `@id` is a URL. A relative one names a different entity per document.
    expect(siteEntityJsonLd({ displayName: 'Acme' })).not.toHaveProperty('@id')
  })

  it('emits image, not logo, for a Person', () => {
    expect(
      siteEntityJsonLd(
        {
          seo: {
            entity: {
              type: HostEntityType.PERSON,
              name: 'Ada Lovelace',
              logo: 'https://acme.test/ada.jpg',
            },
          },
        },
        { origin: ORIGIN },
      ),
    ).toMatchObject({ '@type': 'Person', image: 'https://acme.test/ada.jpg' })
  })

  it('omits a contactPoint that has no channel to contact', () => {
    // A contactType alone is a label on nothing.
    expect(
      siteEntityJsonLd({ displayName: 'Acme', seo: { entity: { contactType: 'sales' } } }),
    ).not.toHaveProperty('contactPoint')
  })

  it('defaults the contact type when only a channel was given', () => {
    expect(
      siteEntityJsonLd({ displayName: 'Acme', seo: { entity: { email: 'a@b.test' } } }),
    ).toMatchObject({
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'a@b.test',
      },
    })
  })

  it('emits a partial address rather than empty strings', () => {
    expect(
      siteEntityJsonLd({
        displayName: 'Acme',
        seo: { entity: { address: { addressLocality: 'Austin', postalCode: '' } } },
      }),
    ).toMatchObject({
      address: { '@type': 'PostalAddress', addressLocality: 'Austin' },
    })
  })

  it('omits the address entirely when every field is blank', () => {
    expect(
      siteEntityJsonLd({
        displayName: 'Acme',
        seo: { entity: { address: { streetAddress: '   ' } } },
      }),
    ).not.toHaveProperty('address')
  })

  it('keeps only https profiles in sameAs, de-duplicated', () => {
    expect(
      siteEntityJsonLd({
        displayName: 'Acme',
        seo: {
          entity: {
            sameAs: [
              'https://x.test/acme',
              'https://x.test/acme',
              'http://insecure.test/acme',
              'not a url',
            ],
          },
        },
      }),
    ).toMatchObject({ sameAs: ['https://x.test/acme'] })
  })

  it('prefers the entity URL over the site origin when they differ', () => {
    expect(
      siteEntityJsonLd(
        { displayName: 'Acme', seo: { entity: { url: 'https://group.test' } } },
        { origin: ORIGIN },
      ),
    ).toMatchObject({ url: 'https://group.test' })
  })

  it('prefers the entity description over the site meta description', () => {
    // They answer different questions: one describes a business, the other a
    // document.
    expect(
      siteEntityJsonLd({
        displayName: 'Acme',
        seo: {
          description: 'Home page copy.',
          entity: { description: 'A fastener manufacturer.' },
        },
      }),
    ).toMatchObject({ description: 'A fastener manufacturer.' })
  })
})

describe('siteEntityJsonLd — a local business (AGL-3383)', () => {
  /** Every business-only field, set, on an entity whose TYPE is not a business. */
  const businessFields = {
    areaServed: ['Austin'],
    openingHours: 'Mo-Fr 08:00-17:00',
    priceRange: '$$',
    paymentAccepted: 'Cash',
  }

  it('publishes an Organization and a Person EXACTLY as before, whatever else is stored', () => {
    /*
      THE CONTROL for everything below. Without a business type the new fields
      are inert — a site that typed hours and then cleared the type publishes
      what it published before this shipped, key for key and in the same
      order, so no existing site's structured data moves.
    */
    const organization = {
      type: HostEntityType.ORGANIZATION,
      name: 'Acme Widgets LLC',
      telephone: '+1-512-555-0100',
      address: { addressLocality: 'Austin' },
    }
    const before = siteEntityJsonLd(
      { seo: { entity: organization } },
      { origin: ORIGIN },
    )
    expect(before).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${ORIGIN}/${SITE_ENTITY_FRAGMENT}`,
      name: 'Acme Widgets LLC',
      url: ORIGIN,
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        telephone: '+1-512-555-0100',
      },
      address: { '@type': 'PostalAddress', addressLocality: 'Austin' },
    })
    const withInertFields = siteEntityJsonLd(
      { seo: { entity: { ...organization, ...businessFields, businessType: '' } } },
      { origin: ORIGIN },
    )
    expect(JSON.stringify(withInertFields)).toBe(JSON.stringify(before))

    const person = { type: '2', name: 'Ada Lovelace', telephone: '+44 20 0000' }
    const personBefore = siteEntityJsonLd(
      { seo: { entity: person } },
      { origin: ORIGIN },
    )
    expect(personBefore).toMatchObject({ '@type': 'Person' })
    // A Person with a business type is still a Person: schema.org gives it
    // none of the properties a business type exists to carry.
    expect(
      JSON.stringify(
        siteEntityJsonLd(
          { seo: { entity: { ...person, ...businessFields, businessType: 'Plumber' } } },
          { origin: ORIGIN },
        ),
      ),
    ).toBe(JSON.stringify(personBefore))
  })

  it('publishes every field of a LocalBusiness', () => {
    expect(
      siteEntityJsonLd(
        {
          seo: {
            entity: {
              type: '1',
              businessType: 'Plumber',
              name: 'Hill Country Plumbing',
              description: 'Residential plumbing repair.',
              logo: 'https://acme.test/logo.png',
              telephone: '+1-512-555-0100',
              address: { addressRegion: 'TX', addressCountry: 'US' },
              areaServed: ['Austin', ' Round Rock ', '', 'austin'],
              openingHours: 'Mo-Fr 08:00-17:00\nSa 9:00-13:00',
              priceRange: '$$',
              paymentAccepted: 'Cash, Zelle, Cash App',
            },
          },
        },
        { origin: ORIGIN },
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Plumber',
      '@id': `${ORIGIN}/${SITE_ENTITY_FRAGMENT}`,
      name: 'Hill Country Plumbing',
      description: 'Residential plumbing repair.',
      url: ORIGIN,
      logo: 'https://acme.test/logo.png',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        telephone: '+1-512-555-0100',
      },
      address: {
        '@type': 'PostalAddress',
        addressRegion: 'TX',
        addressCountry: 'US',
      },
      telephone: '+1-512-555-0100',
      areaServed: [
        { '@type': 'City', name: 'Austin' },
        { '@type': 'City', name: 'Round Rock' },
      ],
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          opens: '08:00',
          closes: '17:00',
        },
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Saturday'],
          opens: '09:00',
          closes: '13:00',
        },
      ],
      priceRange: '$$',
      paymentAccepted: 'Cash, Zelle, Cash App',
    })
  })

  it('publishes a service-area business with areas and no address', () => {
    const node = siteEntityJsonLd({
      displayName: 'Acme Remodeling',
      seo: {
        entity: {
          businessType: 'HomeAndConstructionBusiness',
          areaServed: ['Travis County'],
        },
      },
    })
    expect(node).toEqual({
      '@context': 'https://schema.org',
      '@type': 'HomeAndConstructionBusiness',
      name: 'Acme Remodeling',
      areaServed: [{ '@type': 'City', name: 'Travis County' }],
    })
  })

  it('falls back to Organization for a business type not on the list', () => {
    for (const businessType of ['Plumbr', 'Thing', '<script>', '  ']) {
      const node = siteEntityJsonLd({
        displayName: 'Acme',
        seo: { entity: { businessType, ...businessFields } },
      })
      expect([businessType, node?.['@type']]).toEqual([businessType, 'Organization'])
      expect(node).not.toHaveProperty('areaServed')
      expect(node).not.toHaveProperty('openingHoursSpecification')
    }
  })

  it('reads the business type case-insensitively, publishing the canonical name', () => {
    expect(
      siteEntityJsonLd({ displayName: 'Acme', seo: { entity: { businessType: 'hvacbusiness' } } }),
    ).toMatchObject({ '@type': 'HVACBusiness' })
  })

  it('drops hours lines that do not read, keeping the ones that do', () => {
    const node = siteEntityJsonLd({
      displayName: 'Acme',
      seo: {
        entity: {
          businessType: 'Store',
          openingHours: [
            'Mo-Fr 25:00-17:00',
            'Xx 09:00-17:00',
            'Sa 09:00',
            'Su 10:00-16:00',
            'whenever',
          ].join('\n'),
        },
      },
    })
    expect(node?.['openingHoursSpecification']).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Sunday'],
        opens: '10:00',
        closes: '16:00',
      },
    ])
  })

  it('omits every business field that is empty, rather than publishing [] or ""', () => {
    const node = siteEntityJsonLd({
      displayName: 'Acme',
      seo: {
        entity: {
          businessType: 'LocalBusiness',
          areaServed: [],
          openingHours: '\n  \n',
          priceRange: '   ',
          paymentAccepted: '',
          telephone: '',
        },
      },
    })
    expect(node).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Acme',
    })
  })

  it('gives the nested publisher the same type as the node it shares an @id with', () => {
    const entity = { name: 'Hill Country Plumbing', businessType: 'Plumber' }
    expect(hostSeoEntityJsonLd(entity)).toEqual({
      '@type': 'Plumber',
      name: 'Hill Country Plumbing',
    })
    expect(siteEntityJsonLd({ seo: { entity } })?.['@type']).toBe('Plumber')
    // And unchanged for the two types that existed before.
    expect(hostSeoEntityJsonLd({ name: 'Ada', type: '2', businessType: 'Plumber' })).toEqual({
      '@type': 'Person',
      name: 'Ada',
    })
    expect(siteEntitySchemaType(undefined)).toBe('Organization')
  })
})
