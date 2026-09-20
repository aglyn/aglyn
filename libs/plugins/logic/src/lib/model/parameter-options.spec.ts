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

import {
  formatParameterOptions,
  parseParameterOptions,
} from './parameter-options'

describe('a parameter’s choices, as one line of text (AGL-3202)', () => {
  it('reads value: Label pairs, and a bare entry as its own label', () => {
    expect(
      parseParameterOptions(
        'cms: A CMS and room to grow, entry: The entry plan only, none',
      ),
    ).toEqual([
      { value: 'cms', label: 'A CMS and room to grow' },
      { value: 'entry', label: 'The entry plan only' },
      { value: 'none' },
    ])
  })

  it('keeps a colon that belongs to the label', () => {
    expect(parseParameterOptions('eta: Arrives: Tuesday')).toEqual([
      { value: 'eta', label: 'Arrives: Tuesday' },
    ])
  })

  it('drops blanks and the second copy of a value', () => {
    expect(parseParameterOptions(' , a: One, , a: Again, b:')).toEqual([
      { value: 'a', label: 'One' },
      { value: 'b' },
    ])
    expect(parseParameterOptions('')).toEqual([])
  })

  it('survives being typed: a half-written entry is still a list', () => {
    // What the box holds between keystrokes of "cms: A CMS, entry".
    expect(parseParameterOptions('cms:')).toEqual([{ value: 'cms' }])
    expect(parseParameterOptions('cms: A CMS,')).toEqual([
      { value: 'cms', label: 'A CMS' },
    ])
  })

  it('round-trips what it shows', () => {
    const text = 'cms: A CMS and room to grow, entry: The entry plan only, none'
    expect(formatParameterOptions(parseParameterOptions(text))).toBe(text)
    expect(formatParameterOptions(undefined)).toBe('')
  })
})
