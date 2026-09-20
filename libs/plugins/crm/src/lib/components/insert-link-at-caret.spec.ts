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
 * A link a widget hands the composer lands at the caret, spaced so a mail
 * client reads it as a link and not as the end of the word before it.
 */

import { insertLinkAtCaret } from './insert-link-at-caret'

describe('insertLinkAtCaret', () => {
  const link = 'https://acme.aglyn.app/?service=s'

  it('drops the link at the caret with a space on each side where the text runs into it', () => {
    const out = insertLinkAtCaret('Book here please', link, 9, 9)
    expect(out.text).toBe(`Book here ${link} please`)
    expect(out.caret).toBe(`Book here ${link}`.length)
  })

  it('adds no space beside whitespace, a line end, or an edge of the draft', () => {
    expect(insertLinkAtCaret('', link, 0, 0).text).toBe(link)
    expect(insertLinkAtCaret('Hello\n', link, 6, 6).text).toBe(`Hello\n${link}`)
    expect(insertLinkAtCaret('Hi ', link, 3, 3).text).toBe(`Hi ${link}`)
    expect(insertLinkAtCaret('a\nb', link, 1, 1).text).toBe(`a ${link}\nb`)
  })

  it('replaces the selection and clamps a caret past the end', () => {
    expect(insertLinkAtCaret('Book HERE now', link, 5, 9).text).toBe(`Book ${link} now`)
    const out = insertLinkAtCaret('Hi', link, 50, 50)
    expect(out.text).toBe(`Hi ${link}`)
    expect(out.caret).toBe(out.text.length)
  })
})
