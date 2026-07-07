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

import { expandRepeatables } from './expand-repeatables'

const baseNodes = () =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['list'] },
    list: {
      $id: 'list',
      componentId: 'muiStack',
      props: { repeatDataset: 'Team' },
      nodes: ['row'],
    },
    row: {
      $id: 'row',
      componentId: 'muiStack',
      parentId: 'list',
      props: { direction: 'row' },
      nodes: ['label'],
    },
    label: {
      $id: 'label',
      componentId: 'muiTypography',
      parentId: 'row',
      props: { children: '{{item.name}} — {{item.role}}' },
    },
  }) as any

const team = {
  records: [
    { name: 'Ada', role: 'Engineer' },
    { name: 'Grace', role: 'Admiral' },
  ],
}

describe('expandRepeatables', () => {
  it('clones the template per record with item tokens substituted', () => {
    const result = expandRepeatables(baseNodes(), { Team: team })
    const list = result['list'] as any
    expect(list.nodes).toHaveLength(2)
    const [first, second] = list.nodes
    expect((result[first] as any).parentId).toBe('list')
    const firstLabel = (result[first] as any).nodes[0]
    expect((result[firstLabel] as any).props.children).toBe('Ada — Engineer')
    const secondLabel = (result[second] as any).nodes[0]
    expect((result[secondLabel] as any).props.children).toBe(
      'Grace — Admiral',
    )
    // Non-repeated props survive the clone.
    expect((result[first] as any).props.direction).toBe('row')
  })

  it('honors repeatLimit and keeps unknown item fields literal', () => {
    const nodes = baseNodes()
    nodes.list.props.repeatLimit = 1
    nodes.label.props.children = '{{item.name}} ({{item.missing}})'
    const result = expandRepeatables(nodes, { Team: team })
    const list = result['list'] as any
    expect(list.nodes).toHaveLength(1)
    const label = (result[(result[list.nodes[0]] as any).nodes[0]] as any)
    expect(label.props.children).toBe('Ada ({{item.missing}})')
  })

  it('fails open on unknown datasets and empty records', () => {
    const untouched = expandRepeatables(baseNodes(), { Other: team })
    expect((untouched['list'] as any).nodes).toEqual(['row'])
    const empty = expandRepeatables(baseNodes(), { Team: { records: [] } })
    expect((empty['list'] as any).nodes).toEqual(['row'])
    expect(expandRepeatables(baseNodes(), undefined)['list']).toEqual(
      baseNodes()['list'],
    )
  })
})
