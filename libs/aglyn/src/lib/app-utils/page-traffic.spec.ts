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
  chunkForInQuery,
  classifyPagePath,
  displayCountedPath,
  normalizeCountedPath,
  rollUpPathViews,
  type PagePathContext,
} from './page-traffic'
import {
  listSitePathKinds,
  registerSitePathKind,
} from '../plugin-manager/site-path-kinds'

const context: PagePathContext = {
  routes: { home: '/', about: 'about', tpl: 'blog', pdp: 'pdp-template' },
  templateScreenIds: new Set(['tpl', 'pdp']),
  recordSegments: new Set(['products']),
  contentCollectionSlugs: new Set(['blog']),
}

describe('classifyPagePath answers in the site loader’s order (AGL-4253)', () => {
  it('a routed page is a page', () => {
    expect(classifyPagePath('/about', context)).toEqual({ kind: 'page', screenId: 'about' })
    expect(classifyPagePath('/', context)).toEqual({ kind: 'page', screenId: 'home' })
  })

  it('a template screen routed at a path is never the page there', () => {
    expect(classifyPagePath('/blog', context)).toEqual({
      kind: 'collectionList',
      collectionSlug: 'blog',
    })
    expect(classifyPagePath('/pdp-template', context)).toEqual({ kind: 'other' })
  })

  it('a plugin record, a collection entry, a paged list', () => {
    expect(classifyPagePath('/products/nova', context)).toEqual({
      kind: 'record',
      segment: 'products',
      slug: 'nova',
    })
    expect(classifyPagePath('/blog/hello', context)).toEqual({
      kind: 'entry',
      collectionSlug: 'blog',
      entrySlug: 'hello',
    })
    expect(classifyPagePath('/blog/page/2', context)).toEqual({
      kind: 'collectionList',
      collectionSlug: 'blog',
    })
  })

  it('anything else is not a page of the site now', () => {
    expect(classifyPagePath('/wp-admin', context)).toEqual({ kind: 'other' })
    expect(classifyPagePath('/products/a/b', context)).toEqual({ kind: 'other' })
  })
})

describe('rollUpPathViews', () => {
  it('merges one page’s forms and drops zero counts', () => {
    expect(
      rollUpPathViews([
        { paths: { '/a': 2, '/a/': 1, '/b': 0 } },
        { paths: { '': 4 } },
        { paths: null },
      ]),
    ).toEqual([
      { path: '/', views: 4 },
      { path: 'a', views: 3 },
    ])
  })

  it('normalizes and displays paths the way a visitor types them', () => {
    expect(normalizeCountedPath('/shop/')).toBe('shop')
    expect(displayCountedPath('shop')).toBe('/shop')
    expect(displayCountedPath('/')).toBe('/')
  })

  it('chunks for Firestore’s thirty-value in filter', () => {
    expect(chunkForInQuery(Array.from({ length: 61 }, (_, i) => i)).map((c) => c.length)).toEqual([
      30, 30, 1,
    ])
  })
})

describe('registerSitePathKind', () => {
  it('one segment has one owner', () => {
    registerSitePathKind(
      { segment: '/things/', groupLabel: 'Things', noun: 'thing', collection: 'things' },
      { pluginId: 'one' },
    )
    expect(listSitePathKinds().find((kind) => kind.segment === 'things')?.pluginId).toBe('one')
    expect(() =>
      registerSitePathKind(
        { segment: 'things', groupLabel: 'X', noun: 'x', collection: 'x' },
        { pluginId: 'two' },
      ),
    ).toThrow(/already declared by "one"/)
    expect(() =>
      registerSitePathKind(
        { segment: 'a/b', groupLabel: 'X', noun: 'x', collection: 'x' },
        { pluginId: 'one' },
      ),
    ).toThrow(/one path segment/)
  })
})
