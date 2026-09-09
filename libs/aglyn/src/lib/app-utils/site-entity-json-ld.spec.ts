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
import {
  SITE_ENTITY_FRAGMENT,
  hostSeoEntityJsonLd,
  siteEntityJsonLd,
} from './content-authors'

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
