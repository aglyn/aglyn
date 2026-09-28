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

import { TENANT_APEX } from './host-naming'
import {
  isSiteOwnUrl,
  readSiteReturnHost,
  siteOwnHosts,
  siteReturnOrigin,
  siteReturnUrl,
} from './site-return-url'

const SHOP = { subdomain: 'tanyas-bakery', cname: 'tanyasbakery.com' }
const APEX_HOST = `tanyas-bakery.${TENANT_APEX}`

describe('siteReturnUrl (AGL-3363)', () => {
  it('keeps the page the shopper was on when it is the shop’s custom domain (false-positive guard)', () => {
    expect(
      siteReturnUrl({
        candidates: ['https://tanyasbakery.com/products/sourdough?utm_source=ig', `https://${APEX_HOST}`],
        site: SHOP,
      }),
    ).toBe('https://tanyasbakery.com/products/sourdough?utm_source=ig')
  })

  it('accepts www. of the custom domain, and the apex subdomain', () => {
    expect(isSiteOwnUrl('https://www.tanyasbakery.com/cart', SHOP)).toBe(true)
    expect(isSiteOwnUrl(`https://${APEX_HOST}/cart`, SHOP)).toBe(true)
  })

  it('refuses a Referer the caller pointed at a phishing lookalike', () => {
    const url = siteReturnUrl({
      candidates: ['https://paypal-verify.top/login', 'https://paypal-verify.top'],
      site: SHOP,
      requestHost: 'paypal-verify.top',
    })
    expect(url).toBe('https://tanyasbakery.com/')
  })

  it('refuses an arbitrary domain and another tenant’s site', () => {
    expect(isSiteOwnUrl('https://example.org/', SHOP)).toBe(false)
    expect(isSiteOwnUrl(`https://someone-else.${TENANT_APEX}/`, SHOP)).toBe(false)
  })

  it('refuses plain http, and credentials in the authority', () => {
    expect(isSiteOwnUrl('http://tanyasbakery.com/', SHOP)).toBe(false)
    expect(isSiteOwnUrl('https://tanyasbakery.com@evil.top/', SHOP)).toBe(false)
    expect(isSiteOwnUrl('https://user:pw@tanyasbakery.com/', SHOP)).toBe(false)
  })

  it('never accepts a lookalike even as the site’s own custom domain; the apex subdomain still works', () => {
    const site = { subdomain: 'shop-9', cname: 'paypal-secure-login.com' }
    expect(siteOwnHosts(site)).toEqual([`shop-9.${TENANT_APEX}`])
    expect(
      siteReturnUrl({ candidates: ['https://paypal-secure-login.com/checkout'], site }),
    ).toBe(`https://shop-9.${TENANT_APEX}/`)
  })

  it('returns to the apex subdomain for a site with no custom domain', () => {
    expect(
      siteReturnUrl({ candidates: ['https://evil.top/'], site: { subdomain: 'tanyas-bakery' } }),
    ).toBe(`https://${APEX_HOST}/`)
  })

  it('drops a fragment', () => {
    expect(
      siteReturnUrl({ candidates: ['https://tanyasbakery.com/menu#specials'], site: SHOP }),
    ).toBe('https://tanyasbakery.com/menu')
  })

  it('accepts localhost for development', () => {
    expect(isSiteOwnUrl('http://localhost:4200/products/x', SHOP)).toBe(true)
  })

  it('falls back to the request host only when the site names no host at all', () => {
    expect(siteReturnUrl({ candidates: ['https://evil.top/'], site: null, requestHost: 'shop.example' })).toBe(
      'https://shop.example/',
    )
  })

  it('gives the origin for a door that returns to the site root', () => {
    expect(
      siteReturnOrigin({ candidates: ['https://phish.example'], site: SHOP }),
    ).toBe('https://tanyasbakery.com')
  })
})

describe('readSiteReturnHost', () => {
  it('reads the host document, and answers null when the read fails', async () => {
    await expect(readSiteReturnHost({ get: async () => ({ data: () => SHOP }) })).resolves.toEqual(SHOP)
    await expect(
      readSiteReturnHost({
        get: async () => {
          throw new Error('unavailable')
        },
      }),
    ).resolves.toBeNull()
    await expect(readSiteReturnHost(null)).resolves.toBeNull()
  })
})
