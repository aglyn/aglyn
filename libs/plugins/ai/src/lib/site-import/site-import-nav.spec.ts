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
 * The menu and footer readers over recorded home pages (AGL-4106). On 10/29
 * the imported header was the wave's seven page titles cut to 28 characters,
 * with no menu and no phone menu, and the footer seven links and the host's
 * name; the source's own header is five items, two of them mega menus, and
 * two buttons.
 */

import { extractSiteImportPage } from './site-import-html'
import { siteImportFooterColumns, siteImportNavTree, siteImportSocialNetwork, type SiteImportFrameSource } from './site-import-nav'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from './fixtures/site-layout-recordings'

function page(name: SiteLayoutPageName): SiteImportFrameSource {
  const extract = extractSiteImportPage(siteLayoutRecording(name), SITE_LAYOUT_PAGES[name].url, siteLayoutSameSite(name), { structure: true })
  return extract as SiteImportFrameSource
}

describe('aglyn.com’s header menu', () => {
  const nav = () => {
    const tree = siteImportNavTree(page('home'))
    if (!tree) throw new Error('no menu')
    return tree
  }

  it('reads its five top-level items as the source shows them, two of them menus', () => {
    expect(nav().items.map((item) => [item.label, item.href, item.items.length])).toEqual([
      ['Product', 'https://aglyn.com/product', 14],
      ['Solutions', 'https://aglyn.com/solutions', 16],
      ['Pricing', 'https://aglyn.com/pricing', 0],
      ['Docs', 'https://docs.aglyn.com/', 0],
      ['Blog', 'https://aglyn.com/blog', 0],
    ])
  })

  it('reads the Product mega menu’s entries with their descriptions and icons', () => {
    const product = nav().items[0]
    const described = product?.items.filter((entry) => entry.text && entry.iconPath && entry.viewBox === '0 0 24 24') ?? []
    expect(described).toHaveLength(13)
    expect(product?.items[0]).toEqual({
      label: 'Besigner',
      text: 'Visual builder on a live canvas',
      href: 'https://aglyn.com/product/besigner',
      iconPath: expect.stringMatching(/^M3 11H11V3H3/),
      viewBox: '0 0 24 24',
    })
    expect(product?.items[13]).toMatchObject({ label: 'See all products →', href: 'https://aglyn.com/product' })
  })

  it('reads the Solutions menu by its columns’ headings', () => {
    const columns = new Map<string, number>()
    for (const entry of nav().items[1]?.items ?? []) columns.set(entry.column ?? '', (columns.get(entry.column ?? '') ?? 0) + 1)
    expect([...columns]).toEqual([
      ['BY TEAM', 6],
      ['BY USE CASE', 7],
      ['FOR DEVELOPERS', 3],
    ])
  })

  it('holds no array inside an array, menu or footer, as a Firestore document must', () => {
    const nested = (value: unknown, inArray = false): boolean =>
      Array.isArray(value) ? inArray || value.some((entry) => nested(entry, true)) : !!value && typeof value === 'object' && Object.values(value).some((entry) => nested(entry))
    expect(nested(nav())).toBe(false)
    expect(nested(siteImportFooterColumns(page('home')))).toBe(false)
  })

  it('reads its two buttons with their addresses, outbound as the source has them, and its phone menu button', () => {
    expect(nav().ctas).toEqual([
      { label: 'Sign in', href: 'https://app.aglyn.com/signin', style: 'quiet' },
      { label: 'Start free', href: 'https://app.aglyn.com/signup', style: 'primary' },
    ])
    expect(nav().phoneMenu).toBe(true)
    expect(nav().background).toBe('#f5f5f5')
  })
})

describe('aglyn.com’s footer', () => {
  const footer = () => {
    const read = siteImportFooterColumns(page('home'))
    if (!read) throw new Error('no footer')
    return read
  }

  it('reads its six columns by their headings, with every link', () => {
    expect(footer().columns.map((column) => [column.heading, column.links.length])).toEqual([
      ['Product', 13],
      ['Solutions', 6],
      ['Use cases', 6],
      ['Resources', 13],
      ['Company', 5],
      ['Documentation', 6],
    ])
    expect(footer().columns[4]?.links[0]).toEqual({ label: 'About', href: 'https://aglyn.com/about' })
  })

  it('reads its seven profiles, its other links, its © line word for word, and its facts', () => {
    const read = footer()
    expect(read.social.map((entry) => entry.network)).toEqual(['x', 'linkedin', 'github', 'facebook', 'youtube', 'instagram', 'tiktok'])
    expect(read.links.map((link) => link.label)).toEqual(['Aglyn for developers →', 'Privacy', 'Terms', 'Legal', 'Status'])
    expect(read.copyright).toBe('© 2026 Aglyn LLC. All rights reserved. Aglyn™ and Besigner™ are trademarks of Aglyn LLC.')
    expect(read.text[0]).toBe('The visual builder with a real platform underneath. Design, ship, and run every site from one place.')
    // The footer prints no address; the site's structured data does.
    expect([read.address, read.phone, read.email]).toEqual(['5900 Balcones Drive STE 100, Austin, TX 78731, US', '+1-512-555-0142', 'support@example.com'])
  })
})

describe('a Squarespace header and footer', () => {
  it('reads a folder as a menu, the call to action and the burger', () => {
    const nav = siteImportNavTree(page('pottery'))
    expect(nav?.items.map((item) => [item.label, item.items.map((entry) => entry.label)])).toEqual([
      ['Classes', ['Wheel throwing', 'Hand building', 'Kids clay club']],
      ['Gallery', []],
      ['Visit', []],
      ['Shop', []],
    ])
    expect(nav?.ctas).toEqual([{ label: 'Book a class', href: 'https://www.tidewater-pottery.example/book', style: 'secondary' }])
    expect(nav?.phoneMenu).toBe(true)
  })

  it('reads the footer’s column, its address, phone and email as written, its icon profiles by their names', () => {
    const footer = siteImportFooterColumns(page('pottery'))
    expect(footer?.columns).toEqual([
      {
        heading: 'Studio',
        links: [
          { label: 'Classes', href: 'https://www.tidewater-pottery.example/classes' },
          { label: 'Membership', href: 'https://www.tidewater-pottery.example/membership' },
          { label: 'Gift cards', href: 'https://www.tidewater-pottery.example/gift-cards' },
        ],
      },
    ])
    expect([footer?.address, footer?.phone, footer?.email]).toEqual(['14 Wharf Street, Port Fixture, ME 04000', '(207) 555-0187', 'studio@example.com'])
    expect(footer?.social.map((entry) => [entry.label, entry.network])).toEqual([
      ['Instagram', 'instagram'],
      ['Facebook', 'facebook'],
    ])
    expect(footer?.copyright).toBe('© 2026 Tidewater Pottery Studio')
  })
})

describe('profiles', () => {
  it('names the network a profile is on, and nothing for any other address', () => {
    expect(siteImportSocialNetwork('https://x.com/someone')).toBe('x')
    expect(siteImportSocialNetwork('https://www.linkedin.com/company/x')).toBe('linkedin')
    expect(siteImportSocialNetwork('https://example.com/x')).toBeNull()
    expect(siteImportSocialNetwork('not an address')).toBeNull()
  })
})
