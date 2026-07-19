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
  collectionEntryTokens,
  expandCollectionEntries,
} from './collection-entries'

const baseNodes = () =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['list'] },
    list: {
      $id: 'list',
      componentId: 'collectionEntries',
      parentId: 'root',
      props: {},
      nodes: ['item'],
    },
    item: {
      $id: 'item',
      componentId: 'muiStack',
      parentId: 'list',
      props: {},
      nodes: ['title', 'link'],
    },
    title: {
      $id: 'title',
      componentId: 'muiTypography',
      parentId: 'item',
      props: { children: '{{entry.title}} — {{entry.date}}' },
    },
    link: {
      $id: 'link',
      componentId: 'muiScreenLink',
      parentId: 'item',
      props: { children: 'Read more', href: '{{entry.url}}' },
    },
  }) as any

const blog = {
  slug: 'blog',
  entries: [
    {
      $id: 'e1',
      title: 'Hello world',
      slug: 'hello-world',
      excerpt: 'First post',
      publishedAt: { seconds: 1_700_000_000 },
    },
    { $id: 'e2', title: 'Second', slug: 'second', excerpt: '' },
  ],
}

describe('collectionEntryTokens (AGL-551)', () => {
  it('exposes title/excerpt/body/slug/url/date tokens', () => {
    const tokens = collectionEntryTokens(
      {
        title: 'Hello',
        slug: 'hello',
        excerpt: 'Hi',
        body: '# Body',
        publishedAt: { seconds: 1_700_000_000 },
      },
      'blog',
    )
    expect(tokens['entry.title']).toBe('Hello')
    expect(tokens['entry.excerpt']).toBe('Hi')
    expect(tokens['entry.body']).toBe('# Body')
    expect(tokens['entry.slug']).toBe('hello')
    expect(tokens['entry.url']).toBe('/blog/hello')
    expect(tokens['entry.date']).toBe(
      new Date(1_700_000_000 * 1000).toLocaleDateString(),
    )
  })

  it('empties missing fields instead of leaving tokens literal', () => {
    const tokens = collectionEntryTokens({}, 'blog')
    expect(tokens['entry.title']).toBe('')
    expect(tokens['entry.date']).toBe('')
    expect(tokens['entry.url']).toBe('/blog/')
  })
})

describe('expandCollectionEntries (AGL-551)', () => {
  it('clones the template once per entry with per-entry tokens', () => {
    const nodes = expandCollectionEntries(baseNodes(), { blog }, 'blog')
    const childIds = nodes['list'].nodes as string[]
    expect(childIds).toHaveLength(2)
    expect(nodes[childIds[0]].parentId).toBe('list')
    const firstTitleId = `${childIds[0].replace(/item$/, '')}title`
    expect(nodes[firstTitleId].props.children).toBe(
      `Hello world — ${new Date(1_700_000_000 * 1000).toLocaleDateString()}`,
    )
    const firstLinkId = `${childIds[0].replace(/item$/, '')}link`
    expect(nodes[firstLinkId].props.href).toBe('/blog/hello-world')
    const secondTitleId = `${childIds[1].replace(/item$/, '')}title`
    expect(nodes[secondTitleId].props.children).toBe('Second — ')
  })

  it('resolves an explicit collectionSlug prop over the routed default', () => {
    const nodes = baseNodes()
    nodes['list'].props.collectionSlug = 'news'
    const news = {
      slug: 'news',
      entries: [{ title: 'Launch', slug: 'launch' }],
    }
    const expanded = expandCollectionEntries(nodes, { blog, news }, 'blog')
    const childIds = expanded['list'].nodes as string[]
    expect(childIds).toHaveLength(1)
    const linkId = `${childIds[0].replace(/item$/, '')}link`
    expect(expanded[linkId].props.href).toBe('/news/launch')
  })

  it('caps clones at entriesLimit', () => {
    const nodes = baseNodes()
    nodes['list'].props.entriesLimit = 1
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    expect(expanded['list'].nodes).toHaveLength(1)
  })

  it('fails open when the collection is unknown or empty', () => {
    const untouched = baseNodes()
    expect(expandCollectionEntries(untouched, {}, 'blog')).toEqual(untouched)
    const empty = expandCollectionEntries(
      baseNodes(),
      { blog: { slug: 'blog', entries: [] } },
      'blog',
    )
    expect(empty['list'].nodes).toEqual(['item'])
  })

  it('never mutates the input map', () => {
    const nodes = baseNodes()
    const snapshot = JSON.parse(JSON.stringify(nodes))
    expandCollectionEntries(nodes, { blog }, 'blog')
    expect(nodes).toEqual(snapshot)
  })
})
