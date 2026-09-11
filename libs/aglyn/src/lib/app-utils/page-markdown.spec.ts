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
  buildPageMarkdown,
  escapeMarkdownText,
  headingLevelOf,
  pageContentRootId,
  type PageMarkdownNodes,
} from './page-markdown'

const ORIGIN = 'https://example.test'

/** A minimal page: root → main slot → children. */
function page(children: PageMarkdownNodes, childIds: string[]): PageMarkdownNodes {
  return {
    '_@_': { componentId: 'div', props: {}, nodes: ['slot'] },
    slot: { componentId: 'layoutSlot', props: { component: 'main' }, nodes: childIds },
    ...children,
  }
}

describe('headingLevelOf', () => {
  it('reads the level from the element', () => {
    expect(headingLevelOf({ component: 'h2' })).toBe(2)
    expect(headingLevelOf({ component: 'H3' })).toBe(3)
  })

  it('falls back to the type variant when no element was chosen', () => {
    expect(headingLevelOf({ variant: 'h1' })).toBe(1)
  })

  it('lets the ELEMENT overrule the variant — they mean different things', () => {
    // A hero line styled like an h1 but rendered as a `p` is not a heading, and
    // the Markdown has to agree with the HTML or the two describe different
    // pages.
    expect(headingLevelOf({ variant: 'h1', component: 'p' })).toBe(0)
    expect(headingLevelOf({ variant: 'body1', component: 'h2' })).toBe(2)
  })

  it('is 0 for body copy and for nothing at all', () => {
    expect(headingLevelOf({ variant: 'body1' })).toBe(0)
    expect(headingLevelOf(undefined)).toBe(0)
  })
})

describe('escapeMarkdownText', () => {
  it('escapes inline control characters', () => {
    expect(escapeMarkdownText('a * b _ c')).toBe('a \\* b \\_ c')
  })

  it('escapes a line-leading construct only at line start', () => {
    expect(escapeMarkdownText('# Not a heading')).toBe('\\# Not a heading')
    expect(escapeMarkdownText('a # b')).toBe('a # b')
    expect(escapeMarkdownText('- item')).toBe('\\- item')
    expect(escapeMarkdownText('1. item')).toBe('1\\. item')
  })
})

describe('pageContentRootId', () => {
  it('prefers the main landmark', () => {
    expect(pageContentRootId(page({}, []))).toBe('slot')
  })

  it('falls back to the layout slot when nothing carries the landmark', () => {
    expect(
      pageContentRootId({
        '_@_': { componentId: 'div', nodes: ['slot'] },
        slot: { componentId: 'layoutSlot', nodes: [] },
      }),
    ).toBe('slot')
  })

  it('falls back to the document root, then to nothing', () => {
    expect(pageContentRootId({ '_@_': { componentId: 'div' } })).toBe('_@_')
    expect(pageContentRootId({ orphan: { componentId: 'div' } })).toBeNull()
    expect(pageContentRootId(null)).toBeNull()
  })
})

describe('buildPageMarkdown', () => {
  it('emits the title, summary and source line', () => {
    expect(
      buildPageMarkdown({
        front: {
          title: 'Pricing',
          description: 'Plans and prices.',
          canonicalUrl: `${ORIGIN}/pricing`,
        },
      }),
    ).toBe('# Pricing\n\n> Plans and prices.\n\n---\n\nSource: https://example.test/pricing\n')
  })

  it('serializes headings and body copy from the node tree', () => {
    const nodes = page(
      {
        a: { componentId: 'muiTypography', props: { component: 'h2', children: 'Plans' } },
        b: { componentId: 'muiTypography', props: { children: 'Start free.' } },
      },
      ['a', 'b'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('## Plans\n\nStart free.\n')
  })

  it('starts at the content region, so site chrome never reaches the output', () => {
    const nodes: PageMarkdownNodes = {
      '_@_': { componentId: 'div', nodes: ['bar', 'slot'] },
      bar: { componentId: 'muiAppBar', nodes: ['navtext'] },
      navtext: { componentId: 'muiTypography', props: { children: 'Home' } },
      slot: { componentId: 'layoutSlot', props: { component: 'main' }, nodes: ['body'] },
      body: { componentId: 'muiTypography', props: { children: 'Real content' } },
    }
    expect(buildPageMarkdown({ nodes })).toBe('Real content\n')
  })

  it('skips chrome that sits INSIDE the content region', () => {
    const nodes = page(
      {
        nav: { componentId: 'navMenu', nodes: ['navtext'] },
        navtext: { componentId: 'muiTypography', props: { children: 'Menu' } },
        keep: { componentId: 'muiTypography', props: { children: 'Body' } },
      },
      ['nav', 'keep'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('Body\n')
  })

  it('honors an author element picker that says header, nav or footer', () => {
    const nodes = page(
      {
        foot: {
          componentId: 'muiStack',
          props: { component: 'footer' },
          nodes: ['foottext'],
        },
        foottext: { componentId: 'muiTypography', props: { children: 'Copyright' } },
        keep: { componentId: 'muiTypography', props: { children: 'Body' } },
      },
      ['foot', 'keep'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('Body\n')
  })

  it('recurses through containers it has never heard of', () => {
    // Silence is the one failure an author cannot see, so an unknown block
    // still contributes its text.
    const nodes = page(
      {
        weird: { componentId: 'somePluginBlock', nodes: ['inner'] },
        inner: { componentId: 'muiTypography', props: { children: 'Deep' } },
      },
      ['weird'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('Deep\n')
  })

  it('prefers a rich label over the plain fallback', () => {
    const nodes = page(
      {
        a: {
          componentId: 'muiTypography',
          props: { children: 'Bold claim', html: '<strong>Bold</strong> claim' },
        },
      },
      ['a'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('**Bold** claim\n')
  })

  it('emits a markdown block verbatim rather than re-escaping it', () => {
    const nodes = page(
      { md: { componentId: 'markdown', props: { content: '## Already markdown' } } },
      ['md'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('## Already markdown\n')
  })

  it('converts a custom HTML block', () => {
    const nodes = page(
      { raw: { componentId: 'custom-html', props: { html: '<h3>Raw</h3><p>Body</p>' } } },
      ['raw'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('### Raw\n\nBody\n')
  })

  it('resolves an image against the site origin', () => {
    const nodes = page(
      { img: { componentId: 'image', props: { src: '/api/media/cdn/a.png', alt: 'Chart' } } },
      ['img'],
    )
    expect(buildPageMarkdown({ nodes, context: { origin: ORIGIN } })).toBe(
      '![Chart](https://example.test/api/media/cdn/a.png)\n',
    )
  })

  it('resolves a screen link through the routing map the router honors', () => {
    /*
      A screen link stores a screen ID; the path publishing wrote is not always
      the path the router serves (AGL-1998). Reading `href` alone would publish
      the dead links that fix removed from the HTML.
    */
    const nodes = page(
      {
        link: {
          componentId: 'muiScreenLink',
          props: { screenId: 'sc1', href: '/blog-list-template', children: 'Blog' },
        },
      },
      ['link'],
    )
    expect(
      buildPageMarkdown({
        nodes,
        context: { origin: ORIGIN, screenRoutes: { sc1: 'blog' } },
      }),
    ).toBe('[Blog](https://example.test/blog)\n')
  })

  it('absolutizes a plain href that names no screen at all', () => {
    // Named for what the fixture actually holds: there is no `screenId` here,
    // so this proves the literal-href path and NOT the unresolved-screen one
    // the two cases below cover.
    const nodes = page(
      {
        link: {
          componentId: 'muiButton',
          props: { href: '/signup', children: 'Sign up' },
        },
      },
      ['link'],
    )
    expect(buildPageMarkdown({ nodes, context: { origin: ORIGIN } })).toBe(
      '[Sign up](https://example.test/signup)\n',
    )
  })

  it('resolves a `screen:<id>` value stored in the HREF slot (AGL-2740)', () => {
    /*
      The shape a `Link`-typed component prop writes (AGL-1335): the author
      picked a screen on a reusable CTA, and the graft put the stored value in
      whichever slot that component binds — here `href`. Reading `screenId`
      alone emitted the raw token as the link target, so every page built from
      that component published `[See pricing](screen:v0clP6xQl-)` to the agents
      `/llms.txt` points at.
    */
    const nodes = page(
      {
        cta: {
          componentId: 'muiButton',
          props: { href: 'screen:v0clP6xQl-', children: 'See pricing' },
        },
      },
      ['cta'],
    )
    const markdown = buildPageMarkdown({
      nodes,
      context: { origin: ORIGIN, screenRoutes: { 'v0clP6xQl-': 'pricing' } },
    })
    expect(markdown).toBe('[See pricing](https://example.test/pricing)\n')
    expect(markdown).not.toContain('screen:')
  })

  it('resolves a `screen:<id>` value in the SCREEN slot, and the root screen', () => {
    const nodes = page(
      {
        a: {
          componentId: 'muiScreenLink',
          props: { screenId: 'screen:sc1', children: 'Blog' },
        },
        b: {
          componentId: 'muiScreenLink',
          props: { screenId: 'screen:home', children: 'Home' },
        },
      },
      ['a', 'b'],
    )
    expect(
      buildPageMarkdown({
        nodes,
        context: { origin: ORIGIN, screenRoutes: { sc1: 'blog', home: '/' } },
      }),
    ).toBe('[Blog](https://example.test/blog)\n\n[Home](https://example.test/)\n')
  })

  it('emits the label alone when the authored screen has no route', () => {
    /*
      Parity with the HTML, which renders no href at all here (`useLinkTarget`
      returns the resolved value or nothing). Falling back to the stored `href`
      would republish the path AGL-1998 removed: `blog-list-template` is what
      publishing wrote, and the router serves that screen at `/blog` instead.
    */
    const nodes = page(
      {
        link: {
          componentId: 'muiScreenLink',
          props: {
            screenId: 'screen:retired',
            href: '/blog-list-template',
            children: 'Blog',
          },
        },
      },
      ['link'],
    )
    expect(
      buildPageMarkdown({
        nodes,
        context: { origin: ORIGIN, screenRoutes: { sc1: 'blog' } },
      }),
    ).toBe('Blog\n')
  })

  it('resolves a collection listing link from either slot (AGL-2799)', () => {
    /*
      A listing link stores the collection's id, and the map the router honors
      carries the listing under `collection:<id>`. The Markdown follows it the
      way the HTML does — including from the URL slot a component prop can put
      it in, which is the half a local reading of `screenId` would miss.
    */
    const nodes = page(
      {
        a: {
          componentId: 'muiScreenLink',
          props: { screenId: 'collection:blog', children: 'Blog' },
        },
        b: {
          componentId: 'muiButton',
          props: { href: 'collection:blog', children: 'Read the blog' },
        },
      },
      ['a', 'b'],
    )
    const markdown = buildPageMarkdown({
      nodes,
      context: {
        origin: ORIGIN,
        screenRoutes: { home: '/', 'collection:blog': 'blog' },
      },
    })
    expect(markdown).toBe(
      '[Blog](https://example.test/blog)\n\n[Read the blog](https://example.test/blog)\n',
    )
    expect(markdown).not.toContain('collection:')
  })

  it('emits the label alone when the linked collection is gone (AGL-2799)', () => {
    const nodes = page(
      {
        link: {
          componentId: 'muiScreenLink',
          props: { screenId: 'collection:gone', href: '/blog', children: 'Blog' },
        },
      },
      ['link'],
    )
    expect(
      buildPageMarkdown({
        nodes,
        context: { origin: ORIGIN, screenRoutes: { 'collection:blog': 'blog' } },
      }),
    ).toBe('Blog\n')
  })

  it('refuses a link target the page itself would refuse to render', () => {
    const nodes = page(
      {
        link: {
          componentId: 'muiButton',
          props: { href: 'javascript:alert(1)', children: 'Click' },
        },
      },
      ['link'],
    )
    expect(buildPageMarkdown({ nodes, context: { origin: ORIGIN } })).toBe('Click\n')
  })

  it('groups list items into one list rather than a run of paragraphs', () => {
    const nodes = page(
      {
        list: { componentId: 'muiList', nodes: ['i1', 'i2'] },
        i1: { componentId: 'muiListItem', nodes: ['t1'] },
        t1: { componentId: 'muiListItemText', props: { children: 'First' } },
        i2: { componentId: 'muiListItem', nodes: ['t2'] },
        t2: { componentId: 'muiListItemText', props: { children: 'Second' } },
      },
      ['list'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('- First\n- Second\n')
  })

  it('uses a supplied body instead of the node tree', () => {
    // The content-entry case: the stored body is already markdown-lite source.
    expect(
      buildPageMarkdown({
        nodes: page({ a: { componentId: 'muiTypography', props: { children: 'x' } } }, ['a']),
        body: '## Entry\n\nProse.',
        front: { title: 'Post' },
      }),
    ).toBe('# Post\n\n## Entry\n\nProse.\n')
  })

  it('emits a dateline for a content entry', () => {
    expect(
      buildPageMarkdown({
        body: 'Body',
        front: {
          title: 'Post',
          author: 'Ada Lovelace',
          publishedAt: '2026-09-01',
          updatedAt: '2026-09-05',
        },
      }),
    ).toBe('# Post\n\n_By Ada Lovelace · Published 2026-09-01 · Updated 2026-09-05_\n\nBody\n')
  })

  it('omits an updated date that repeats the published one', () => {
    expect(
      buildPageMarkdown({
        body: 'Body',
        front: { publishedAt: '2026-09-01', updatedAt: '2026-09-01' },
      }),
    ).toBe('_Published 2026-09-01_\n\nBody\n')
  })

  it('survives a node map whose children cycle back', () => {
    /*
      A node map is DATA — restorable from a backup, writable through the REST
      API — so a child that names its own ancestor is reachable. The renderer
      tolerates it; an unguarded recursion here would be a 500 on a page that
      renders fine.
    */
    const nodes: PageMarkdownNodes = {
      '_@_': { componentId: 'div', props: { component: 'main' }, nodes: ['a'] },
      a: { componentId: 'muiStack', nodes: ['b'] },
      b: { componentId: 'muiStack', nodes: ['a'] },
    }
    expect(() => buildPageMarkdown({ nodes })).not.toThrow()
    expect(buildPageMarkdown({ nodes })).toBe('\n')
  })

  it('returns a bare newline for a page with nothing to say', () => {
    expect(buildPageMarkdown({})).toBe('\n')
  })

  it('escapes author text that would otherwise re-parse as markdown', () => {
    const nodes = page(
      { a: { componentId: 'muiTypography', props: { children: '# Not a heading' } } },
      ['a'],
    )
    expect(buildPageMarkdown({ nodes })).toBe('\\# Not a heading\n')
  })
})
