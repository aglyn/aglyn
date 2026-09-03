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
 * The built-in author page body (AGL-2518).
 *
 * This is what EVERY site renders until it designates a screen, so it is not
 * the fallback path in the sense of a rare one — it is the default. It had no
 * spec, which meant the page most sites will actually serve was the least
 * covered thing in the feature.
 */

import * as Aglyn from '@aglyn/aglyn/server'
import buildAuthorPageNodes from './author-page-nodes'

const author: Aglyn.ContentAuthorRecord = {
  $id: 'a1',
  slug: 'zg',
  name: 'Zach Gover',
  bio: 'Building the open web platform.',
  image: 'media:host-1/portrait',
  jobTitle: 'Founder',
  worksFor: 'Aglyn',
  links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
}

const build = (over: Partial<Parameters<typeof buildAuthorPageNodes>[0]> = {}) =>
  buildAuthorPageNodes({
    slug: 'zg',
    name: 'Zach Gover',
    author,
    hasEntries: true,
    page: 1,
    perPage: 10,
    totalPages: 1,
    ...over,
  })

const byComponent = (nodes: Record<string, any>, componentId: string) =>
  Object.values(nodes).filter((node) => node?.componentId === componentId)

describe('the built-in author page (AGL-2518)', () => {
  it('draws the person from the record, with no token left to resolve', () => {
    // The record is in hand here, unlike a designed template where the block
    // is placed long before any author is routed through it — so the props
    // are set outright rather than left to `expandContentAuthorProfile`.
    const profile = byComponent(
      build(),
      Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
    )
    expect(profile).toHaveLength(1)
    expect(profile[0].props).toEqual({
      name: 'Zach Gover',
      bio: 'Building the open web platform.',
      image: 'media:host-1/portrait',
      jobTitle: 'Founder',
      worksFor: 'Aglyn',
      links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
    })
  })

  it('omits a field the record does not carry rather than emptying it', () => {
    // An absent key lets the component's own fallback apply; an empty string
    // would be an authored value that beats it.
    const profile = byComponent(
      build({ author: { name: 'Ada' }, name: 'Ada' }),
      Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
    )
    expect(profile[0].props).toEqual({ name: 'Ada' })
  })

  it('takes the byline from the ROUTE, not from the record', () => {
    // `content.name` has already resolved the record, the legacy byline and
    // the raw segment in that order, so the builder must not re-derive it —
    // two answers to one question is how a page ends up captioned differently
    // from the archive it is showing.
    const profile = byComponent(
      build({ author: { name: 'Stale Name' }, name: 'Zach Gover' }),
      Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
    )
    expect(profile[0].props.name).toBe('Zach Gover')
  })

  it('names an unknown author from the segment', () => {
    // An empty archive, not a crash, and not a page with a blank heading.
    const nodes = build({
      author: null,
      name: 'nobody',
      slug: 'nobody',
      hasEntries: false,
    })
    const profile = byComponent(
      nodes,
      Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
    )
    expect(profile[0].props.name).toBe('nobody')
    const copy = Object.values(nodes)
      .map((node: any) => String(node?.props?.children ?? ''))
      .join(' ')
    expect(copy).toContain('nobody hasn’t published anything yet.')
  })

  it('renders no entries block for an author with nothing published', () => {
    // A Collection entries block with an empty source renders zero rows, so
    // the page would otherwise be a heading over nothing.
    const nodes = build({ hasEntries: false })
    expect(
      byComponent(nodes, Aglyn.COLLECTION_ENTRIES_COMPONENT_ID),
    ).toHaveLength(0)
  })

  it('pins the window the loader already computed', () => {
    // The routed "collection" here is synthetic, so the block cannot inherit
    // a page from it the way a real listing does.
    const [entries] = byComponent(
      build({ page: 2, perPage: 5 }),
      Aglyn.COLLECTION_ENTRIES_COMPONENT_ID,
    )
    expect(entries.props).toMatchObject({ page: 2, perPage: 5 })
  })

  it('labels each card with the collection its post came from', () => {
    // The one thing a single-collection listing never has to say and a
    // cross-collection one always does.
    const copy = Object.values(build())
      .map((node: any) => String(node?.props?.children ?? ''))
      .join(' ')
    expect(copy).toContain('{{entry.collection}}')
    expect(copy).toContain('{{entry.title}}')
    // Each token in its OWN node. A `·` written into the template is a
    // literal while the tokens beside it are not, so an entry with no
    // published date would render the separator dangling.
    expect(copy).not.toContain('·')
    // Built from the entry's OWN collection, which is what makes a mixed
    // listing's links resolve — and it lives in the href, not the label.
    const hrefs = Object.values(build())
      .map((node: any) => String(node?.props?.href ?? ''))
      .filter(Boolean)
    expect(hrefs).toContain('{{entry.url}}')
  })

  it('owns exactly one h1, and gives the listing an h2 under it', () => {
    // The Author Profile block renders the page's h1 (the person IS the
    // subject), so the heading above the posts must not compete with it.
    const nodes = build()
    const headings = Object.values(nodes)
      .filter((node: any) => node?.componentId === 'muiTypography')
      .map((node: any) => node.props?.component)
      .filter(Boolean)
    expect(headings).not.toContain('h1')
    expect(headings).toContain('h2')
  })

  it('pages through the author’s own address', () => {
    const nodes = build({ page: 2, totalPages: 3 })
    const hrefs = Object.values(nodes)
      .filter((node: any) => node?.componentId === 'muiScreenLink')
      .map((node: any) => node.props?.href)
    expect(hrefs).toContain('/author/zg')
    expect(hrefs).toContain('/author/zg/page/3')
  })

  it('emits no pager at all on a single page', () => {
    // Rather than one with two dead links: the shared pager resolves its
    // edges to the empty string, which a designed template needs but a body
    // that can simply omit the markup does not.
    const nodes = build({ totalPages: 1 })
    const copy = Object.values(nodes)
      .map((node: any) => String(node?.props?.children ?? ''))
      .join(' ')
    expect(copy).not.toContain('Newer')
    expect(copy).not.toContain('Older')
  })

  it('pages an unknown author by the segment they were addressed with', () => {
    // No record to build a canonical URL from, so the raw segment is the only
    // address there is — and it must still page rather than dead-end.
    const nodes = build({ author: null, name: 'ada', slug: 'ada', totalPages: 2 })
    const hrefs = Object.values(nodes)
      .filter((node: any) => node?.componentId === 'muiScreenLink')
      .map((node: any) => node.props?.href)
    expect(hrefs).toContain('/author/ada/page/2')
  })

  it('roots a well-formed tree that composition can graft', () => {
    const nodes = build()
    expect(nodes[Aglyn.NODE_ROOT_ID]).toBeTruthy()
    for (const [id, node] of Object.entries(nodes)) {
      expect([id, node.$id]).toEqual([id, id])
      // Every child id a node names must exist, or the graft drops markup
      // silently.
      for (const childId of (node as any).nodes ?? []) {
        expect([id, childId, Boolean(nodes[childId])]).toEqual([
          id,
          childId,
          true,
        ])
      }
      // Every node but the root names a parent that exists.
      if (id !== Aglyn.NODE_ROOT_ID) {
        expect([id, Boolean(nodes[(node as any).parentId])]).toEqual([id, true])
      }
    }
  })

  it('keeps its synthetic ids out of every authored id space', () => {
    // Never persisted, and the prefix is what stops one colliding with a node
    // an author actually created.
    for (const id of Object.keys(build())) {
      if (id === Aglyn.NODE_ROOT_ID) continue
      expect([id, id.startsWith('apx__')]).toEqual([id, true])
    }
  })
})
