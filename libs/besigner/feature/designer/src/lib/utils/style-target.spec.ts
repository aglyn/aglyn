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

describe('panel → save → reload → render round trip (AGL-1306)', () => {
  it('a panel write on a live canvas node survives save and reload, and renders merged', () => {
    // Each hop has its own spec (style-target above, the canvas manager's
    // styleOverrides round-trip, the compose graft) — this one chains them
    // on a REAL MobX AglynNode, the thing the panel actually mutates, so a
    // drift between the layers cannot pass unit tests hop-by-hop.
    const canvas = new Aglyn.CanvasManager(undefined as any)
    canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: Aglyn.NodeType.NODE,
        componentId: 'div',
        nodes: ['inst'],
      },
      inst: {
        $id: 'inst',
        type: Aglyn.NodeType.NODE,
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        props: { refId: 'cta' },
        nodes: [],
      },
    } as any)

    // The panel edit: exactly what the Styles panel does to the selected
    // node — write through the style target, not node.sx.
    getNodeStyleTarget(canvas.getNode('inst')).setSx({
      backgroundColor: '#0b4a6f',
      '@scheme dark': { backgroundColor: '#101828' },
    })

    // Save, then reload the serialization into a FRESH canvas — the same
    // path a closed-and-reopened document takes.
    const saved = canvas.toJSON().nodes as Record<string, any>
    const reloaded = new Aglyn.CanvasManager(undefined as any)
    reloaded.setNodes(saved as any)

    // Render: the one graft canvas, Preview and tenant SSR all call. The
    // override replaces the leaf it names, and the dark slice cascade-
    // merges — the base's color survives beside the overridden background.
    const definition = {
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiStack',
          sx: {
            backgroundColor: '#14532d',
            py: 8,
            '@scheme dark': { backgroundColor: '#000', color: '#fff' },
          },
          nodes: [],
        },
      },
    } as any
    const composed = Aglyn.composeReusableComponentNodes(
      reloaded.toJSON().nodes as any,
      { cta: definition },
    )
    expect(composed['cmp__inst__root'].sx).toEqual({
      backgroundColor: '#0b4a6f',
      py: 8,
      '@scheme dark': { backgroundColor: '#101828', color: '#fff' },
    })
  })
})
