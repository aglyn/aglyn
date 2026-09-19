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

import { importColumnShape, importColumns } from './import-column-shapes'

/** A column's shape is one word about its cells, read in the browser (AGL-2917). */
describe('an import column’s shape', () => {
  it('names what most of a column’s cells are', () => {
    expect(importColumnShape(['dana@example.com', 'kim@example.org', ''])).toBe('email')
    expect(importColumnShape(['Yes', 'no', 'TRUE', 'n'])).toBe('yes-no')
    expect(importColumnShape(['2026-09-16', '09/17/2026', 'Sep 18, 2026'])).toBe('date')
    expect(importColumnShape(['1,250.00', '$99', '42', '7.5%'])).toBe('number')
    expect(importColumnShape(['(512) 555-0100', '+44 20 7946 0958', '512.555.0199'])).toBe('phone')
    expect(importColumnShape(['https://acme.test/about', 'harbor-roofing.com'])).toBe('url')
    expect(importColumnShape(['Dana Whitfield', 'Kim Lee'])).toBe('text')
    expect(importColumnShape(['', '  ', null, undefined])).toBe('empty')
  })

  it('takes a shape when four in five cells agree, and text when they do not', () => {
    expect(importColumnShape(['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co', 'not an address'])).toBe('email')
    expect(importColumnShape(['a@b.co', 'c@d.co', 'e@f.co', 'n/a', 'not an address'])).toBe('text')
  })

  it('reads every column of a file by its header, from the rows under it', () => {
    expect(
      importColumns(
        ['Email', ' Name ', 'Renews', 'Blank'],
        [
          ['dana@example.com', 'Dana', '2026-10-01', ''],
          ['kim@example.org', 'Kim', '2026-11-01'],
        ],
      ),
    ).toEqual([
      { header: 'Email', shape: 'email' },
      { header: 'Name', shape: 'text' },
      { header: 'Renews', shape: 'date' },
      { header: 'Blank', shape: 'empty' },
    ])
  })
})
