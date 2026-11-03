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
      // Its column and its tile (AGL-4139).
      at: 0,
      tile: { fill: '#e6f5ff', radius: 8, color: '#0077ad' },
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
    // The developer card's link is its box's (AGL-4139), not one of these.
    expect(read.links.map((link) => link.label)).toEqual(['Privacy', 'Terms', 'Legal', 'Status'])
    expect(read.copyright).toBe('© 2026 Aglyn LLC. All rights reserved. Aglyn™ and Besigner™ are trademarks of Aglyn LLC.')
    expect(read.text[0]).toBe('The visual builder with a real platform underneath. Design, ship, and run every site from one place.')
    // The footer prints no address; the site's structured data does.
    expect([read.address, read.phone, read.email]).toEqual(['5900 Balcones Drive STE 100, Austin, TX 78731, US', '+1-512-555-0142', 'support@example.com'])
  })
})

describe('aglyn.com’s mega menus as it builds them (AGL-4139)', () => {
  const nav = () => {
    const tree = siteImportNavTree(page('home'))
    if (!tree) throw new Error('no menu')
    return tree
  }

  it('reads Product’s three columns in the source’s order: six entries, seven, then the featured card', () => {
    const product = nav().items[0]
    expect(product?.columns?.map((column) => [column.heading, column.band, column.width ?? null])).toEqual([
      [null, 'plain', null],
      [null, 'plain', null],
      ['FEATURED', 'soft', 300],
    ])
    const at = (index: number) => product?.items.filter((entry) => entry.at === index).map((entry) => entry.label)
    expect(at(0)).toEqual(['Besigner', 'Console', 'Commerce', 'POS', 'Forms & Inbox', 'CRM'])
    // Aglyn AI opens the second column, as the source sets it, not the end of the first.
    expect(at(1)?.[0]).toBe('Aglyn AI')
    expect(at(1)).toHaveLength(7)
    expect(at(2)).toEqual(['See all products →'])
  })

  it('reads the featured card’s picture, title and line, the picture outside any link', () => {
    const featured = nav().items[0]?.columns?.[2]
    expect(featured?.image?.url).toMatch(/^https:\/\/aglyn\.com\/api\/media\/cdn\/.+\/CRxi1PaHY1\?/)
    expect(featured?.lines).toEqual(['Besigner', 'Design on a live canvas with real components and instant publish.'])
  })

  it('reads each entry’s tinted tile: its fill, its corners and its icon’s own color', () => {
    const product = nav().items[0]
    const tiled = product?.items.filter((entry) => entry.tile) ?? []
    expect(tiled).toHaveLength(13)
    expect(product?.items[0]?.tile).toEqual({ fill: '#e6f5ff', radius: 8, color: '#0077ad' })
    expect(product?.items[1]?.tile).toEqual({ fill: '#eef0f2', radius: 8, color: '#404c5c' })
    expect(product?.items[4]?.tile).toEqual({ fill: '#fbe6fe', radius: 8, color: '#e040fb' })
    // A link with no icon has no tile.
    expect(product?.items[13]?.tile).toBeUndefined()
  })

  it('reads Solutions’ dark developer column with its heading, its words and its three links', () => {
    const solutions = nav().items[1]
    expect(solutions?.columns?.map((column) => [column.heading, column.band, column.width ?? null])).toEqual([
      ['BY TEAM', 'plain', 328],
      ['BY USE CASE', 'plain', 328],
      ['FOR DEVELOPERS', 'dark', 280],
    ])
    expect(solutions?.columns?.[2]?.lines).toEqual([
      'Open source & self-hostable',
      'Aglyn is Apache-2.0. Fork it, self-host it with Docker, and extend it with plugins and APIs.',
    ])
    expect(solutions?.items.filter((entry) => entry.at === 2).map((entry) => entry.label)).toEqual(['Developers home', 'Star on GitHub →', 'See all solutions →'])
    // The plain links of the middle column have no tile.
    expect(solutions?.items.filter((entry) => entry.at === 1).some((entry) => entry.tile)).toBe(false)
  })

  it('reads both panels as opening on hover: hidden until shown, under names that are links, capped at 1,536 pixels', () => {
    expect(nav().items.slice(0, 2).map((group) => group.panel)).toEqual([
      { width: 1536, hover: true },
      { width: 1536, hover: true },
    ])
    expect(nav().items.slice(2).every((group) => !group.panel && !group.columns)).toBe(true)
  })

  it('reads the footer’s logo and its developer card as a filled box, which its words and links then leave out', () => {
    const footer = siteImportFooterColumns(page('home'))
    expect(footer?.logo).toBe(true)
    expect(footer?.panels).toEqual([
      {
        heading: 'ARE YOU A DEVELOPER?',
        lines: ['Open source. Self-hostable. Yours to run.'],
        band: 'soft',
        links: [{ label: 'Aglyn for developers →', href: 'https://aglyn.com/developers' }],
        iconPath: expect.stringMatching(/^M14\.6,16\.6/),
      },
    ])
    expect(footer?.text).toEqual(['The visual builder with a real platform underneath. Design, ship, and run every site from one place.'])
  })
})

describe('how a menu opens (AGL-4139)', () => {
  /** A one-menu header: its name a link or a button, its panel hidden by the page's own sheet or not. */
  const header = (name: string, hidden: boolean) => `<!doctype html><html><head><style>${hidden ? '.panel{display:none}' : ''}</style></head><body>
    <header><nav><div class="item">${name}<div class="panel"><a href="/a">Alpha</a><a href="/b">Beta</a></div></div><a href="/about">About</a></nav></header>
    <main><h1>Fixture</h1><p>Words.</p></main></body></html>`
  const read = (html: string) => {
    const extract = extractSiteImportPage(html, 'https://shop.example/', (url) => url.hostname === 'shop.example', { structure: true })
    return siteImportNavTree(extract as SiteImportFrameSource)?.items[0]
  }

  it('on hover, where the source hides its panel under a name that is a link', () => {
    expect(read(header('<a href="/shop">Shop</a>', true))?.panel).toEqual({ width: null, hover: true })
  })

  it('on a click, where the name is a button: a disclosure the source opens on a click', () => {
    const group = read(header('<button type="button" aria-expanded="false">Shop</button>', true))
    expect(group?.label).toBe('Shop')
    expect(group?.panel?.hover).toBe(false)
  })

  it('not on hover where nothing hides its panel', () => {
    expect(read(header('<a href="/shop">Shop</a>', false))?.panel?.hover).toBe(false)
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

  it('reads its folder as one column of plain links, no tiles, opening as the source’s sheets say nothing to hide it (AGL-4139)', () => {
    const folder = siteImportNavTree(page('pottery'))?.items[0]
    expect(folder?.columns).toEqual([{ heading: null, lines: [], band: 'plain' }])
    expect(folder?.items.every((entry) => entry.at === 0 && !entry.tile)).toBe(true)
    expect(folder?.panel).toEqual({ width: null, hover: false })
    const footer = siteImportFooterColumns(page('pottery'))
    expect([footer?.logo, footer?.panels]).toEqual([undefined, undefined])
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
