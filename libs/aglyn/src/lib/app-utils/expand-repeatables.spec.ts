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

import { expandRepeatables, hasRepeatableNodes } from './expand-repeatables'

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

describe('expandRepeatables reference hops (AGL-180)', () => {
  it('resolves {{item.ref.field}} through the target dataset', () => {
    const nodes = baseNodes()
    nodes['label'].props.children = '{{item.name}} by {{item.author.name}}'
    const posts = {
      records: [{ $id: 'p1', name: 'Hello', author: 'a1' }],
      model: {
        order: ['name', 'author'],
        fields: {
          name: { name: 'Name', type: 'text' },
          author: {
            name: 'Author',
            type: 'reference',
            reference: { datasetId: 'authors' },
          },
        },
      },
    } as any
    const authors = {
      records: [{ $id: 'a1', name: 'Ada' }],
    } as any
    const result = expandRepeatables(nodes, { Team: posts, authors })
    const list = result['list'] as any
    const label = (result[(result[list.nodes[0]] as any).$id] as any).nodes[0]
    expect((result[label] as any).props.children).toBe('Hello by Ada')
  })

  it('resolves multi-reference arrays and leaves unknown hops as tokens', () => {
    const nodes = baseNodes()
    nodes['label'].props.children = '{{item.tags.name}} / {{item.ghost.name}}'
    const posts = {
      records: [{ $id: 'p1', tags: ['t1', 't2'] }],
      model: {
        order: ['tags'],
        fields: {
          tags: {
            name: 'Tags',
            type: 'reference',
            reference: { datasetId: 'tags', multiple: true },
          },
        },
      },
    } as any
    const tags = {
      records: [
        { $id: 't1', name: 'red' },
        { $id: 't2', name: 'blue' },
      ],
    } as any
    const result = expandRepeatables(nodes, { Team: posts, tags })
    const list = result['list'] as any
    const label = (result[list.nodes[0]] as any).nodes[0]
    expect((result[label] as any).props.children).toBe(
      'red, blue / {{item.ghost.name}}',
    )
  })
})

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

/**
 * AGL-1440: the predicate that decides whether the datasets read is worth
 * paying for.
 *
 * The tenant compose pipeline fetched every dataset and up to 100 records EACH
 * on every render of every path — up to 5,050 reads — and then handed them to
 * `expandRepeatables`, which returns its input untouched when no node carries
 * `repeatDataset`. So the gate has to be the SAME question `expandRepeatables`
 * asks, or the saving is bought with a page that silently loses its rows.
 *
 * It is exported and used by `expandRepeatables` itself for exactly that
 * reason: two copies of "is this node a repeatable" is how a `.trim()` on one
 * side and not the other becomes an empty list on a customer's page.
 */
describe('hasRepeatableNodes (AGL-1440)', () => {
  it('is true for the tree expandRepeatables would expand', () => {
    expect(hasRepeatableNodes(baseNodes())).toBe(true)
  })

  it('is false for a tree with no repeatDataset anywhere', () => {
    const nodes = baseNodes()
    delete nodes.list.props.repeatDataset
    expect(hasRepeatableNodes(nodes)).toBe(false)
  })

  it('agrees with expandRepeatables on every shape it refuses', () => {
    // The property that makes the gate safe: whenever the predicate says no,
    // expanding with the full dataset map is a no-op. A `repeatDataset` that is
    // blank, whitespace, or not a string is one of those shapes — and each is a
    // way for the two sides to drift apart.
    for (const repeatDataset of ['', '   ', 42, null, undefined, {}]) {
      const nodes = baseNodes()
      nodes.list.props.repeatDataset = repeatDataset
      expect(hasRepeatableNodes(nodes)).toBe(false)
      expect(expandRepeatables(nodes, { Team: team })).toEqual(nodes)
    }
  })

  it('finds a repeatable grafted in from a reusable component or layout', () => {
    // The gate runs over the COMPOSED tree, not the screen document, because a
    // repeatable can arrive from a layout or a reusable component. A predicate
    // that only looked at the screen would drop those pages' rows.
    const grafted = {
      root: { $id: 'root', componentId: 'div', nodes: ['graft'] },
      graft: {
        $id: 'graft',
        componentId: 'muiStack',
        props: { repeatDataset: 'Team' },
        nodes: [],
      },
    } as any
    expect(hasRepeatableNodes(grafted)).toBe(true)
  })

  it('tolerates an empty or malformed node map', () => {
    expect(hasRepeatableNodes({})).toBe(false)
    expect(hasRepeatableNodes({ a: null } as any)).toBe(false)
    expect(hasRepeatableNodes(undefined as any)).toBe(false)
  })
})
