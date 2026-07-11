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
  parseCssDeclarations,
  serializeCssDeclarations,
} from './custom-css-form.component'

describe('parseCssDeclarations', () => {
  it('parses kebab-case declarations into camelCase JSS', () => {
    expect(
      parseCssDeclarations('border-radius: 8px; background-color: #fff;'),
    ).toEqual({ borderRadius: '8px', backgroundColor: '#fff' })
  })

  it('ignores malformed fragments', () => {
    expect(parseCssDeclarations('nonsense;; color: red')).toEqual({
      color: 'red',
    })
  })
})

describe('serializeCssDeclarations', () => {
  it('emits scalar values at the requested breakpoint, skipping objects', () => {
    const sx = {
      color: { xs: 'red', md: 'blue' },
      padding: '8px',
      '&:hover': { opacity: 0.5 },
    }
    expect(serializeCssDeclarations(sx, 'md')).toBe(
      'color: blue;\npadding: 8px;',
    )
    expect(serializeCssDeclarations(sx, null)).toBe(
      'color: red;\npadding: 8px;',
    )
  })
})
