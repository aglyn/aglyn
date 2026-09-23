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
import { getLayoutStyleTarget } from './style-target'

describe('getLayoutStyleTarget (AGL-3286)', () => {
  const rootOf = (layoutStyleOverrides?: Record<string, any>) =>
    ({
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      sx: { p: 1 },
      ...(layoutStyleOverrides ? { layoutStyleOverrides } : {}),
    }) as any

  it('behaves as an override: empty until the page restyles the element', () => {
    const root = rootOf()
    const target = getLayoutStyleTarget(root, 'site', 'nav')
    expect(target.isLayoutOverride).toBe(true)
    expect(target.isInstanceOverride).toBe(true)
    expect(target.isLeafOverride).toBe(false)
    expect(target.isComposed).toBe(false)
    expect(target.overrideKey).toBe('nav')
    expect(target.sx).toBeUndefined()
  })

  it('writes into the screen root, keyed by layout then layout node', () => {
    const root = rootOf()
    const target = getLayoutStyleTarget(root, 'site', 'nav')
    target.setSx({ backgroundColor: 'transparent' })
    expect(root.layoutStyleOverrides).toEqual({
      site: { nav: { backgroundColor: 'transparent' } },
    })
    // The screen root's own styling is never the target.
    expect(root.sx).toEqual({ p: 1 })
    // Live read, not a snapshot from when the target was built.
    expect(target.sx).toEqual({ backgroundColor: 'transparent' })
  })

  it("leaves the layout's other elements and other layouts alone", () => {
    const root = rootOf({
      site: { footer: { color: 'red' } },
      shell: { banner: { color: 'blue' } },
    })
    getLayoutStyleTarget(root, 'site', 'nav').setSx({ color: 'white' })
    expect(root.layoutStyleOverrides).toEqual({
      site: { footer: { color: 'red' }, nav: { color: 'white' } },
      shell: { banner: { color: 'blue' } },
    })
  })

  it('clearing the last property removes the slice, then the field', () => {
    const root = rootOf({ site: { nav: { color: 'white' } } })
    const target = getLayoutStyleTarget(root, 'site', 'nav')
    target.setSx({})
    expect(root.layoutStyleOverrides).toBeUndefined()
    expect(target.sx).toBeUndefined()
  })

  it('round-trips through the canvas root as a saved field', () => {
    const canvas = new Aglyn.CanvasManager(undefined as any)
    canvas.setNodes(
      canvas.processNodesToDenormalized({
        [Aglyn.NODE_ROOT_ID]: { $id: Aglyn.NODE_ROOT_ID, componentId: 'div' },
      } as any),
    )
    const root = canvas.getNode(Aglyn.NODE_ROOT_ID)
    getLayoutStyleTarget(root, 'site', 'nav').setSx({ color: 'white' })
    const saved = canvas.toJSON().nodes as Record<string, any>
    const { nodes, layoutStyleOverrides } =
      Aglyn.extractLayoutStyleOverrides(saved)
    expect(layoutStyleOverrides).toEqual({ site: { nav: { color: 'white' } } })
    expect(nodes[Aglyn.NODE_ROOT_ID]).not.toHaveProperty('layoutStyleOverrides')
  })
})
