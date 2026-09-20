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

import { collectEntryLinkRefs } from './link-references'

/**
 * Which entries a page's links name (AGL-3118).
 *
 * The tenant reads exactly the entries this returns, so a reference it misses
 * is a live link rendered as plain text, and a reference it invents is one
 * wasted document in a bounded read. The cases lean on the first failure:
 * every place a link value can sit on a real page is planted once.
 */
describe('collectEntryLinkRefs', () => {
  it('finds an entry link in either slot of a linking element', () => {
    expect(
      collectEntryLinkRefs({
        nodes: [
          {
            a: { props: { screenId: 'entry:blog/post1', children: 'Read' } },
            b: { props: { href: 'entry:blog/post2' } },
          },
        ],
      }),
    ).toEqual(['entry:blog/post1', 'entry:blog/post2'])
  })

  it('reaches the item arrays a nav, a tab set or a menu keeps its targets in', () => {
    expect(
      collectEntryLinkRefs({
        nodes: [
          {
            nav: {
              props: {
                items: [
                  { label: 'Home', screenId: 'screen:home' },
                  {
                    label: 'Guides',
                    children: [{ label: 'Setup', href: 'entry:docs/setup' }],
                  },
                ],
              },
            },
            tabs: { props: { tabs: [{ label: 'Intro', link: 'entry:docs/intro' }] } },
          },
        ],
      }),
    ).toEqual(['entry:docs/intro', 'entry:docs/setup'])
  })

  it('finds a component prop holding the value, before or after the graft', () => {
    // The instance keeps the authored value in its property bag, and the graft
    // copies it into the definition's linking node. Either is enough.
    expect(
      collectEntryLinkRefs({
        nodes: [
          {
            instance: {
              props: { refId: 'cta', propertyValues: { link: 'entry:blog/post1' } },
            },
          },
        ],
      }),
    ).toEqual(['entry:blog/post1'])
  })

  it('reads the markdown link targets of a Markdown element and an entry body node', () => {
    expect(
      collectEntryLinkRefs({
        nodes: [
          {
            md: {
              componentId: 'markdown',
              props: {
                content:
                  '## See also\n\n- [Setup](entry:docs/setup)\n- [Pricing](screen:pricing)',
              },
            },
            body: {
              componentId: 'collectionEntryBody',
              props: { markdown: 'Read [the launch](entry:blog/launch) first.' },
            },
          },
        ],
      }),
    ).toEqual(['entry:blog/launch', 'entry:docs/setup'])
  })

  it('reads a body that no node carries — the legacy article surface', () => {
    expect(
      collectEntryLinkRefs({
        markdown: ['Two posts: [one](entry:blog/a) and [two](entry:blog/b).'],
      }),
    ).toEqual(['entry:blog/a', 'entry:blog/b'])
  })

  it('answers with canonical keys, deduplicated and sorted across every source', () => {
    // The same entry spelled with stray whitespace, named twice, from two
    // trees and a body, is one key — and the order is stable, because the
    // tenant caches the read under the set.
    expect(
      collectEntryLinkRefs({
        nodes: [
          { a: { props: { href: ' entry: blog / zeta ' } } },
          { b: { props: { screenId: 'entry:blog/alpha' } } },
        ],
        markdown: ['[z](entry:blog/zeta) [a](entry:blog/alpha)'],
      }),
    ).toEqual(['entry:blog/alpha', 'entry:blog/zeta'])
  })

  it('ignores every other link kind, and a malformed entry value', () => {
    expect(
      collectEntryLinkRefs({
        nodes: [
          {
            a: {
              props: {
                links: [
                  'screen:pricing',
                  'collection:blog',
                  'feed:blog',
                  '/blog/post1',
                  'https://example.com/entry:blog/post1',
                  'entry:blog',
                  'entry:blog/a/b',
                  'entry:/post1',
                ],
              },
            },
          },
        ],
        markdown: ['[x](entry:blog) and [y](/blog/post1)'],
      }),
    ).toEqual([])
  })

  it('reads props, not a node’s structure', () => {
    // Child ids and node ids are never link values, whatever they spell.
    expect(
      collectEntryLinkRefs({
        nodes: [{ 'entry:blog/x': { nodes: ['entry:blog/y'], props: {} } }],
      }),
    ).toEqual([])
  })

  it('tolerates absent sources and malformed trees', () => {
    expect(collectEntryLinkRefs({})).toEqual([])
    expect(
      collectEntryLinkRefs({
        nodes: [null, undefined, { a: null, b: { props: null } } as never],
        markdown: [null, undefined, ''],
      }),
    ).toEqual([])
  })

  it('stops at a depth budget instead of overflowing the stack', () => {
    let deep: Record<string, unknown> = { href: 'entry:blog/deep' }
    for (let level = 0; level < 5000; level++) deep = { next: deep }
    expect(() =>
      collectEntryLinkRefs({ nodes: [{ a: { props: deep } }] }),
    ).not.toThrow()
  })
})
