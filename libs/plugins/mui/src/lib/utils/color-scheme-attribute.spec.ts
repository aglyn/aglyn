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

import * as Aglyn from '@aglyn/aglyn'
import { resolveElementColorScheme } from '@aglyn/aglyn/app-utils/element-color-scheme'
import { schema as box } from '../components/box'
import { schema as container } from '../components/container'
import { schema as grid } from '../components/grid'
import { schema as section } from '../components/section'
import { schema as stack } from '../components/stack'
import { colorSchemeAttribute } from './color-scheme-attribute'

describe('the "Color scheme" attribute (AGL-3284)', () => {
  it.each([
    ['section', section],
    ['muiContainer', container],
    ['muiStack', stack],
    ['muiBox', box],
    ['muiGrid', grid],
  ])('is offered on %s', (_id, schema) => {
    const attribute = (schema.attributes ?? []).find(
      (entry: any) => entry?.name === 'colorScheme',
    )
    expect(attribute).toEqual(colorSchemeAttribute())
  })

  it('is a plain select, so the instance override panel offers it too', () => {
    // The panel draws only editors that resolve from the schema alone, and a
    // select is one of them (AGL-1899); anything fancier would hide the
    // per-placement control.
    expect(colorSchemeAttribute().component).toBe(
      Aglyn.FieldComponentType.SELECT,
    )
  })

  it('offers three persistable choices, and only two of them pin', () => {
    const options = colorSchemeAttribute().options as {
      value: string
      label: string
    }[]
    expect(options.map((option) => option.label)).toEqual([
      'Match the site',
      'Always light',
      'Always dark',
    ])
    // No `''`: it cannot survive a save (AGL-1453).
    expect(options.every((option) => option.value)).toBe(true)
    expect(options.map((option) => resolveElementColorScheme(option.value)))
      .toEqual([undefined, 'light', 'dark'])
  })
})
