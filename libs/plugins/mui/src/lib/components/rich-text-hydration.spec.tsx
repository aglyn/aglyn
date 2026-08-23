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
 * AGL-1901, the other half of the acceptance: putting the content back into
 * the server response must not buy the SEO fix with a hydration mismatch —
 * exactly the trade AGL-1268 refused to make in the other direction, and
 * tenant already carries a live React #418 (AGL-1926) that a new one would
 * disappear into.
 *
 * The test hydrates the REAL server string. React reports a mismatch through
 * `console.error`, so the assertion is on what React said, not on what the
 * DOM ended up looking like — a mismatch is recoverable, and the recovered
 * DOM looks correct, which is why reading the DOM would prove nothing.
 *
 * Also asserts the parity that makes hydration safe in the first place: the
 * DOMPurify allowlist the client used to enforce is still the ceiling. Every
 * tag and attribute the new isomorphic sanitizer emits is one DOMPurify
 * would also have kept under the config it replaced.
 */

import {
  ALLOWED_AUTHOR_HTML_ELEMENTS,
  AUTHOR_HTML_ELEMENT_ATTRIBUTES,
  GLOBAL_AUTHOR_HTML_ATTRIBUTES,
  sanitizeAuthorHtml,
} from '@aglyn/aglyn'
import DOMPurify from 'dompurify'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import CustomHtml, { sanitizeCustomHtml } from './custom-html'
import AglynTypography from './typography'

/** The exact DOMPurify config `typography.tsx` carried before AGL-1901. */
function referenceTypographyPurify(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'style'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: false,
  })
}

/** The exact DOMPurify config `custom-html.tsx` carried before AGL-1901. */
function referenceCustomHtmlPurify(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: false,
  })
}

/**
 * The exact DOMPurify config `site-runtime.tsx`'s `showHtml` step carried
 * before AGL-2486 — the third caller, and the LOOSEST of the three.
 *
 * Two differences from the two above, both of which the shared sanitizer
 * closed: `form` is missing from `FORBID_TAGS`, and (like every DOMPurify
 * config) it filters no CSS at all.
 */
function referenceShowHtmlPurify(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: false,
  })
}

/** Tag names and `tag@attribute` pairs present in a markup string. */
function shapeOf(markup: string): Set<string> {
  const host = document.createElement('div')
  host.innerHTML = markup
  const shape = new Set<string>()
  for (const element of Array.from(host.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase()
    shape.add(tag)
    for (const attribute of Array.from(element.attributes)) {
      shape.add(`${tag}@${attribute.name.toLowerCase()}`)
    }
  }
  return shape
}

/**
 * The corpus both halves of this file run over: real author markup first,
 * then the shapes an attacker would plant through the Firebase client SDK.
 */
const CORPUS = [
  '<p>Plain body copy.</p>',
  '<h2>Heading</h2><p>a <strong>b</strong> <em>c</em> <code>d</code></p>',
  '<ul><li>one</li><li>two</li></ul><ol start="3"><li>three</li></ol>',
  '<blockquote cite="https://x.test">quoted</blockquote>',
  '<a href="https://x.test" target="_blank" rel="noopener">link</a>',
  '<a href="/relative?q=1#frag">relative</a>',
  '<a href="mailto:a@b.test">mail</a>',
  '<img src="https://cdn.test/a.png" alt="A" width="10" height="10">',
  '<table><thead><tr><th scope="col">h</th></tr></thead><tbody><tr><td colspan="2">c</td></tr></tbody></table>',
  '<p style="color:red;background:url(https://cdn.test/a.png)">styled</p>',
  '<p class="lead" id="x" title="t" lang="en" dir="ltr">attrs</p>',
  '<pre><code>const a = 1 &lt; 2</code></pre>',
  '<figure><img src="/a.png" alt=""><figcaption>cap</figcaption></figure>',
  '<script>alert(1)</script><p>after</p>',
  '<p onclick="alert(1)">handler</p>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">js</a>',
  '<a href="java&#115;cript:alert(1)">entity js</a>',
  '<iframe src="https://evil.test"></iframe>',
  '<form action="/steal"><input name="card"></form>',
  '<svg><script>alert(1)</script></svg>',
  '<math><mtext><script>alert(1)</script></mtext></math>',
  '<base href="https://evil.test/">',
  '<p data-secret="1">data attr</p>',
  '<div><p>unclosed',
  '<p>5 < 6 &amp; 7</p>',
]

describe('rich text hydration and allowlist parity (AGL-1901)', () => {
  let errors: unknown[][]
  let spy: jest.SpyInstance

  beforeEach(() => {
    errors = []
    spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args)
      })
  })
  afterEach(() => spy.mockRestore())

  /** React's mismatch reports, by the words and codes it uses for them. */
  function hydrationComplaints(): string[] {
    return errors
      .map((entry) => entry.map((part) => String(part)).join(' '))
      .filter((text) =>
        /hydrat|did not match|server (?:rendered )?HTML|#418|#423|#425|removeChild|insertBefore/i.test(
          text,
        ),
      )
  }

  async function hydrate(element: React.ReactElement): Promise<HTMLElement> {
    const markup = renderToString(element)
    const container = document.createElement('div')
    container.innerHTML = markup
    // Emotion emits its `<style data-emotion>` INLINE during a server render
    // and inserts through CSSOM on the client, so the two sides legitimately
    // disagree about those elements; production hoists them to <head> with
    // `createEmotionServer`, and this does the same. Without it every case
    // here reports a mismatch that belongs to the harness, and the file would
    // be measuring emotion instead of AGL-1901. The negative control below
    // fails if this ever stops being true.
    for (const style of Array.from(
      container.querySelectorAll('style[data-emotion]'),
    )) {
      document.head.appendChild(style)
    }
    document.body.appendChild(container)
    await act(async () => {
      hydrateRoot(container, element)
    })
    return container
  }

  it('the harness itself reports no mismatch on a node with no rich text', async () => {
    // The negative control. Everything below asserts an EMPTY complaint list,
    // so this file is worthless if the harness cannot produce one — and worse
    // than worthless if the harness produces one of its own.
    await hydrate(<AglynTypography>plain children</AglynTypography>)
    expect(hydrationComplaints()).toEqual([])
  })

  it('the harness DOES catch a mismatch when there is one', async () => {
    // Make every check above falsifiable: hand hydration a server string that
    // genuinely differs from what the client renders, and confirm React
    // complains and this file hears it.
    const container = document.createElement('div')
    container.innerHTML = renderToString(
      <AglynTypography html="<p>server text</p>" />,
    )
    for (const style of Array.from(
      container.querySelectorAll('style[data-emotion]'),
    )) {
      document.head.appendChild(style)
    }
    document.body.appendChild(container)
    await act(async () => {
      hydrateRoot(container, <AglynTypography html="<p>client text</p>" />)
    })
    expect(hydrationComplaints().length).toBeGreaterThan(0)
  })

  it('hydrates rich text with no mismatch, and the content was already there', async () => {
    const html = '<h2>Refunds</h2><p>Within <strong>30 days</strong>.</p>'
    const server = renderToString(<AglynTypography html={html} />)
    // The server string carries the content BEFORE any client code runs.
    expect(server).toContain('Within <strong>30 days</strong>')
    const container = await hydrate(<AglynTypography html={html} />)
    expect(hydrationComplaints()).toEqual([])
    expect(container.textContent).toContain('Within 30 days')
  })

  it('hydrates a Custom HTML block with no mismatch', async () => {
    const html = '<div><h3>Hours</h3><p style="color:red">9-5</p></div>'
    const server = renderToString(<CustomHtml html={html} />)
    expect(server).toContain('Hours')
    const container = await hydrate(<CustomHtml html={html} />)
    expect(hydrationComplaints()).toEqual([])
    expect(container.textContent).toContain('9-5')
  })

  it('hydrates every corpus entry without a mismatch', async () => {
    for (const html of CORPUS) {
      errors = []
      await hydrate(<AglynTypography html={html} />)
      expect({ html, complaints: hydrationComplaints() }).toEqual({
        html,
        complaints: [],
      })
    }
  })

  describe('allowlist parity with the DOMPurify config it replaced', () => {
    it.each(CORPUS)(
      'rich text emits no tag or attribute DOMPurify would have dropped: %s',
      (html) => {
        // Compared on the SANITIZER's output, not the rendered markup: the
        // Typography wrapper element is ours, not the author's, and it is the
        // author's markup whose ceiling is being pinned.
        const ours = shapeOf(sanitizeAuthorHtml(html))
        const reference = shapeOf(referenceTypographyPurify(html))
        const extra = [...ours].filter((entry) => !reference.has(entry))
        expect(extra).toEqual([])
      },
    )

    it.each(CORPUS)(
      'Custom HTML emits nothing its DOMPurify config would have dropped: %s',
      (html) => {
        const ours = shapeOf(sanitizeCustomHtml(html))
        const reference = shapeOf(referenceCustomHtmlPurify(html))
        const extra = [...ours].filter((entry) => !reference.has(entry))
        expect(extra).toEqual([])
      },
    )

    /**
     * The corpus above only pins the shapes someone thought to write down.
     * This pins the TABLE — every element and every attribute the sanitizer
     * is willing to emit is put in front of DOMPurify, so an entry added to
     * the allowlist later cannot quietly be one DOMPurify would have dropped.
     * Table parts are wrapped in a table because the parser drops them
     * elsewhere, for both sides equally.
     */
    const contextFor = (tag: string): [string, string] => {
      if (tag === 'td' || tag === 'th') return ['<table><tr>', '</tr></table>']
      if (tag === 'tr') return ['<table>', '</table>']
      if (['thead', 'tbody', 'tfoot', 'caption', 'colgroup'].includes(tag)) {
        return ['<table>', '</table>']
      }
      if (tag === 'col') return ['<table><colgroup>', '</colgroup></table>']
      return ['', '']
    }
    const SAMPLE_VALUES: Record<string, string> = {
      href: 'https://x.test/a', src: 'https://x.test/a.png',
      cite: 'https://x.test', poster: 'https://x.test/p.png',
      srcset: 'https://x.test/a.png 1x', style: 'color:red',
      datetime: '2020-01-01', width: '10', height: '10', colspan: '2',
      rowspan: '2', span: '2', start: '2', value: '2', loading: 'lazy',
      decoding: 'async', scope: 'col', kind: 'captions', type: 'text/plain',
    }
    const everyAllowedPair: Array<[string, string]> = []
    for (const tag of ALLOWED_AUTHOR_HTML_ELEMENTS) {
      for (const attribute of [
        ...GLOBAL_AUTHOR_HTML_ATTRIBUTES,
        ...(AUTHOR_HTML_ELEMENT_ATTRIBUTES[tag] ?? []),
      ]) {
        everyAllowedPair.push([tag, attribute])
      }
    }

    it.each(everyAllowedPair)(
      'DOMPurify would also have kept %s@%s',
      (tag, attribute) => {
        const [before, after] = contextFor(tag)
        const value = SAMPLE_VALUES[attribute] ?? 'x'
        const input = `${before}<${tag} ${attribute}="${value}">y</${tag}>${after}`
        const ours = shapeOf(sanitizeAuthorHtml(input))
        // Nothing to compare if our own context rules dropped the sample —
        // that direction is safe by definition.
        if (!ours.has(`${tag}@${attribute}`)) return
        expect(shapeOf(referenceCustomHtmlPurify(input))).toContain(
          `${tag}@${attribute}`,
        )
      },
    )

    it('the allowlist pin is not vacuous', () => {
      // Every pair above returns early when our sanitizer drops the sample,
      // so assert the samples actually survive — otherwise the whole table
      // could pass by producing nothing.
      const survived = everyAllowedPair.filter(([tag, attribute]) => {
        const [before, after] = contextFor(tag)
        const value = SAMPLE_VALUES[attribute] ?? 'x'
        const input = `${before}<${tag} ${attribute}="${value}">y</${tag}>${after}`
        return shapeOf(sanitizeAuthorHtml(input)).has(`${tag}@${attribute}`)
      })
      expect(survived.length).toBeGreaterThan(everyAllowedPair.length * 0.9)
    })

    it.each(CORPUS)(
      'showHtml emits nothing its DOMPurify config would have dropped: %s',
      (html) => {
        // AGL-2486 pointed `showHtml` at this sanitizer too, so the subset
        // claim in its call site is measured here for that config as well —
        // not only for the two AGL-1901 moved.
        const ours = shapeOf(sanitizeAuthorHtml(html))
        const reference = shapeOf(referenceShowHtmlPurify(html))
        const extra = [...ours].filter((entry) => !reference.has(entry))
        expect(extra).toEqual([])
      },
    )

    it('closes the form gap the showHtml config alone carried (AGL-2486)', () => {
      // Both halves, so the test cannot pass by the reference also refusing:
      // this config KEPT a password field, which is what made two sanitizers
      // on one surface a security defect rather than an inconsistency.
      const html = '<form action="https://e.test"><input name="p" type="password"></form>'
      expect(referenceShowHtmlPurify(html)).toContain('type="password"')
      expect(sanitizeAuthorHtml(html)).not.toContain('password')
      expect(sanitizeAuthorHtml(html)).not.toContain('<form')
    })

    it('keeps the AGL-1725 style-attribute rule DOMPurify never applied', () => {
      // The one place the new sanitizer must NOT match DOMPurify: DOMPurify
      // performs no CSS filtering, so the hook AGL-1725 added is a place the
      // reference is deliberately weaker. Assert both halves — the reference
      // letting it through is what makes this test meaningful.
      const html = '<p style="background:url(http://tracker.test/p.gif)">x</p>'
      expect(referenceTypographyPurify(html)).toContain('tracker.test')
      expect(sanitizeCustomHtml(html)).not.toContain('tracker.test')
      expect(renderToString(<AglynTypography html={html} />)).not.toContain(
        'tracker.test',
      )
    })
  })
})
