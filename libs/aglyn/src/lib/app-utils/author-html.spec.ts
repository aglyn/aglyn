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
 * AGL-1901. This project's jest environment is `node`, which is the point:
 * every case below runs with no `window`, `document` or DOM of any kind, so
 * a regression that reaches for one fails here rather than in production.
 */

import { INERT_CSS_URL } from './author-css'
import {
  ALLOWED_AUTHOR_HTML_ELEMENTS,
  type AuthorHtmlRemoval,
  decodeCharacterReferences,
  sanitizeAuthorHtml,
} from './author-html'

describe('sanitizeAuthorHtml (AGL-1901)', () => {
  it('runs with no DOM at all', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(sanitizeAuthorHtml('<p>hi</p>')).toBe('<p>hi</p>')
  })

  describe('what an author keeps', () => {
    it('keeps prose structure and inline emphasis', () => {
      expect(
        sanitizeAuthorHtml(
          '<h2>Title</h2><p>a <strong>b</strong> <em>c</em></p><ul><li>d</li></ul>',
        ),
      ).toBe('<h2>Title</h2><p>a <strong>b</strong> <em>c</em></p><ul><li>d</li></ul>')
    })

    it('keeps links, images and tables with their real attributes', () => {
      expect(sanitizeAuthorHtml('<a href="/about" class="x">go</a>')).toBe(
        '<a href="/about" class="x">go</a>',
      )
      expect(
        sanitizeAuthorHtml('<img src="https://cdn.test/a.png" alt="A" width="10">'),
      ).toBe('<img src="https://cdn.test/a.png" alt="A" width="10">')
      // `<tbody>` is emitted because the parser inserts one; see
      // `openImpliedTableParents`.
      expect(
        sanitizeAuthorHtml('<table><tr><td colspan="2">c</td></tr></table>'),
      ).toBe('<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>')
    })

    it('keeps mailto, tel and fragment links', () => {
      for (const href of ['mailto:a@b.test', 'tel:+15550100', '#section', '?q=1']) {
        expect(sanitizeAuthorHtml(`<a href="${href}">x</a>`)).toContain(href)
      }
    })

    it('escapes text rather than dropping it', () => {
      expect(sanitizeAuthorHtml('<p>5 < 6 & 7 > 2</p>')).toBe(
        '<p>5 &lt; 6 &amp; 7 &gt; 2</p>',
      )
    })

    it('unwraps a forbidden or unknown tag but keeps the words (KEEP_CONTENT)', () => {
      expect(sanitizeAuthorHtml('<form action="/steal"><p>words</p></form>')).toBe(
        '<p>words</p>',
      )
      expect(sanitizeAuthorHtml('<blink>still readable</blink>')).toBe(
        'still readable',
      )
    })
  })

  describe('what never survives', () => {
    const vectors: Array<[string, string]> = [
      ['inline script', '<script>alert(1)</script>'],
      ['event handler', '<p onclick="alert(1)">x</p>'],
      ['uppercase handler', '<P ONMOUSEOVER="alert(1)">x</P>'],
      ['unquoted handler', '<img src=x onerror=alert(1)>'],
      ['javascript href', '<a href="javascript:alert(1)">x</a>'],
      ['javascript href, mixed case', '<a href="JaVaScRiPt:alert(1)">x</a>'],
      ['javascript href, leading space', '<a href="  javascript:alert(1)">x</a>'],
      ['javascript href, embedded tab', '<a href="java\tscript:alert(1)">x</a>'],
      ['javascript href, NUL byte', '<a href="java\u0000script:alert(1)">x</a>'],
      ['decimal entity scheme', '<a href="java&#115;cript:alert(1)">x</a>'],
      ['hex entity scheme', '<a href="&#x6a;avascript&#x3a;alert(1)">x</a>'],
      ['entity colon', '<a href="javascript&colon;alert(1)">x</a>'],
      ['entity without semicolon', '<a href="javascript&#58alert(1)">x</a>'],
      ['vbscript href', '<a href="vbscript:msgbox(1)">x</a>'],
      ['iframe', '<iframe src="https://evil.test"></iframe>'],
      ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
      ['object', '<object data="x.swf"></object>'],
      ['embed', '<embed src="x.swf">'],
      ['base', '<base href="https://evil.test/">'],
      ['formaction', '<button formaction="javascript:alert(1)">x</button>'],
      ['svg script', '<svg><script>alert(1)</script></svg>'],
      ['svg onload', '<svg onload="alert(1)"></svg>'],
      ['svg animate', '<svg><animate onbegin="alert(1)" /></svg>'],
      ['math annotation', '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'],
      ['template smuggling', '<template><script>alert(1)</script></template>'],
      ['noscript smuggling', '<noscript><p title="</noscript><script>alert(1)</script>">x</p></noscript>'],
      ['noembed smuggling', '<noembed><script>alert(1)</script></noembed>'],
      ['xmp smuggling', '<xmp><script>alert(1)</script></xmp>'],
      ['comment breakout', '<!--><script>alert(1)</script>-->'],
      ['data uri svg image', '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==">'],
      ['data uri html', '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'],
      ['data attribute', '<p data-x="1">y</p>'],
      ['is= custom element', '<p is="evil-el">y</p>'],
      ['xlink href', '<a xlink:href="javascript:alert(1)">x</a>'],
      ['style expression', '<p style="width:expression(alert(1))">x</p>'],
      ['style behavior', '<p style="behavior:url(#default#time2)">x</p>'],
      ['style moz binding', '<p style="-moz-binding:url(https://evil.test/x.xml)">x</p>'],
      ['style element in rich text', '<style>body{color:red}</style>'],
    ]
    it.each(vectors)('drops %s', (_label, input) => {
      const out = sanitizeAuthorHtml(input)
      expect(out).not.toMatch(/<script/i)
      expect(out).not.toMatch(/<iframe/i)
      expect(out).not.toMatch(/<svg/i)
      expect(out).not.toMatch(/<math/i)
      expect(out).not.toMatch(/\son[a-z]+\s*=/i)
      expect(out).not.toMatch(/javascript\s*:/i)
      expect(out).not.toMatch(/vbscript\s*:/i)
      expect(out).not.toMatch(/srcdoc|formaction|xlink|data-x|\bis=/i)
      expect(out).not.toMatch(/expression\s*\(|behaviou?r\s*:|-moz-binding/i)
      expect(out).not.toMatch(/data:(?:text|image\/svg)/i)
      expect(out).not.toMatch(/alert\(1\)|msgbox\(1\)/i)
    })

    it('keeps a smuggled `<` INSIDE the quoted attribute it arrived in', () => {
      // The reference is decoded so the value can be judged, then re-emitted
      // the way the HTML serializer would: quoted values escape `&`, U+00A0
      // and `"` and nothing else, so the `<` stays literal. That is safe —
      // inside a quoted value the parser has no tag-open state — and it is
      // what makes the string a fixed point, which the round-trip spec pins.
      // The DOM half of this claim — that the emitted string parses to one
      // element and re-serializes byte-identically — is asserted where there
      // IS a DOM, in `author-html-round-trip.spec.tsx`.
      const out = sanitizeAuthorHtml('<a href="/s?q=&#60;script&#62;">x</a>')
      expect(out).toBe('<a href="/s?q=<script>">x</a>')
    })

    it('normalizes the nesting a document parse would have changed', () => {
      // `<p>` is closed by a block start tag, an `<li>` by the next `<li>`,
      // an `<a>` by the next `<a>`. Emitting those implied end tags is what
      // keeps the server string and the hydrated DOM the same shape.
      expect(sanitizeAuthorHtml('<p>a<div>b</div></p>')).toBe(
        '<p>a</p><div>b</div>',
      )
      expect(sanitizeAuthorHtml('<ul><li>a<li>b</ul>')).toBe(
        '<ul><li>a</li><li>b</li></ul>',
      )
      expect(sanitizeAuthorHtml('<a href="/x">a<a href="/y">b</a>')).toBe(
        '<a href="/x">a</a><a href="/y">b</a>',
      )
    })

    it('follows the parser on table context, in both directions', () => {
      // A table part outside a table loses its tag and keeps its words; a
      // non-table element (or stray text) inside a table would be foster
      // parented out, which this cannot express, so it is dropped.
      expect(sanitizeAuthorHtml('<td colspan="2">y</td>')).toBe('y')
      expect(sanitizeAuthorHtml('<table>stray<tr><td>y</td></tr></table>')).toBe(
        '<table><tbody><tr><td>y</td></tr></tbody></table>',
      )
      expect(
        sanitizeAuthorHtml('<table><div>x</div><tr><td>y</td></tr></table>'),
      ).toBe('<table><tbody><tr><td>y</td></tr></tbody></table>')
    })

    it('drops an attribute that is merely NOT on the allowlist', () => {
      // Distinct from the vectors above, which the on*/forbidden checks also
      // catch: these are harmless names, so only the allowlist can drop them.
      // Without this the allowlist could be deleted and the suite stay green.
      const out = sanitizeAuthorHtml(
        '<p contenteditable="true" tabindex="1" xmlns="x" accesskey="k">y</p>',
      )
      expect(out).toBe('<p>y</p>')
    })

    it('drops an attribute an element does not define, even if another does', () => {
      // `colspan` is real on `td` and nowhere else; `href` is real on `a`.
      expect(sanitizeAuthorHtml('<p colspan="2">y</p>')).toBe('<p>y</p>')
      expect(sanitizeAuthorHtml('<p href="/x">y</p>')).toBe('<p>y</p>')
      expect(
        sanitizeAuthorHtml('<table><tr><td colspan="2">y</td></tr></table>'),
      ).toContain('colspan="2"')
    })

    it('leaves a `<` that begins no tag as text, not as a hole', () => {
      expect(sanitizeAuthorHtml('a < b')).toBe('a &lt; b')
      expect(sanitizeAuthorHtml('<3 <p>x</p>')).toBe('&lt;3 <p>x</p>')
    })

    it('ignores a stray end tag instead of unbalancing the output', () => {
      expect(sanitizeAuthorHtml('</p></div><p>x</p>')).toBe('<p>x</p>')
    })

    it('closes what the author left open', () => {
      expect(sanitizeAuthorHtml('<div><p>x')).toBe('<div><p>x</p></div>')
    })

    it('never emits a close tag for a void element', () => {
      const out = sanitizeAuthorHtml('<img src="/a.png">text</img><br></br><hr></hr>')
      expect(out).not.toContain('</img>')
      expect(out).not.toContain('</br>')
      expect(out).not.toContain('</hr>')
      expect(out).toContain('text')
    })
  })

  describe('the AGL-1725 CSS rule, carried into the sanitizer', () => {
    it('rewrites a refused url() in a style ATTRIBUTE', () => {
      const out = sanitizeAuthorHtml('<p style="background:url(http://tracker.test/p.gif)">x</p>')
      expect(out).toContain(INERT_CSS_URL)
      expect(out).not.toContain('tracker.test')
    })

    it('leaves an https url() in a style attribute alone', () => {
      expect(
        sanitizeAuthorHtml('<p style="background:url(https://cdn.test/a.png)">x</p>'),
      ).toContain('https://cdn.test/a.png')
    })

    it('drops a <style> ELEMENT with its body, for both callers', () => {
      // Not a filtering decision — a parity one. Both DOMPurify configs
      // dropped the tag (`custom-html-author-css.spec.tsx` pins it for Custom
      // HTML, `FORBID_TAGS` carried it for rich text), so the `css` component
      // attribute stays the only route to a style block on a page.
      expect(sanitizeAuthorHtml('<style>.a{color:red}</style><p>x</p>')).toBe(
        '<p>x</p>',
      )
      expect(
        sanitizeAuthorHtml('<style>a{}</style ><script>alert(1)</script>'),
      ).not.toMatch(/<script|<style/i)
    })
  })

  describe('purity — the property hydration rests on', () => {
    it('returns identical bytes for identical input', () => {
      const input = '<p style="color:red">a</p><img src="https://cdn.test/a.png">'
      expect(sanitizeAuthorHtml(input)).toBe(sanitizeAuthorHtml(input))
    })

    it('is idempotent: sanitizing its own output changes nothing', () => {
      for (const input of [
        '<p>a <b>b</b></p>',
        '<a href="javascript:alert(1)">x</a>',
        '<p style="background:url(http://t.test/p.gif)">x</p>',
        '<div><img src="https://cdn.test/a.png" alt="&amp;">t',
      ]) {
        const once = sanitizeAuthorHtml(input)
        expect(sanitizeAuthorHtml(once)).toBe(once)
      }
    })

    it('handles empty and absent input without throwing', () => {
      expect(sanitizeAuthorHtml('')).toBe('')
      expect(sanitizeAuthorHtml(undefined as unknown as string)).toBe('')
    })
  })

  describe('decodeCharacterReferences', () => {
    it('decodes the numeric forms a scheme can be smuggled in', () => {
      expect(decodeCharacterReferences('java&#115;cript')).toBe('javascript')
      expect(decodeCharacterReferences('&#x6a;ava&#X73;cript')).toBe('javascript')
      expect(decodeCharacterReferences('a&colon;b')).toBe('a:b')
      expect(decodeCharacterReferences('a&Tab;b')).toBe('a\tb')
    })

    it('leaves a reference it does not know verbatim', () => {
      // Safe because HTML has no named reference for an ASCII letter, so an
      // unknown one cannot help spell a scheme.
      expect(decodeCharacterReferences('a&frac12;b')).toBe('a&frac12;b')
    })

    it('drops a reference with no scalar value rather than inventing one', () => {
      expect(decodeCharacterReferences('a&#xD800;b')).toBe('ab')
      expect(decodeCharacterReferences('a&#0;b')).toBe('ab')
    })
  })
})

/**
 * The author-facing half (AGL-2486).
 *
 * The runtime sanitizes for a VISITOR and can only drop what it refuses in
 * silence, so the editor has to be able to say what will be lost. These pin
 * the two properties that make that safe: the collector never changes the
 * OUTPUT, and it reports from the sanitizer's own decision points rather
 * than from a second set of rules that could drift.
 */
describe('removal reporting (AGL-2486)', () => {
  const removalsFor = (html: string) => {
    const removals: AuthorHtmlRemoval[] = []
    sanitizeAuthorHtml(html, removals)
    return removals
  }

  it.each([
    ['<script>alert(1)</script><p>hi</p>', 'element', '<script>'],
    ['<form><input name="p"></form>', 'element', '<form>'],
    ['<p onclick="alert(1)">hi</p>', 'attribute', 'onclick'],
    ['<p style="@import url(https://e.example/x.css)">hi</p>', 'style', 'style attribute'],
    ['<p style="background:url(http://e.example/x.png)">hi</p>', 'url', 'url()'],
    ['<a href="javascript:alert(1)">hi</a>', 'url', 'href'],
  ])('reports %s as a %s removal', (html, kind, needle) => {
    const removals = removalsFor(html)
    expect(removals.length).toBeGreaterThan(0)
    expect(removals.some((entry) => entry.kind === kind)).toBe(true)
    expect(removals.map((entry) => entry.message).join(' ')).toContain(needle)
  })

  it('reports nothing for markup that survives whole', () => {
    expect(
      removalsFor('<p style="color:#333"><strong>hi</strong> <a href="https://x.example">l</a></p>'),
    ).toEqual([])
  })

  it('dedupes a repeated refusal so the author reads it once', () => {
    const removals = removalsFor('<script>a</script><script>b</script><script>c</script>')
    expect(removals).toHaveLength(1)
  })

  /**
   * The property the render path depends on. Every existing caller
   * (`typography.tsx`, `custom-html.tsx`, `site-runtime.tsx`) calls the
   * one-argument form; if collecting could perturb the output, passing an
   * array would become a hydration mismatch waiting to happen.
   */
  it('emits byte-identical output whether or not removals are collected', () => {
    for (const html of [
      '<p style="color:#333">hi</p>',
      '<script>alert(1)</script><p>hi</p>',
      '<form><input name="p"></form><p onclick="x()">t</p>',
      '<p style="background:url(http://e.example/x.png)">hi</p>',
      '<table><tr><td>a</td></tr></table>',
      '<a href="javascript:alert(1)">hi</a><img srcset="http://e.example/a.png 1x">',
    ]) {
      expect(sanitizeAuthorHtml(html, [])).toBe(sanitizeAuthorHtml(html))
    }
  })
})

/**
 * `main` IS A DELIBERATE SUBTRACTION FROM THE PROFILE (AGL-2486).
 *
 * The tenant root layout renders the document's single `main` landmark, so
 * author markup carrying another can only make the landmark ambiguous — a
 * worse accessibility outcome than the missing one it replaced, because
 * assistive tech gets a choice to make where it previously had a gap to
 * report.
 *
 * It is the SUBSET argument working as intended rather than an exception to
 * it: keeping less than DOMPurify can only cost an author some markup, and
 * here it costs them a tag whose children survive verbatim.
 *
 * ⛔ Restoring it to `ALLOWED_AUTHOR_HTML_ELEMENTS` puts a second landmark
 * back within reach of any Custom HTML block or rich-text body.
 */
describe('author markup cannot mint a second `main` landmark (AGL-2486)', () => {
  it('is not in the allowlist', () => {
    expect(ALLOWED_AUTHOR_HTML_ELEMENTS.has('main')).toBe(false)
    // CONTROL — the sibling landmarks are untouched, so this is a targeted
    // subtraction and not a general narrowing of the profile.
    for (const element of ['section', 'article', 'aside', 'nav', 'header', 'footer']) {
      expect(ALLOWED_AUTHOR_HTML_ELEMENTS.has(element)).toBe(true)
    }
  })

  it('UNWRAPS it, keeping the content the author wrote', () => {
    // Dropping the subtree would be content loss for a landmark decision, so
    // the distinction is asserted rather than assumed: the tag goes, the words
    // stay, and the sibling landmark beside it is untouched.
    const out = sanitizeAuthorHtml('<main><p>kept</p></main><nav><p>also</p></nav>')
    expect(out).not.toContain('<main')
    expect(out).toContain('<p>kept</p>')
    expect(out).toContain('<nav>')
    expect(out).toContain('<p>also</p>')
  })
})
