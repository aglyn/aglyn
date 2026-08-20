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
 * The invariant AGL-1901's hydration safety actually rests on: what
 * `sanitizeAuthorHtml` emits is a FIXED POINT of the HTML parser.
 *
 * Parse the emitted string, serialize the result, and get the same bytes
 * back. That is a stronger and much cheaper statement than "hydration was
 * clean on the cases someone wrote down":
 *
 * - React compares a hydrated container's `innerHTML` against the `__html`
 *   it was given, so a fixed point cannot mismatch and a non-fixed-point
 *   eventually will;
 * - it is also the soundness argument for a sanitizer that works on SOURCE
 *   rather than on a DOM. If the string re-parses to exactly the tree it
 *   describes, then the tags and attributes the allowlist judged are the
 *   tags and attributes the browser will hold — which is precisely what
 *   mXSS defeats.
 *
 * A DOM is needed to state it, which is why this lives in a jsdom project
 * rather than next to the sanitizer.
 */

import { sanitizeAuthorHtml } from '@aglyn/aglyn'
import { renderToString } from 'react-dom/server'
import CustomHtml from './custom-html'
import AglynTypography from './typography'

/** Parses `markup` as document content and returns how the DOM serializes it. */
function reparse(markup: string): string {
  const host = document.createElement('div')
  host.innerHTML = markup
  return host.innerHTML
}

const INPUTS = [
  '<p>plain</p>',
  '<h2>H</h2><p>body <strong>bold</strong> <em>it</em></p>',
  // The nesting the DOCUMENT parser rewrites — the case that produced the
  // hydration mismatch this change had to solve rather than ship.
  '<p>a<div>b</div></p>',
  '<p>one<p>two<p>three',
  '<ul><li>a<li>b</ul>',
  '<dl><dt>t<dd>d<dt>t2</dl>',
  '<a href="/x">a<a href="/y">b</a>',
  '<div><p>unclosed',
  '<table><tr><td>c1<td>c2<tr><td>c3</table>',
  '<table>stray text<tr><td>c</td></tr></table>',
  '<table><div>block</div><tr><td>c</td></tr></table>',
  '<td>orphan cell</td>',
  '<blockquote cite="https://x.test"><p>q</p></blockquote>',
  '<img src="https://cdn.test/a.png" alt="A &amp; B">caption</img>',
  '<br></br><hr></hr><wbr>',
  '<p>5 &lt; 6 &amp;&amp; 7 &gt; 2</p>',
  '<p>non breaking space</p>',
  '<p title=\'single quoted\' class=unquoted>x</p>',
  '<p CLASS="UPPER" ID="Mixed">x</p>',
  '<a href="/s?a=1&b=2&amp;c=3">query</a>',
  '<a href="/s?q=&#60;script&#62;">smuggled angle brackets</a>',
  '<p style="color:red;background:url(https://cdn.test/a.png)">styled</p>',
  '<p style="background:url(http://tracker.test/p.gif)">refused url</p>',
  '<details open><summary>s</summary><p>d</p></details>',
  '<figure><img src="/a.png" alt=""><figcaption>cap</figcaption></figure>',
  '<pre><code>if (a &lt; b) {}</code></pre>',
  // The parser eats ONE newline right after `<pre>`; the serializer only puts
  // one back when the text still starts with one.
  '<pre>\nfirst line\nsecond</pre>',
  '<pre>\n\ntwo newlines</pre>',
  '<pre>no newline</pre>',
  // Table structure the parser INSERTS rather than removes.
  '<table><tr><td>c</td></tr></table>',
  '<table><td>no row</td></table>',
  '<table><thead><tr><th>h</th></tr></thead></table>',
  '<table><caption>c</caption><tr><td>x</td></tr></table>',
  '<table><colgroup><col span="2"></colgroup><tr><td>x</td></tr></table>',
  '<col span="2">',
  '<caption>orphan</caption>',
  '<h2>a<h2>b</h2></h2>',
  '<h3>a<h2>b',
  '<script>alert(1)</script><p>after</p>',
  '<svg><script>alert(1)</script></svg><p>after</p>',
  '<math><mtext><script>alert(1)</script></mtext></math><p>after</p>',
  '<template><p>t</p></template><p>after</p>',
  '<noscript><p>n</p></noscript><p>after</p>',
  '<!-- comment --><p>after</p>',
  '<!DOCTYPE html><p>after</p>',
  '<form action="/steal"><p>kept words</p></form>',
  '<p onclick="alert(1)">handler</p>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">js</a>',
  '<a href="java&#115;cript:alert(1)">entity js</a>',
  '<p>trailing <',
  '<>< ><p>x</p>',
  '<p></p></div></p>',
  '<strong><em>crossed</strong></em>',
  '',
]

/**
 * Randomized inputs over the same alphabet. The list above only covers what
 * someone thought of; a stored `html` prop is whatever a host editor wrote.
 */
function fuzzInputs(count: number): string[] {
  const pieces = [
    '<p>', '</p>', '<div>', '</div>', '<h2>', '</h2>', '<ul>', '</ul>',
    '<li>', '</li>', '<table>', '</table>', '<tr>', '</tr>', '<td>', '</td>',
    '<a href="/x">', '</a>', '<img src="/a.png">', '<br>', '<span>', '</span>',
    '<strong>', '</strong>', '<script>', '</script>', '<svg>', '</svg>',
    '<style>a{}</style>', '<!-- c -->', 'text', ' ', '&amp;', '&#60;', '<',
    '>', '"', "'", ' ', '<p style="color:red">', '<form>', '</form>',
    '<dl>', '<dt>', '<dd>', '</dl>', '<pre>', '</pre>', '<td colspan="2">',
  ]
  // Deterministic PRNG: a fuzz that cannot be replayed is not a test.
  let seed = 0x9e3779b9
  const next = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return Math.abs(seed)
  }
  return Array.from({ length: count }, () => {
    const length = 1 + (next() % 12)
    let out = ''
    for (let i = 0; i < length; i += 1) out += pieces[next() % pieces.length]
    return out
  })
}

describe('sanitizeAuthorHtml is a fixed point of the parser (AGL-1901)', () => {
  it.each(INPUTS)('round-trips: %s', (input) => {
    const sanitized = sanitizeAuthorHtml(input)
    expect(reparse(sanitized)).toBe(sanitized)
  })

  it('round-trips 400 randomized inputs', () => {
    const failures: Array<{ input: string; sanitized: string; parsed: string }> = []
    for (const input of fuzzInputs(400)) {
      const sanitized = sanitizeAuthorHtml(input)
      const parsed = reparse(sanitized)
      if (parsed !== sanitized) failures.push({ input, sanitized, parsed })
    }
    expect(failures).toEqual([])
  })

  it('the fixed-point check is falsifiable', () => {
    // Markup the parser DOES rewrite, to prove `reparse` can disagree at all.
    expect(reparse('<p>a<div>b</div></p>')).not.toBe('<p>a<div>b</div></p>')
    expect(reparse('<img src="/a.png"></img>')).not.toBe(
      '<img src="/a.png"></img>',
    )
  })

  it.each([
    [undefined, 'P'],
    ['body1', 'P'],
    ['body2', 'P'],
    ['inherit', 'P'],
    ['h1', 'H1'],
    ['h2', 'H2'],
    ['h6', 'H6'],
    ['subtitle1', 'H6'],
    ['subtitle2', 'H6'],
    ['caption', 'SPAN'],
    ['overline', 'SPAN'],
  ] as Array<[string | undefined, string]>)(
    'MUI still renders %s as <%s>, which the container rule assumes',
    (variant, element) => {
      // `VARIANT_ELEMENT` in typography.tsx is a copy of MUI's own
      // `defaultVariantMapping`, which MUI does not export. If a MUI upgrade
      // changes it, the container rule would start guessing wrong and the
      // reparenting hazard would reopen silently — so pin it against what MUI
      // ACTUALLY renders, not against the copy.
      const host = document.createElement('div')
      host.innerHTML = renderToString(
        <AglynTypography variant={variant as never}>x</AglynTypography>,
      )
      const rendered = host.querySelector('[class*="MuiTypography-root"]')
      expect(rendered?.tagName).toBe(element)
    },
  )

  it('falls back to a div only when the container would break', () => {
    const tagOf = (markup: string): string | undefined => {
      const host = document.createElement('div')
      host.innerHTML = markup
      return host.querySelector('[class*="MuiTypography-root"]')?.tagName
    }
    // Inline-only body: MUI's own element is kept, outline unchanged.
    expect(
      tagOf(renderToString(<AglynTypography html="<strong>a</strong>" />)),
    ).toBe('P')
    expect(
      tagOf(
        renderToString(<AglynTypography html="<em>a</em>" variant="h2" />),
      ),
    ).toBe('H2')
    // Block body: the container has to give way.
    expect(tagOf(renderToString(<AglynTypography html="<h2>a</h2>" />))).toBe(
      'DIV',
    )
    expect(
      tagOf(
        renderToString(<AglynTypography html="<h3>a</h3>" variant="h2" />),
      ),
    ).toBe('DIV')
    // An explicit `component` is honoured when it is safe, overridden when
    // the author's own markup would tear it open.
    expect(
      tagOf(
        renderToString(
          <AglynTypography html="<em>a</em>" component="span" />,
        ),
      ),
    ).toBe('SPAN')
    expect(
      tagOf(
        renderToString(<AglynTypography html="<div>a</div>" component="p" />),
      ),
    ).toBe('DIV')
  })

  it('the RENDERED node is a fixed point too, container and all', () => {
    // The end-to-end statement: not just the sanitizer's string, but the
    // whole server response for the node. The container element is part of
    // this — a `<p>` wrapper around block content is exactly what the parser
    // would have rewritten (see `blockSafeComponent`).
    const bodies = [
      '<p>plain body</p>',
      '<h2>H</h2><p>body</p>',
      '<div><p>nested</p></div>',
      '<ul><li>a</li></ul>',
      '<table><tr><td>c</td></tr></table>',
      'just text',
      '<strong>inline only</strong>',
    ]
    for (const body of bodies) {
      for (const variant of [undefined, 'body1', 'h2', 'caption'] as const) {
        const markup = renderToString(
          <AglynTypography html={body} variant={variant} />,
        )
        expect({ body, variant, markup: reparse(markup) }).toEqual({
          body,
          variant,
          markup,
        })
      }
      const custom = renderToString(<CustomHtml html={body} />)
      expect({ body, markup: reparse(custom) }).toEqual({ body, markup: custom })
    }
  })
})
