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
import { render } from '@testing-library/react'

import ComponentPromotionContext from '../contexts/component-promotion-context'
import ComponentIconComponent from './component-icon.component'

const SCHEMA_PATH = 'M0 0h1'
const DEFINITION_PATH = 'M9 9h9'

const schema = {
  $id: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
  icon: { path: SCHEMA_PATH },
} as any

const instance = (refId: string) =>
  ({
    $id: 'a',
    componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
    props: { refId },
  }) as any

const definitions = {
  hero: {
    rootId: 'root',
    nodes: {},
    icon: { iconId: 'mdi-star', iconPath: DEFINITION_PATH },
  },
  cta: { rootId: 'root', nodes: {} },
} as any

/** The `d` of every path the icon rendered. */
const pathsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('d'))

const renderIcon = (node?: any) =>
  render(
    <ComponentPromotionContext.Provider value={{ definitions }}>
      <ComponentIconComponent component={schema} node={node} />
    </ComponentPromotionContext.Provider>,
  )

describe('ComponentIconComponent (AGL-1193)', () => {
  it('draws an instance with its definition icon, not the shared glyph', () => {
    expect(pathsIn(renderIcon(instance('hero')).container)).toContain(
      DEFINITION_PATH,
    )
  })

  it('falls back to the component glyph when the definition set none', () => {
    // The regression that matters: every component promoted before the
    // picker existed has no icon, and must keep its package glyph.
    expect(pathsIn(renderIcon(instance('cta')).container)).toContain(
      SCHEMA_PATH,
    )
  })

  it('falls back for an ordinary node and for no node at all', () => {
    const plain = { $id: 'b', componentId: 'muiButton' } as any
    expect(pathsIn(renderIcon(plain).container)).toContain(SCHEMA_PATH)
    expect(pathsIn(renderIcon().container)).toContain(SCHEMA_PATH)
  })
})
