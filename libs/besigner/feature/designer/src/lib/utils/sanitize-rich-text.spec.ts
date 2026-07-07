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
    expect(sanitizeRichText('<span style="color:red">hi</span>')).toBe(
      '<span>hi</span>',
    )
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
