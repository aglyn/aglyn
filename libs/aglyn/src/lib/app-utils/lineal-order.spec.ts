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
  LinealDirectiveFlag,
  type ComponentsLinealOrder,
} from '../foundation/definitions/components.types'
import { checkLinealOrder, linealRelationshipPermits } from './lineal-order'

describe('checkLinealOrder (AGL-2905)', () => {
  it('admits a component a limitedTo list names', () => {
    expect(
      checkLinealOrder('muiListItem', 'mui', [
        LinealDirectiveFlag.LIMIT_TO,
        { components: ['muiListItem'] },
      ]),
    ).toBeNull()
  })

  it('refuses a component a limitedTo list omits', () => {
    expect(
      checkLinealOrder('muiTypography', 'mui', [
        LinealDirectiveFlag.LIMIT_TO,
        ['muiListItem'],
      ]),
    ).toBe('component')
  })

  it('reads an empty limitedTo list as admitting nothing', () => {
    expect(
      checkLinealOrder('muiTypography', 'mui', [
        LinealDirectiveFlag.LIMIT_TO,
        { components: [] },
      ]),
    ).toBe('component')
  })

  it('checks the plugin half after the component half', () => {
    expect(
      checkLinealOrder('muiAppBar', 'other', [
        LinealDirectiveFlag.LIMIT_TO,
        { components: ['muiAppBar'], plugins: ['mui'] },
      ]),
    ).toBe('plugin')
  })

  it('refuses a forbidden component or plugin and admits the rest', () => {
    const order = (): ComponentsLinealOrder => [
      LinealDirectiveFlag.DISALLOW,
      { components: ['form'], plugins: ['email'] },
    ]
    expect(checkLinealOrder('form', 'forms', order())).toBe('component')
    expect(checkLinealOrder('emailText', 'email', order())).toBe('plugin')
    expect(checkLinealOrder('muiStack', 'mui', order())).toBeNull()
  })

  it('accepts the flag spelled as the generated palette carries it', () => {
    expect(
      checkLinealOrder('muiToolbar', 'mui', ['limitedTo', ['muiToolbar']]),
    ).toBeNull()
    expect(checkLinealOrder('form', 'forms', ['forbid', ['form']])).toBe(
      'component',
    )
  })
})

describe('linealRelationshipPermits (AGL-2905)', () => {
  const toolbar = {
    componentId: 'muiToolbar',
    pluginId: 'mui',
    restrictParent: [
      LinealDirectiveFlag.LIMIT_TO,
      { components: ['muiAppBar'], plugins: ['mui'] },
    ] as ComponentsLinealOrder,
  }
  const list = {
    componentId: 'muiList',
    pluginId: 'mui',
    restrictChildren: [
      LinealDirectiveFlag.LIMIT_TO,
      { components: ['muiListItem'] },
    ] as ComponentsLinealOrder,
  }

  it("honors the child's restrictParent", () => {
    expect(
      linealRelationshipPermits(toolbar, {
        componentId: 'muiAppBar',
        pluginId: 'mui',
      }),
    ).toBe(true)
    expect(
      linealRelationshipPermits(toolbar, {
        componentId: 'muiStack',
        pluginId: 'mui',
      }),
    ).toBe(false)
  })

  it("honors the parent's restrictChildren", () => {
    expect(
      linealRelationshipPermits(
        { componentId: 'muiListItem', pluginId: 'mui' },
        list,
      ),
    ).toBe(true)
    expect(
      linealRelationshipPermits(
        { componentId: 'muiTypography', pluginId: 'mui' },
        list,
      ),
    ).toBe(false)
  })

  it('permits any pair with no directive on either side', () => {
    expect(
      linealRelationshipPermits(
        { componentId: 'muiTypography', pluginId: 'mui' },
        { componentId: 'muiStack', pluginId: 'mui' },
      ),
    ).toBe(true)
  })
})
