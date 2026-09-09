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

import { escapeHtml } from './escape-html'

/**
 * AGL-2706 merged five copies of this into one. Two of them left `'`
 * unescaped, which is why the apostrophe has a test of its own here rather
 * than riding along in a "escapes the specials" case.
 */
describe('escapeHtml', () => {
  it('escapes the apostrophe, which delimits an attribute like any quote', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('uses &#39; and not &apos;, which HTML 4 does not define', () => {
    expect(escapeHtml("'")).not.toContain('apos')
  })

  it('escapes every character that can break out of markup', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('escapes the ampersand once, not twice', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('closes an attribute break in either quoting style', () => {
    const injected = `x' onerror='alert(1)`
    expect(`<img alt='${escapeHtml(injected)}'>`).not.toMatch(/onerror='/)
  })

  it('coerces rather than throwing, so an absent field renders empty', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(0)).toBe('0')
    expect(escapeHtml(false)).toBe('false')
  })

  it('leaves text with nothing to escape byte-identical', () => {
    expect(escapeHtml('Ada Lovelace')).toBe('Ada Lovelace')
  })
})
