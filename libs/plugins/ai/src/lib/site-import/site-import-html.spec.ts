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
} from './site-import-html'

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
      { url: 'https://example.com/a.jpg', alt: 'A', sameSite: true },
      { url: 'https://cdn.test/b.jpg', alt: '', sameSite: false },
      { url: 'https://example.com/c-2x.jpg', alt: '', sameSite: true },
    ])
  })

  it('caps a block’s text', () => {
    const page = extract(`<p>${'word '.repeat(1_000)}</p>`)
    const [block] = page.blocks
    expect(block.kind === 'image' ? 0 : block.text.length).toBe(2_000)
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
