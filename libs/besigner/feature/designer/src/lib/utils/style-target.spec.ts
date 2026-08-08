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
import { getNodeStyleTarget } from './style-target'

describe('getNodeStyleTarget (AGL-1306)', () => {
  it('reads and writes node.sx for a plain node', () => {
    const node = { $id: 'a', componentId: 'muiStack', sx: { py: 2 } } as any
    const target = getNodeStyleTarget(node)
    expect(target.isInstanceOverride).toBe(false)
    expect(target.sx).toEqual({ py: 2 })
    target.setSx({ py: 4 })
    expect(node.sx).toEqual({ py: 4 })
    expect(node.styleOverrides).toBeUndefined()
  })

  it('reads and writes the root override slice for an instance', () => {
    const node = {
      $id: 'a',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'cta' },
      sx: {},
    } as any
    const target = getNodeStyleTarget(node)
    expect(target.isInstanceOverride).toBe(true)
    expect(target.sx).toBeUndefined()

    target.setSx({ backgroundColor: '#0b4a6f' })
    expect(node.styleOverrides).toEqual({
      [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#0b4a6f' },
    })
    // The instance's OWN sx (its wrapper) is untouched — the override
    // layer targets the component root, not the wrapper.
    expect(node.sx).toEqual({})
    // The getter reads live state, not a snapshot from build time.
    expect(target.sx).toEqual({ backgroundColor: '#0b4a6f' })
  })

  it('clearing the last override property removes the field entirely', () => {
    const node = {
      $id: 'a',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'cta' },
      styleOverrides: {
        [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#0b4a6f' },
      },
    } as any
    const target = getNodeStyleTarget(node)
    target.setSx({})
    expect(node.styleOverrides).toBeUndefined()
    target.setSx(undefined)
    expect(node.styleOverrides).toBeUndefined()
  })

  it('preserves sibling override slices when clearing the root slice', () => {
    // Phase 2 keys inner-node overrides beside `root`; clearing the root
    // slice must not take them with it.
    const node = {
      $id: 'a',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'cta' },
      styleOverrides: {
        [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { py: 2 },
        innerNodeId: { color: '#fff' },
      },
    } as any
    getNodeStyleTarget(node).setSx(undefined)
    expect(node.styleOverrides).toEqual({ innerNodeId: { color: '#fff' } })
  })

  it('is inert without a node', () => {
    const target = getNodeStyleTarget(undefined)
    expect(target.sx).toBeUndefined()
    expect(() => target.setSx({ py: 1 })).not.toThrow()
  })
})
