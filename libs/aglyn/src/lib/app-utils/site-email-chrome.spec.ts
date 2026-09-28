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

import { buildSiteEmailChrome } from './site-email-chrome'

const NOW = () => new Date('2026-09-28T12:00:00Z')

describe('buildSiteEmailChrome (AGL-3370)', () => {
  it('draws the site: its logo linked to its address, its support and its legal line', () => {
    const chrome = buildSiteEmailChrome({
      host: {
        displayName: 'Northwind Coffee',
        logoUrl: 'https://cdn.example/logo.png',
        cname: 'shop.northwind.test',
        business: { supportEmail: 'help@northwind.test', address: '1 Main St\nAustin, TX' },
      },
      reason: 'You’re receiving this because you placed an order with {{host.businessName}}.',
      now: NOW,
    })
    expect(chrome.header).toEqual({
      logoUrl: 'https://cdn.example/logo.png',
      logoAlt: 'Northwind Coffee',
      href: 'https://shop.northwind.test',
    })
    expect(chrome.footer).toEqual({
      reason: 'You’re receiving this because you placed an order with Northwind Coffee.',
      support: { label: 'help@northwind.test', href: 'mailto:help@northwind.test' },
      legal: '© 2026 Northwind Coffee · 1 Main St, Austin, TX',
    })
  })

  it('never names the platform', () => {
    const chrome = buildSiteEmailChrome({
      host: { displayName: 'Northwind Coffee', subdomain: 'northwind' },
      reason: 'You’re receiving this because you booked with {{host.businessName}}.',
      now: NOW,
    })
    // In the words a reader sees. The header still links to the site's own
    // address, which for a site without a domain of its own is its
    // subdomain on the platform's apex: that is where the site lives.
    const words = [chrome.header?.logoAlt, chrome.footer?.reason, chrome.footer?.legal]
    expect(words.join(' ')).not.toMatch(/aglyn/i)
  })

  it('refuses an SVG logo, which Gmail and Outlook draw as nothing, and names the site instead', () => {
    const chrome = buildSiteEmailChrome({
      host: { displayName: 'Northwind Coffee', logoUrl: 'https://cdn.example/logo.svg?v=2' },
      now: NOW,
    })
    expect(chrome.header).toEqual({ logoAlt: 'Northwind Coffee' })
  })

  it('reads "this site" rather than leaving a hole when the site has no name', () => {
    const chrome = buildSiteEmailChrome({
      host: { subdomain: 'northwind' },
      reason: 'You’re receiving this because you placed an order with {{host.businessName}}.',
      now: NOW,
    })
    expect(chrome.footer?.reason).toBe(
      'You’re receiving this because you placed an order with this site.',
    )
    // No name, no legal line: a copyright with no holder is not one.
    expect(chrome.footer?.legal).toBeUndefined()
  })

  it('leaves out what the site has not set', () => {
    const chrome = buildSiteEmailChrome({ host: { displayName: 'Northwind' }, now: NOW })
    expect(chrome.footer).toEqual({ legal: '© 2026 Northwind' })
  })
})
