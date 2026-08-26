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

import { richTextToPlain, sanitizeRichText } from './sanitize-rich-text'

describe('sanitizeRichText', () => {
  it('keeps basic formatting tags', () => {
    expect(sanitizeRichText('<b>bold</b> and <i>italic</i>')).toBe(
      '<b>bold</b> and <i>italic</i>',
    )
    expect(sanitizeRichText('<ul><li>one</li><li>two</li></ul>')).toBe(
      '<ul><li>one</li><li>two</li></ul>',
    )
  })

  it('strips scripts, event handlers, and styles', () => {
    expect(sanitizeRichText('<script>alert(1)</script>hi')).toBe('alert(1)hi')
    expect(sanitizeRichText('<b onclick="x()">hi</b>')).toBe('<b>hi</b>')
    // The `style` is gone, and since AGL-2486 so is the now-inert wrapper:
    // a span that can carry nothing is unwrapped rather than kept. The
    // security property is unchanged — what mattered was losing the
    // attribute — and the node no longer reads as "formatted" over markup
    // that renders exactly as its own text.
    expect(sanitizeRichText('<span style="color:red">hi</span>')).toBe('hi')
    expect(sanitizeRichText('<img src="x" onerror="x()">text')).toBe('text')
  })

  it('unwraps disallowed elements but keeps their text', () => {
    expect(sanitizeRichText('<table><tr><td>cell</td></tr></table>')).toBe(
      'cell',
    )
  })

  it('only keeps safe link hrefs and forces rel', () => {
    expect(sanitizeRichText('<a href="https://a.com">x</a>')).toBe(
      '<a href="https://a.com" rel="noopener noreferrer">x</a>',
    )
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('x')
  })

  it('escapes text content', () => {
    expect(sanitizeRichText('a < b & c')).toBe('a &lt; b &amp; c')
  })
})

describe('richTextToPlain', () => {
  it('projects markup to plain text', () => {
    expect(richTextToPlain('<b>bold</b> and <i>italic</i>')).toBe(
      'bold and italic',
    )
  })
})

/**
 * AGL-2486 — the break the Attributes panel could not see.
 *
 * I also still do not see the line break in the text field in the
 * attributes panel. Measured on `yFjgqiG2wm`, node `C3rodYc1Gd` stores
 * `html: "Your entire web <div>presence. </div>"` beside
 * `children: "Your entire web presence. "`. The canvas renders `html` and
 * shows two lines; the panel renders `children` and showed one. The two
 * disagreed because this projection was `textContent`, which concatenates
 * across every element boundary — the `<div>` a contentEditable forks on
 * Enter, and a `<br>`, both vanish into nothing.
 *
 * `children` is what every plain renderer, the SSR fallback and the panel
 * field read, so the break was lost to all three, not just the display.
 */
describe('richTextToPlain keeps the author’s line breaks (AGL-2486)', () => {
  it('keeps the break a contentEditable forks into a div', () => {
    // The exact stored markup from yFjgqiG2wm / C3rodYc1Gd.
    expect(richTextToPlain('Your entire web <div>presence. </div>')).toBe(
      'Your entire web \npresence. ',
    )
  })

  it('keeps an explicit br', () => {
    expect(richTextToPlain('one<br>two')).toBe('one\ntwo')
  })

  it('separates consecutive blocks with exactly one newline', () => {
    expect(richTextToPlain('<div>one</div><div>two</div>')).toBe('one\ntwo')
  })

  it('does not open the string with an empty line', () => {
    expect(richTextToPlain('<p>only</p>')).toBe('only')
  })

  it('keeps list items on their own lines', () => {
    expect(richTextToPlain('<ul><li>one</li><li>two</li></ul>')).toBe(
      'one\ntwo',
    )
  })

  it('leaves inline formatting joined, because it does not break a line', () => {
    expect(richTextToPlain('a <strong>bold</strong> word')).toBe(
      'a bold word',
    )
  })

  it('is unchanged for markup that never breaks', () => {
    expect(richTextToPlain('plain text')).toBe('plain text')
  })
})

/**
 * AGL-2486 — markup that cannot render anything must not survive.
 *
 * `html` is what marks a node as formatted, and a formatted node hands its
 * text to the canvas and shows the Attributes field read-only. An inert
 * wrapper left behind by a contentEditable merge would pin it that way over
 * markup that does nothing. Measured on test-org: deleting the line break
 * out of `About <div>us</div>` left Chrome with `About<span>us</span>`.
 */
describe('sanitizeRichText drops inert wrappers (AGL-2486)', () => {
  it('unwraps a bare span, which can carry nothing once attributes are stripped', () => {
    expect(sanitizeRichText('About<span>us</span>')).toBe('Aboutus')
  })

  it('leaves no markup at all when the span was the only tag', () => {
    const out = sanitizeRichText('<span>just words</span>')
    expect(out).toBe('just words')
    expect(/<[a-z]/i.test(out)).toBe(false)
  })

  it('keeps the formatting inside it', () => {
    expect(sanitizeRichText('<span>a <b>bold</b> word</span>')).toBe(
      'a <b>bold</b> word',
    )
  })

  it('still keeps tags that actually render', () => {
    expect(sanitizeRichText('one<br>two')).toBe('one<br>two')
    expect(sanitizeRichText('a <div>b</div>')).toBe('a <div>b</div>')
  })
})
