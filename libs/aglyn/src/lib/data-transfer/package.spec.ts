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

import { createHash } from 'node:crypto'

import {
  TRANSFER_PACKAGE_FORMAT,
  TRANSFER_PACKAGE_VERSION,
  buildPackageManifest,
  contentHash,
  keepBothSlug,
  matchPackageItems,
  packageDecisionsFor,
  packageDependencyClosure,
  packageDependencyOrder,
  packageItemKey,
  proposePackageDecision,
  readPackageManifest,
  stableJson,
} from './package'
import type { PackageManifestItem } from './package'

const item = (kind: string, id: string, deps: [string, string][] = [], extra: Partial<PackageManifestItem> = {}): PackageManifestItem => ({
  kind,
  $id: id,
  contentHash: `sha256:${id}`,
  deps: deps.map(([depKind, depId]) => ({ kind: depKind, id: depId })),
  ...extra,
})

describe('stableJson and contentHash', () => {
  it('sorts keys at every depth and drops undefined', () => {
    expect(stableJson({ b: 1, a: { d: [3, { y: 1, x: undefined }], c: undefined } })).toBe('{"a":{"d":[3,{"y":1}]},"b":1}')
    expect(stableJson({ when: new Date(0), n: Number.NaN, list: [undefined] })).toBe(
      '{"list":[null],"n":null,"when":"1970-01-01T00:00:00.000Z"}',
    )
    expect(stableJson(undefined)).toBe('null')
  })

  it('hashes the same data the same whatever its key order, matching Node sha256', async () => {
    const left = await contentHash({ a: 1, b: [1, 2] })
    const right = await contentHash({ b: [1, 2], a: 1 })
    expect(left).toBe(right)
    expect(left).toBe(`sha256:${createHash('sha256').update('{"a":1,"b":[1,2]}').digest('hex')}`)
    expect(await contentHash({ a: 2 })).not.toBe(left)
  })
})

describe('readPackageManifest', () => {
  it('reads a well-formed manifest', () => {
    const read = readPackageManifest({
      format: 'aglyn-package',
      version: 2,
      createdAt: 5,
      source: 'Site: Acme',
      items: [{ kind: 'page', $id: 'p1', slug: 'home', contentHash: 'sha256:abc', deps: [{ kind: 'layout', id: 'l1' }] }],
    })
    expect(read).toEqual({
      ok: true,
      manifest: {
        format: TRANSFER_PACKAGE_FORMAT,
        version: TRANSFER_PACKAGE_VERSION,
        createdAt: 5,
        source: 'Site: Acme',
        items: [{ kind: 'page', $id: 'p1', slug: 'home', contentHash: 'sha256:abc', deps: [{ kind: 'layout', id: 'l1' }] }],
      },
    })
  })

  it('reports every problem with a malformed one', () => {
    const read = readPackageManifest({
      format: 'aglyn-site-export',
      version: 1,
      items: [
        { kind: 'page', $id: 'p1', contentHash: 'sha256:a', deps: [{ kind: 'layout' }] },
        { kind: 'page', $id: 'p1', contentHash: 'sha256:a' },
        { $id: '', contentHash: 'md5:x', deps: 'nope' },
      ],
    })
    expect(read).toEqual({
      ok: false,
      problems: [
        'The file\'s format is "aglyn-site-export", not "aglyn-package".',
        'The package is version 1; this reads version 2.',
        'Item 1 has a dependency without a kind and id.',
        'Item 2 repeats page/p1.',
        'Item 3 has no kind.',
        'Item 3 has no id.',
        'Item 3 has no content hash.',
        'Item 3 has dependencies that are not a list.',
      ],
    })
    expect(readPackageManifest(null)).toEqual({ ok: false, problems: ['The file is not a package.'] })
  })
})

describe('dependency graph', () => {
  it('orders dependencies first, ties in manifest order', () => {
    const items = [
      item('page', 'home', [['layout', 'main']]),
      item('page', 'about', [['layout', 'main'], ['component', 'hero']]),
      item('layout', 'main', [['component', 'nav']]),
      item('component', 'nav'),
      item('component', 'hero'),
    ]
    const result = packageDependencyOrder(items)
    expect(result.order.map(packageItemKey)).toEqual([
      'component/nav',
      'layout/main',
      'page/home',
      'component/hero',
      'page/about',
    ])
    expect(result.missing).toEqual([])
    expect(result.cycles).toEqual([])
  })

  it('reports dependencies outside the package unless the site has them', () => {
    const items = [item('page', 'home', [['layout', 'main'], ['component', 'footer']])]
    expect(packageDependencyOrder(items).missing).toEqual([
      { item: 'page/home', dependency: { kind: 'layout', id: 'main' } },
      { item: 'page/home', dependency: { kind: 'component', id: 'footer' } },
    ])
    expect(packageDependencyOrder(items, (dep) => dep.kind === 'layout').missing).toEqual([
      { item: 'page/home', dependency: { kind: 'component', id: 'footer' } },
    ])
  })

  it('reports cycles and self-references and still lists every item', () => {
    const items = [
      item('component', 'a', [['component', 'b']]),
      item('component', 'b', [['component', 'a']]),
      item('component', 'self', [['component', 'self']]),
      item('page', 'p', [['component', 'a']]),
      item('component', 'free'),
    ]
    const result = packageDependencyOrder(items)
    expect(result.order.map(packageItemKey)).toEqual([
      'component/free',
      'component/a',
      'component/b',
      'component/self',
      'page/p',
    ])
    expect(result.cycles.map((cycle) => [...cycle].sort())).toEqual([['component/a', 'component/b'], ['component/self']])
  })

  it('closes a selection over its dependencies', () => {
    const items = [
      item('page', 'home', [['layout', 'main']]),
      item('layout', 'main', [['component', 'nav']]),
      item('component', 'nav'),
      item('component', 'unused'),
    ]
    expect(packageDependencyClosure(items, ['page/home', 'missing/x'])).toEqual(['page/home', 'layout/main', 'component/nav'])
  })
})

describe('matching package items', () => {
  const manifest = {
    items: [
      item('page', 'p1', [], { slug: 'home', contentHash: 'sha256:same' }),
      item('page', 'other-id', [], { slug: 'About', contentHash: 'sha256:new' }),
      item('component', 'c9', [], { name: 'Hero Banner', contentHash: 'sha256:x' }),
      item('page', 'p4', [['layout', 'gone']], { slug: 'fresh' }),
      item('page', 'p5', [['layout', 'site-layout']]),
    ],
  }
  const existing = [
    { kind: 'page', id: 'p1', slug: 'home', contentHash: 'sha256:same' },
    { kind: 'page', id: 'p2', slug: 'about', contentHash: 'sha256:old' },
    { kind: 'component', id: 'c1', name: 'hero banner', contentHash: 'sha256:x' },
    { kind: 'layout', id: 'site-layout', contentHash: 'sha256:l' },
  ]

  it('matches by id, then slug, then name, and compares hashes', () => {
    const matches = matchPackageItems(manifest, existing)
    expect(matches.map((match) => [match.status, match.matchedBy, match.existing?.id])).toEqual([
      ['identical', 'id', 'p1'],
      ['differs', 'slug', 'p2'],
      ['identical', 'name', 'c1'],
      ['missingDependency', undefined, undefined],
      ['new', undefined, undefined],
    ])
    expect(matches[3]).toMatchObject({ comparison: 'new', missing: [{ kind: 'layout', id: 'gone' }] })
  })

  it('proposes create for new, skip for identical, and asks about a difference', () => {
    const matches = matchPackageItems(manifest, existing)
    expect(matches.map(proposePackageDecision)).toEqual([
      { decision: 'skip', needsChoice: false },
      { decision: 'skip', needsChoice: true },
      { decision: 'skip', needsChoice: false },
      { decision: 'create', needsChoice: true },
      { decision: 'create', needsChoice: false },
    ])
  })

  it('offers merge only for a mergeable kind', () => {
    const [, differs, , , fresh] = matchPackageItems(manifest, existing)
    expect(packageDecisionsFor(differs as never)).toEqual(['replace', 'keepBoth', 'skip'])
    expect(packageDecisionsFor(differs as never, true)).toEqual(['replace', 'keepBoth', 'skip', 'merge'])
    expect(packageDecisionsFor(fresh as never)).toEqual(['create', 'skip'])
  })
})

describe('keepBothSlug', () => {
  it('finds the first free copy slug', () => {
    expect(keepBothSlug('home', ['home'])).toBe('home-copy')
    expect(keepBothSlug('home', ['home', 'Home-Copy', 'home-copy-2'])).toBe('home-copy-3')
    expect(keepBothSlug('home-copy-2', ['home-copy'])).toBe('home-copy-2')
  })
})

describe('buildPackageManifest', () => {
  it('hashes each item and files its content by key', async () => {
    const built = await buildPackageManifest(
      [
        { kind: 'layout', id: 'l1', content: { nodes: [] } },
        { kind: 'page', id: 'p1', content: { title: 'Home' } },
      ],
      (entry) => (entry.kind === 'page' ? { slug: 'home', deps: [{ kind: 'layout', id: 'l1' }] } : { name: 'Main' }),
      { source: 'Site: Acme' },
    )
    expect(built.manifest.format).toBe('aglyn-package')
    expect(built.manifest.source).toBe('Site: Acme')
    expect(built.manifest.items[1]).toEqual({
      kind: 'page',
      $id: 'p1',
      slug: 'home',
      contentHash: await contentHash({ title: 'Home' }),
      deps: [{ kind: 'layout', id: 'l1' }],
    })
    expect(built.items['layout/l1']).toEqual({ nodes: [] })
    expect(readPackageManifest(JSON.parse(JSON.stringify(built.manifest))).ok).toBe(true)
  })
})
