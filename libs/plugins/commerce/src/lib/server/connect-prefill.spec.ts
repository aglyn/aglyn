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

import {
  missingBusinessProfilePrefill,
  prefillSiteUrl,
  stripeAccountPrefill,
} from './connect-prefill'

describe('stripeAccountPrefill (AGL-4245)', () => {
  it('reads the business details and the live custom domain', () => {
    expect(
      stripeAccountPrefill({
        displayName: 'Shop',
        subdomain: 'shop',
        cname: 'www.acme.test',
        seo: {
          entity: {
            name: ' Acme Goods ',
            telephone: '(512) 555-0100',
            address: { streetAddress: '1 Main St', addressCountry: 'US' },
          },
        },
        business: { supportEmail: 'hello@acme.test' },
      }),
    ).toEqual({
      'business_profile[name]': 'Acme Goods',
      'business_profile[url]': 'https://www.acme.test',
      'business_profile[support_email]': 'hello@acme.test',
      'business_profile[support_phone]': '(512) 555-0100',
    })
  })

  it('falls back to the display name and the platform address', () => {
    expect(
      stripeAccountPrefill({ displayName: 'Shop', cname: 'pending.test', cnameAttachmentPending: true }, { subdomain: 'shop' }),
    ).toEqual({
      'business_profile[name]': 'Shop',
      'business_profile[url]': 'https://shop.aglyn.app',
    })
  })

  it('leaves out an email or phone Stripe could not read', () => {
    const params = stripeAccountPrefill({
      seo: { entity: { email: 'not an email', telephone: 'call us' } },
    })
    expect(params).toEqual({})
  })

  it('never sends a country, an address or anything on the legal entity', () => {
    const params = stripeAccountPrefill({
      displayName: 'Shop',
      seo: {
        entity: {
          address: {
            streetAddress: '1 Main St',
            addressLocality: 'Austin',
            addressCountry: 'United States',
          },
        },
      },
    })
    expect(Object.keys(params)).toEqual(['business_profile[name]'])
  })

  it('is empty for no site', () => {
    expect(stripeAccountPrefill(null)).toEqual({})
  })
})

describe('prefillSiteUrl', () => {
  it('refuses a platform-apex custom domain and keeps the subdomain', () => {
    expect(prefillSiteUrl({ cname: 'shop.aglyn.app', subdomain: 'shop' })).toBe(
      'https://shop.aglyn.app',
    )
  })
  it('is empty when the site has no address', () => {
    expect(prefillSiteUrl({})).toBe('')
  })
})

describe('missingBusinessProfilePrefill', () => {
  it('keeps only what the account does not hold yet', () => {
    expect(
      missingBusinessProfilePrefill(
        {
          'business_profile[name]': 'Acme',
          'business_profile[url]': 'https://acme.test',
        },
        { business_profile: { name: 'Typed in Stripe', url: '' } },
      ),
    ).toEqual({ 'business_profile[url]': 'https://acme.test' })
  })
  it('passes nothing that is not a business profile field', () => {
    expect(missingBusinessProfilePrefill({ country: 'US' }, {})).toEqual({})
  })
})
