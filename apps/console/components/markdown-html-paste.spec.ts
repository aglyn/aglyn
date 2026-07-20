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

import { htmlToInlines, htmlToRows } from './markdown-html-paste'

const inlinesOf = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return htmlToInlines(doc.body)
}

/** Rows without keys — keys are placeholders the editor re-keys anyway. */
const rowsOf = (html: string) =>
  htmlToRows(html).map(({ key: _key, ...row }) => row)

describe('htmlToInlines (AGL-596)', () => {
  it('maps strong/b, em/i and a[href] to markdown-lite inlines', () => {
    expect(
      inlinesOf('plain <strong>bold</strong> and <em>italic</em> here'),
    ).toEqual([
      { type: 'text', text: 'plain ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' and ' },
      { type: 'italic', text: 'italic' },
      { type: 'text', text: ' here' },
    ])
    expect(inlinesOf('see <b>this</b> and <i>that</i>')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'bold', text: 'this' },
      { type: 'text', text: ' and ' },
      { type: 'italic', text: 'that' },
    ])
  })

  it('keeps the RAW href attribute so site paths survive', () => {
    expect(inlinesOf('go to <a href="/pricing">pricing</a>')).toEqual([
      { type: 'text', text: 'go to ' },
      { type: 'link', text: 'pricing', href: '/pricing' },
    ])
    expect(
      inlinesOf('<a href="https://example.com/a?b=1">docs</a>'),
    ).toEqual([
      { type: 'link', text: 'docs', href: 'https://example.com/a?b=1' },
    ])
  })

  it('recurses anchors without an href instead of linking them', () => {
    expect(inlinesOf('an <a name="x">anchor</a>')).toEqual([
      { type: 'text', text: 'an anchor' },
    ])
  })

  it('flattens nested marks to the OUTERMOST mark', () => {
    expect(inlinesOf('<strong>very <em>nested</em> text</strong>')).toEqual([
      { type: 'bold', text: 'very nested text' },
    ])
    expect(
      inlinesOf('<a href="/x"><strong>bold</strong> link</a>'),
    ).toEqual([{ type: 'link', text: 'bold link', href: '/x' }])
  })

  it('skips script and style subtrees entirely', () => {
    expect(
      inlinesOf(
        'keep<style>p { color: red }</style> this<script>alert(1)</script>',
      ),
    ).toEqual([{ type: 'text', text: 'keep this' }])
  })

  it('normalizes whitespace runs but keeps the space between runs', () => {
    expect(
      inlinesOf('  a \n\t lot   of <strong>  space  </strong>  here  '),
    ).toEqual([
      { type: 'text', text: 'a lot of ' },
      { type: 'bold', text: 'space' },
      { type: 'text', text: ' here' },
    ])
  })

  it('drops inlines whose text collapses to nothing', () => {
    expect(inlinesOf(' <strong>   </strong> <em></em> ')).toEqual([])
  })
})

describe('htmlToRows (AGL-596)', () => {
  it('maps headings, paragraphs, lists and images to editor rows', () => {
    expect(
      rowsOf(
        '<h2>Title</h2><p>Body text</p>' +
          '<ul><li>one</li><li><strong>two</strong></li></ul>' +
          '<img src="https://cdn.example.com/pic.png" alt="A pic">' +
          '<h4>Sub</h4>',
      ),
    ).toEqual([
      { kind: 'heading2', inlines: [{ type: 'text', text: 'Title' }] },
      { kind: 'paragraph', inlines: [{ type: 'text', text: 'Body text' }] },
      { kind: 'listItem', inlines: [{ type: 'text', text: 'one' }] },
      { kind: 'listItem', inlines: [{ type: 'bold', text: 'two' }] },
      {
        kind: 'image',
        src: 'https://cdn.example.com/pic.png',
        alt: 'A pic',
      },
      { kind: 'heading3', inlines: [{ type: 'text', text: 'Sub' }] },
    ])
  })

  it('maps h1 to heading2 and blockquote/section to paragraphs', () => {
    expect(
      rowsOf('<h1>Top</h1><blockquote>quoted</blockquote><section>s</section>'),
    ).toEqual([
      { kind: 'heading2', inlines: [{ type: 'text', text: 'Top' }] },
      { kind: 'paragraph', inlines: [{ type: 'text', text: 'quoted' }] },
      { kind: 'paragraph', inlines: [{ type: 'text', text: 's' }] },
    ])
  })

  it('recurses wrapper divs so they do not swallow content', () => {
    expect(
      rowsOf('<div><div><p>first</p></div><p>second</p></div>'),
    ).toEqual([
      { kind: 'paragraph', inlines: [{ type: 'text', text: 'first' }] },
      { kind: 'paragraph', inlines: [{ type: 'text', text: 'second' }] },
    ])
  })

  it('groups bare inline content into a single paragraph row', () => {
    expect(rowsOf('Hello <strong>bold</strong> world')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { type: 'text', text: 'Hello ' },
          { type: 'bold', text: 'bold' },
          { type: 'text', text: ' world' },
        ],
      },
    ])
  })

  it('recurses the Google Docs inline <b> wrapper instead of bolding it all', () => {
    expect(
      rowsOf(
        '<b style="font-weight:normal" id="docs-internal-guid-1">' +
          '<p>alpha</p><p><strong>beta</strong></p></b>',
      ),
    ).toEqual([
      { kind: 'paragraph', inlines: [{ type: 'text', text: 'alpha' }] },
      { kind: 'paragraph', inlines: [{ type: 'bold', text: 'beta' }] },
    ])
  })

  it('drops rows with no inlines and images without a src', () => {
    expect(
      rowsOf('<p></p><p>   </p><ul><li>  </li></ul><img alt="no src">'),
    ).toEqual([])
  })

  it('skips script/style blocks and unwraps unknown block wrappers', () => {
    expect(
      rowsOf(
        '<article><p>kept</p></article>' +
          '<style>.x{}</style><script>alert(1)</script>',
      ),
    ).toEqual([
      { kind: 'paragraph', inlines: [{ type: 'text', text: 'kept' }] },
    ])
  })

  it('keeps marks inside list items and paragraphs with raw link hrefs', () => {
    expect(
      rowsOf('<p>See <a href="/pricing">plans</a> for <em>details</em></p>'),
    ).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { type: 'text', text: 'See ' },
          { type: 'link', text: 'plans', href: '/pricing' },
          { type: 'text', text: ' for ' },
          { type: 'italic', text: 'details' },
        ],
      },
    ])
  })
})
