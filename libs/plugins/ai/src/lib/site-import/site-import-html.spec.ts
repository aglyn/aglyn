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
 * The page extractor's edges (AGL-3974). The whole-page shapes are in
 * `site-import-crawl.spec.ts`, over recorded sites; these are the rules one
 * at a time.
 */

import {
  decodeHtmlEntities,
  extractSiteImportPage,
  readMetaValues,
  SITE_IMPORT_PAGE_LIMITS,
  type SiteImportBlock,
} from './site-import-html'
import { AGLYN_ORIGIN, aglynPage } from './fixtures/aglyn-com-recordings'
import { siteImportHeaderBrand, siteImportPageRead, siteImportPageSections, siteImportSiteFacts } from './site-import-page'
import { siteImportLogoCandidates } from './site-import-images'
import type { SiteImportPage } from './site-import-crawl'

const PAGE = 'https://example.com/page'
const sameSite = (url: URL) => url.origin === 'https://example.com'
const extract = (html: string) => extractSiteImportPage(html, PAGE, sameSite)

describe('what refuses a page outright', () => {
  it('is a password field, inside a form or not, in any quoting', () => {
    expect(extract('<input type="password">').loginForm).toBe(true)
    expect(extract("<div><INPUT name=p TYPE='Password'></div>").loginForm).toBe(true)
    expect(extract('<input type=password>').loginForm).toBe(true)
    const refused = extract('<h1>Sign in</h1><input type="password">')
    expect(refused.blocks).toEqual([])
    expect(refused.title).toBe('')
  })

  it('is not a password field written as text or in a comment', () => {
    expect(extract('<p>Never share your type="password" with anyone</p>').loginForm).toBe(false)
    expect(extract('<!-- <input type="password"> --><p>Hi</p>').loginForm).toBe(false)
  })
})

describe('forms', () => {
  it('drops a form with any payment field whole, by autocomplete hint or by name', () => {
    for (const field of [
      '<input autocomplete="cc-exp">',
      '<input name="card_number">',
      '<input id="cvv">',
      '<input name="iban">',
      '<select name="payment-method"><option>Visa</option></select>',
      '<div data-stripe="number"></div><input data-stripe="cvc">',
    ]) {
      const page = extract(`<form><p>Pay here</p>${field}</form><p>After</p>`)
      expect(page.forms).toEqual({ kept: [], removed: 1 })
      expect(page.blocks.map((block) => (block.kind === 'image' ? '' : block.text))).toEqual(['After'])
    }
  })

  it('keeps a contact form as its field list, and none of what was typed', () => {
    const page = extract('<form><input name="email" type="email" value="me@x.test"><select name="topic"><option>Hi</option></select></form>')
    expect(page.forms.kept).toEqual([{ fields: [{ type: 'email', name: 'email' }, { type: 'select', name: 'topic' }] }])
    expect(JSON.stringify(page)).not.toContain('me@x.test')
  })
})

describe('what never survives', () => {
  it('a script, even one left open to the end of the page', () => {
    const page = extract('<p>Before</p><script>var x = "<p>inside</p>"')
    expect(page.blocks.map((block) => (block.kind === 'image' ? '' : block.text))).toEqual(['Before'])
  })

  it('a script whose text holds markup', () => {
    const page = extract('<script>document.write("<h1>Fake</h1><form>")</script><h1>Real</h1>')
    expect(page.blocks).toEqual([{ kind: 'heading', level: 1, text: 'Real', region: 'main' }])
  })
})

describe('structure', () => {
  it('reads loose text in a div as a paragraph, and a <br> inside a block as a space', () => {
    const page = extract('<body><div>Loose words<div>More</div></div><p>One<br>two</p></body>')
    expect(page.blocks.map((block) => (block.kind === 'image' ? '' : block.text))).toEqual(['Loose words', 'More', 'One two'])
  })

  it('takes a header’s links as the menu when the page has no <nav>', () => {
    const page = extract('<header><a href="/a">A</a><a href="https://other.test/b">B</a></header><p>Body</p>')
    expect(page.navLinks).toEqual([
      { text: 'A', url: 'https://example.com/a' },
      { text: 'B', url: 'https://other.test/b' },
    ])
    expect(page.links).toEqual(['https://example.com/a'])
  })

  it('keeps nav text out of the content', () => {
    const page = extract('<nav><a href="/x">Menu item</a> Loose nav text</nav><p>Body</p>')
    expect(page.blocks.map((block) => (block.kind === 'image' ? '' : block.text))).toEqual(['Body'])
  })

  it('reads an image from src, data-src or the first srcset entry, and only http(s)', () => {
    const page = extract(
      '<img src="/a.jpg" alt="A"><img data-src="https://cdn.test/b.jpg"><img srcset="/c-2x.jpg 2x, /c.jpg 1x"><img src="data:image/png;base64,AAAA"><img src="javascript:alert(1)">',
    )
    expect(page.images).toEqual([
      { url: 'https://example.com/a.jpg', alt: 'A', sameSite: true, region: 'main' },
      { url: 'https://cdn.test/b.jpg', alt: '', sameSite: false, region: 'main' },
      { url: 'https://example.com/c-2x.jpg', alt: '', sameSite: true, region: 'main' },
    ])
  })

  it('caps a block’s text', () => {
    const page = extract(`<p>${'word '.repeat(5_000)}</p>`)
    const [block] = page.blocks
    expect(block.kind === 'image' ? 0 : block.text.length).toBe(SITE_IMPORT_PAGE_LIMITS.blockChars)
  })
})

describe('entities and meta tags', () => {
  it('decodes named and numeric references, and drops control characters', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry &#8212; &#x2019; &copy; &bogus; &#1;')).toBe(
      'Tom & Jerry — ’ © &bogus; ',
    )
  })

  it('reads every value of a named meta tag, in any attribute order and quoting', () => {
    const html =
      '<meta content="one" name="aglyn-site-verification"><meta name=AGLYN-SITE-VERIFICATION content=two><meta property="aglyn-site-verification" content="three">'
    expect(readMetaValues(html, 'aglyn-site-verification')).toEqual(['one', 'two'])
  })
})

/*------------------------------------------
 * aglyn.com, as recorded on 10/28 (AGL-4083)
 *-----------------------------------------*/

const aglynSameSite = (url: URL) => url.origin === AGLYN_ORIGIN
const aglyn = (path: string) => extractSiteImportPage(aglynPage(path), `${AGLYN_ORIGIN}${path}`, aglynSameSite)
/** A recorded page as the crawler keeps it. */
const aglynCrawled = (path: string): SiteImportPage => {
  const extract = aglyn(path)
  return { ...extract, url: `${AGLYN_ORIGIN}${path}`, path, foundBy: path === '/' ? 'home' : 'sitemap', bytes: 0 }
}
const textOf = (blocks: readonly SiteImportBlock[]) => blocks.map((block) => (block.kind === 'image' ? '' : block.text))

describe('aglyn.com: the words as the page shows them', () => {
  it('keeps a space between inline links: never "Sign inStart free"', () => {
    const page = aglyn('/')
    const all = textOf(page.blocks).join('\n')
    expect(all).not.toContain('Sign inStart free')
    expect(page.blocks).toContainEqual({ kind: 'link', text: 'Sign in', href: 'https://app.aglyn.com/signin', region: 'header' })
    expect(page.blocks).toContainEqual({ kind: 'link', text: 'Start free', href: 'https://app.aglyn.com/signup', region: 'header' })
    // Words that sit in inline tags side by side stay words: "aglyn.com · Austin" is not fused either.
    expect(textOf(aglyn('/contact').blocks)).toContain('Aglyn LLC · aglyn.com · Austin, Texas')
  })

  it('names a menu entry by its first line, without the mega-menu’s description', () => {
    const page = aglyn('/')
    expect(page.navLinks).toContainEqual({ text: 'Besigner', url: `${AGLYN_ORIGIN}/product/besigner` })
    expect(page.navLinks).toContainEqual({ text: 'Pricing', url: `${AGLYN_ORIGIN}/pricing` })
    expect(page.navLinks.some((link) => /Visual builder|BesignerVisual/.test(link.text))).toBe(false)
  })

  it('keeps mailto and tel links, and links out, as link blocks in the order the page shows them', () => {
    const page = aglyn('/contact')
    const links = page.blocks.filter((block) => block.kind === 'link' && block.region === 'main')
    expect(links.map((block) => (block.kind === 'link' ? [block.text, block.href] : []))).toEqual([
      ['sales@example.com', 'mailto:sales@example.com'],
      ['support@example.com', 'mailto:support@example.com'],
      ['hello@example.com', 'mailto:hello@example.com'],
      ['github.com/aglyn', 'https://github.com/aglyn'],
    ])
    // Each comes right after the paragraph it answers.
    const index = page.blocks.findIndex((block) => block.kind === 'link' && block.href === 'mailto:sales@example.com')
    expect(page.blocks[index - 1]).toMatchObject({ kind: 'paragraph', text: 'See if Aglyn fits your team, agency, or store.' })
    const tel = extract('<p>Call <a href="tel:+15125550142">(512) 555-0142</a> today.</p>')
    expect(tel.blocks).toEqual([
      { kind: 'paragraph', text: 'Call (512) 555-0142 today.', region: 'main' },
      { kind: 'link', text: '(512) 555-0142', href: 'tel:+15125550142', region: 'main', inline: true },
    ])
  })

  it('keeps a contact form’s fields, the hidden trap field left out', () => {
    expect(aglyn('/contact').forms.kept).toEqual([
      {
        fields: [
          { type: 'text', name: 'name' },
          { type: 'email', name: 'email' },
          { type: 'textarea', name: 'message' },
          { type: 'checkbox', name: 'marketingOptIn' },
        ],
      },
    ])
  })

  it('keeps every section of a long page: the privacy policy’s 13, and its last words', () => {
    const page = aglynCrawled('/legal/privacy')
    const h2 = page.blocks.filter((block) => block.kind === 'heading' && block.level === 2 && block.region === 'main')
    expect(h2).toHaveLength(13)
    expect(siteImportPageSections(page)).toHaveLength(14)
    expect(siteImportPageSections(page)[13]).toBe('13. Contact Us')
    const read = siteImportPageRead(page, 'x')
    const words = textOf(read.blocks).join(' ')
    expect(words.length).toBeGreaterThan(30_000)
    expect(words).toContain('Your continued use of the Services after changes take effect constitutes acceptance.')
    expect(words).toContain('Privacy: privacy@example.com')
    // Its words are its own: a quoted name keeps its quotes tight.
    expect(words).toContain('(“Aglyn,” “we,” “us,” or “our”)'.replace(/[“”]/g, '"'))
    expect(read.blocks.every((block) => block.region === 'main')).toBe(true)
  })

  it('keeps the whole pricing page, past the old 400-block cap', () => {
    const page = aglyn('/pricing')
    expect(page.blocks.length).toBeGreaterThan(400)
    expect(textOf(page.blocks).join(' ')).toContain('Every competitor figure is dated and taken from that vendor')
  })

  it('reads every section of the home page', () => {
    expect(siteImportPageSections(aglynCrawled('/'))).toHaveLength(10)
  })
})

describe('aglyn.com: the brand, the logo and the share card', () => {
  it('reads the header brand as the logo alone, as aglyn.com shows it', () => {
    const brand = siteImportHeaderBrand(aglynCrawled('/'))
    expect(brand).toMatchObject({
      kind: 'logo-only',
      name: false,
      logo: { url: `${AGLYN_ORIGIN}/api/media/cdn/org:FixtureOrg:FixtureHst/hWwBgGtkiM?v=9c7e958bf4277afb.2`, alt: 'Aglyn', source: 'header' },
    })
  })

  it('reads a logo with the name beside it, and a name alone', () => {
    const page = (header: string): SiteImportPage => ({
      ...extract(`<head><title>Rosie’s Bakery</title><meta property="og:site_name" content="Rosie’s Bakery"></head><body><header>${header}<nav><a href="/menu">Menu</a></nav></header><main><h1>Hi</h1></main></body>`),
      url: 'https://example.com/',
      path: '/',
      foundBy: 'home',
      bytes: 0,
    })
    expect(siteImportHeaderBrand(page('<a href="/"><img src="/logo.png" alt="Rosie’s Bakery logo"><span>Rosie’s Bakery</span></a>'))).toMatchObject({
      kind: 'logo-and-name',
      name: true,
      text: 'Rosie’s Bakery',
      logo: { url: 'https://example.com/logo.png' },
    })
    expect(siteImportHeaderBrand(page('<a href="/" class="site-title">Rosie’s Bakery</a>'))).toMatchObject({
      kind: 'name-only',
      name: true,
      text: 'Rosie’s Bakery',
      logo: null,
    })
  })

  it('finds the header logo, an SVG one too, then the footer’s, the structured data’s and the touch icon', () => {
    const candidates = siteImportLogoCandidates(aglynCrawled('/'))
    expect(candidates[0]).toMatchObject({ source: 'header', alt: 'Aglyn' })
    expect(candidates.map((candidate) => candidate.source)).toEqual(['header', 'footer', 'structured-data', 'apple-touch-icon', 'icon'])
    // The touch icon is the largest one; the icon the largest of its sizes.
    expect(candidates[3].url).toContain('icon=flat-180')
    expect(candidates[4].url).toContain('icon=png-48')
    const svg = siteImportLogoCandidates({
      ...aglynCrawled('/'),
      ...extract('<header><a href="/"><img src="/brand/logo.svg" alt="Logo"></a></header><main><p>Hi</p></main>'),
    })
    expect(svg[0]).toMatchObject({ url: 'https://example.com/brand/logo.svg', type: 'svg', source: 'header' })
  })

  it('reads the share card and the site’s own name', () => {
    const page = aglyn('/')
    expect(page.ogImage).toBe(`${AGLYN_ORIGIN}/api/media/cdn/FixtureHst/-Pi77Qvmb1`)
    expect(page.siteName).toBe('Aglyn')
  })

  it('takes a <picture>’s first source when its <img> has no address of its own', () => {
    const page = extract('<picture><source srcset="/hero.webp 1x, /hero@2x.webp 2x" type="image/webp"><img alt="Our shop" src="data:image/gif;base64,R0lGOD"></picture>')
    expect(page.images).toEqual([{ url: 'https://example.com/hero.webp', alt: 'Our shop', sameSite: true, region: 'main' }])
    expect(page.blocks).toEqual([{ kind: 'image', url: 'https://example.com/hero.webp', alt: 'Our shop', region: 'main' }])
  })
})

describe('aglyn.com: the facts its header and footer carry', () => {
  it('reads the address, phone, email and social links, from the page and its structured data', () => {
    const facts = siteImportSiteFacts(aglynCrawled('/'))
    expect(facts.organization).toMatchObject({
      name: 'Aglyn',
      telephone: '+1-512-555-0142',
      email: 'support@example.com',
      address: '5900 Balcones Drive STE 100, Austin, TX 78731, US',
    })
    expect(facts.social).toEqual(
      expect.arrayContaining(['https://twitter.com/AglynSoftware', 'https://www.linkedin.com/company/aglyn', 'https://github.com/aglyn/aglyn']),
    )
    expect(facts.footer.some((block) => block.kind === 'paragraph' && block.text.startsWith('© 2026 Aglyn LLC'))).toBe(true)
    expect(facts.header.every((block) => block.region === 'header')).toBe(true)
    expect(facts.emails).toEqual(['support@example.com'])
    expect(facts.phones).toEqual(['+1-512-555-0142'])
  })
})
