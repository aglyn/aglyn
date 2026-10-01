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

/** Every string anywhere in a value, for counting how often an id is said. */
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === 'object'
        ? [...Object.keys(value), ...Object.values(value).flatMap(strings)]
        : []

describe('a node map on the wire (AGL-3401, AGL-3438)', () => {
  it('states each id once', () => {
    const packed = packNodesForWire(page())
    const said = strings(packed)
    for (const id of Object.keys(page())) {
      expect(said.filter((value) => value === id)).toHaveLength(1)
    }
    for (const field of ['$id', 'parentId', 'nodes']) {
      expect(said).not.toContain(field)
    }
  })

  it('comes back exactly as it left, in document order', () => {
    const unpacked = unpackWireNodes(packNodesForWire(page()))
    expect(unpacked).toEqual(page())
    expect(Object.keys(unpacked)).toEqual(['_@_', 'sec', 'a', 'b'])
  })

  it('survives a JSON round trip, as it does in the flight payload', () => {
    const wire = JSON.parse(JSON.stringify(packNodesForWire(page())))
    expect(unpackWireNodes(wire)).toEqual(page())
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
    expect(unpackWireNodes(packNodesForWire(nodes))).toEqual(nodes)
  })

  it('keeps the parent of a child two lists name', () => {
    const nodes = page()
    nodes['_@_'].nodes.push('a')
    expect(unpackWireNodes(packNodesForWire(nodes))).toEqual(nodes)
  })

  it('brings back a malformed map whole', () => {
    const nodes = {
      ...page(),
      // A cycle no root reaches, an empty list, a list that is not all ids,
      // an id no node answers to, and a node that is not an object.
      c1: { $id: 'c1', parentId: 'c2', nodes: ['c2'] },
      c2: { $id: 'c2', parentId: 'c1', nodes: ['c1', 'missing'] },
      empty: { $id: 'empty', nodes: [] as string[] },
      mixed: { $id: 'mixed', nodes: ['b', 7] },
      gone: null as Record<string, unknown> | null,
    }
    const unpacked = unpackWireNodes(
      JSON.parse(JSON.stringify(packNodesForWire(nodes))),
    )
    expect(unpacked).toEqual(nodes)
    expect(Object.keys(unpacked).sort()).toEqual(Object.keys(nodes).sort())
  })

  it('fills in a flat map, packed the AGL-3401 way or not at all', () => {
    const full = page()
    expect(unpackWireNodes(full)).toEqual(full)
    const flat = Object.fromEntries(
      Object.entries(page()).map(([key, node]) => {
        const rest: Record<string, unknown> = { ...node }
        delete rest['$id']
        delete rest['parentId']
        return [key, rest]
      }),
    )
    expect(unpackWireNodes(flat)).toEqual(page())
  })

  it('takes a full patch merged over the unpacked map', () => {
    const merged = {
      ...unpackWireNodes(packNodesForWire(page())),
      b: { ...page().b, props: { children: 'Patched' } },
    }
    expect(unpackWireNodes(merged)).toEqual({
      ...page(),
      b: { ...page().b, props: { children: 'Patched' } },
    })
  })

  it('passes an absent map through', () => {
    expect(packNodesForWire(null)).toBeNull()
    expect(unpackWireNodes(undefined)).toBeUndefined()
  })
})
