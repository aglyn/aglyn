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

import { packNodesForWire, unpackWireNodes } from './wire-nodes'

/** A small page: a root, a section and two children of it. */
const page = () => ({
  '_@_': { $id: '_@_', type: 'root', nodes: ['sec'] },
  sec: {
    $id: 'sec',
    type: 'node',
    parentId: '_@_',
    componentId: 'section',
    nodes: ['a', 'b'],
  },
  a: {
    $id: 'a',
    type: 'node',
    parentId: 'sec',
    componentId: 'muiTypography',
    props: { children: 'Hi' },
  },
  b: { $id: 'b', type: 'node', parentId: 'sec', componentId: 'muiButton' },
})

describe('a node map on the wire (AGL-3401)', () => {
  it('drops each id its key states and each parent its parent’s list states', () => {
    const packed = packNodesForWire(page())
    for (const node of Object.values(packed)) {
      expect(node).not.toHaveProperty('$id')
      expect(node).not.toHaveProperty('parentId')
    }
    expect(packed.a).toEqual({
      type: 'node',
      componentId: 'muiTypography',
      props: { children: 'Hi' },
    })
  })

  it('comes back exactly as it left', () => {
    expect(unpackWireNodes(packNodesForWire(page()))).toEqual(page())
  })

  it('never mutates the map it is handed', () => {
    const nodes = page()
    packNodesForWire(nodes)
    expect(nodes).toEqual(page())
  })

  it('keeps a field its unpacking could not reproduce', () => {
    // An id that is not its key, and a parent no list names: the map says
    // something else, so the stored value is the only record of it.
    const nodes = {
      ...page(),
      x: { $id: 'not-x', type: 'node', parentId: 'gone' },
    }
    const packed = packNodesForWire(nodes)
    expect(packed.x).toEqual({ $id: 'not-x', type: 'node', parentId: 'gone' })
    expect(unpackWireNodes(packed)).toEqual(nodes)
  })

  it('keeps the parent of a child two lists name', () => {
    const nodes = page()
    nodes['_@_'].nodes.push('a')
    const packed = packNodesForWire(nodes)
    expect(packed.a).toHaveProperty('parentId', 'sec')
    expect(unpackWireNodes(packed)).toEqual(nodes)
  })

  it('unpacks a full patch merged over a packed map, and a full map, unchanged', () => {
    const full = page()
    expect(unpackWireNodes(full)).toEqual(full)
    const merged = { ...packNodesForWire(page()), b: page().b }
    expect(unpackWireNodes(merged)).toEqual(page())
  })

  it('passes an absent map through', () => {
    expect(packNodesForWire(null)).toBeNull()
    expect(unpackWireNodes(undefined)).toBeUndefined()
  })
})
