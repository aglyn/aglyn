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

/**
 * A page rendered for ONE record (AGL-3475): a record template's routed record
 * fills the page's `{{item.*}}` tokens exactly as a repeat fills each copy's,
 * and a repeat inside that page keeps its own rows.
 *
 * The order is the whole contract, so these run the three steps the way the
 * composition does: the record into each repeat's filter, the expansion, then
 * the record into whatever the expansion left.
 */

import {
  type PageRecordScope,
  expandRepeatables,
  substituteNodesRecordTokens,
  substituteRepeatFilterRecordTokens,
} from './expand-repeatables'

const compose = (nodes: any, rows: any, scope: PageRecordScope | null) =>
  substituteNodesRecordTokens(
    expandRepeatables(substituteRepeatFilterRecordTokens<any>(nodes, scope), rows),
    scope,
  ) as any

const page = () =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['title', 'author', 'related'] },
    title: {
      $id: 'title',
      componentId: 'muiTypography',
      parentId: 'root',
      props: { children: '{{item.name}} in {{item.city}}', component: 'h1' },
    },
    author: {
      $id: 'author',
      componentId: 'muiTypography',
      parentId: 'root',
      props: { children: 'Crew lead: {{item.lead.name}}' },
    },
    related: {
      $id: 'related',
      componentId: 'muiStack',
      parentId: 'root',
      props: {
        repeatDataset: 'services',
        repeatFilter: 'category == {{item.category}}',
      },
      nodes: ['card'],
    },
    card: {
      $id: 'card',
      componentId: 'muiTypography',
      parentId: 'related',
      props: { children: '{{item.name}}' },
    },
  }) as any

const services = {
  records: [
    { $id: 's1', name: 'Roofing', category: 'exterior' },
    { $id: 's2', name: 'Siding', category: 'exterior' },
    { $id: 's3', name: 'Kitchens', category: 'interior' },
  ],
}

const scope: PageRecordScope = {
  record: { $id: 's1', name: 'Roofing', city: 'Austin', category: 'exterior', lead: 'p1' },
  model: { references: { lead: 'people' } },
  datasetsByKey: { people: { records: [{ $id: 'p1', name: 'Marisol' }] } },
}

describe('a page rendered for one record', () => {
  it('fills the page’s own tokens, one reference hop included', () => {
    const nodes = compose(page(), { services }, scope)
    expect(nodes.title.props.children).toBe('Roofing in Austin')
    expect(nodes.author.props.children).toBe('Crew lead: Marisol')
  })

  it('leaves a repeat inside the page its own rows', () => {
    const nodes = compose(page(), { services }, scope)
    const copies = (nodes.related.nodes as string[]).map((id) => nodes[id].props.children)
    expect(copies).toEqual(['Roofing', 'Siding'])
  })

  it('lets a repeat’s filter name the routed record', () => {
    const nodes = compose(page(), { services }, {
      ...scope,
      record: { ...scope.record, category: 'interior' },
    })
    const copies = (nodes.related.nodes as string[]).map((id) => nodes[id].props.children)
    expect(copies).toEqual(['Kitchens'])
  })

  it('keeps a token naming a field the record lacks, as a repeat does', () => {
    const nodes = page()
    nodes.title.props.children = '{{item.missing}}'
    expect(compose(nodes, { services }, scope).title.props.children).toBe('{{item.missing}}')
  })

  it('is the expansion unchanged when there is no record', () => {
    const nodes = page()
    expect(substituteNodesRecordTokens(nodes, null)).toBe(nodes)
    expect(substituteRepeatFilterRecordTokens(nodes, undefined)).toBe(nodes)
  })

  it('never touches anything but a repeat’s filter before the expansion', () => {
    const nodes = page()
    const filtered = substituteRepeatFilterRecordTokens(nodes, scope) as any
    expect(filtered.related.props.repeatFilter).toBe('category == exterior')
    expect(filtered.card).toBe(nodes.card)
    expect(filtered.title).toBe(nodes.title)
    expect(nodes.related.props.repeatFilter).toBe('category == {{item.category}}')
  })
})
