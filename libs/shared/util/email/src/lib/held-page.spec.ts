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
  heldPageConsolePath,
  heldPageDetails,
  heldPageLabel,
  heldPageTargets,
  heldPageVisitorSentence,
  isOpenPageHoldStatus,
  pageHoldChip,
  parseHeldPageItemPath,
  type HeldPageSubject,
} from './held-page'

/**
 * A held or flagged page, named (AGL-3374). The row that started this said
 * "https://aglyn.com/" for a video ENTRY TEMPLATE, because the only name the
 * review had was the routing map's, and templates are not in it. Every kind
 * of page is named here by what it is and the route it serves.
 */

const subject = (overrides: Partial<HeldPageSubject>): HeldPageSubject => ({
  kind: 'screen',
  screenId: 'IhmjX3ymSg',
  versionId: 'v9',
  name: null,
  route: null,
  url: null,
  entryUrl: null,
  collectionName: null,
  variantName: null,
  source: null,
  visitorView: 'not-found',
  ...overrides,
})

describe('heldPageLabel', () => {
  it('names a page by its name and route', () => {
    expect(heldPageLabel(subject({ name: 'Pricing', route: '/pricing' }))).toBe(
      'the "Pricing" page (/pricing)',
    )
    expect(heldPageLabel(subject({ route: '/pricing' }))).toBe('the page /pricing')
    expect(heldPageLabel(subject({}))).toBe('a page on your site')
  })

  it('names a collection ENTRY template by its name and route pattern — never the site root', () => {
    const label = heldPageLabel(
      subject({
        kind: 'entry-template',
        name: 'Video detail',
        route: '/videos/:slug',
        collectionName: 'Videos',
        entryUrl: 'https://aglyn.com/videos/intro',
      }),
    )
    expect(label).toBe('the "Video detail" template (/videos/:slug)')
    expect(label).not.toContain('https://aglyn.com/')
    // Unnamed, it is still its collection's template.
    expect(
      heldPageLabel(subject({ kind: 'entry-template', route: '/videos/:slug', collectionName: 'Videos' })),
    ).toBe('the "Videos" entry template (/videos/:slug)')
  })

  it('names a collection LIST template by its name and listing route', () => {
    expect(
      heldPageLabel(subject({ kind: 'list-template', name: 'Blog list', route: '/blog' })),
    ).toBe('the "Blog list" list template (/blog)')
    expect(
      heldPageLabel(subject({ kind: 'list-template', route: '/blog', collectionName: 'Blog' })),
    ).toBe('the "Blog" list template (/blog)')
  })

  it('names an experiment variant and the page it belongs to', () => {
    expect(
      heldPageLabel(subject({ kind: 'variant', name: 'Pricing', route: '/pricing', variantName: 'B' })),
    ).toBe('variant "B" of the "Pricing" page (/pricing)')
    expect(heldPageLabel(subject({ kind: 'variant', name: 'Pricing', route: '/pricing' }))).toBe(
      'an experiment variant of the "Pricing" page (/pricing)',
    )
  })

  it('names an error page', () => {
    expect(heldPageLabel(subject({ kind: 'error-screen', name: 'Not found' }))).toBe(
      'the "Not found" error page',
    )
  })

  it('keeps an author’s name to one line and one pair of quotes', () => {
    expect(heldPageLabel(subject({ name: '  Say "hi"\n  now ', route: '/hi' }))).toBe(
      'the "Say ”hi” now" page (/hi)',
    )
  })
})

describe('heldPageDetails', () => {
  it('says which entry an entry template was showing', () => {
    expect(
      heldPageDetails(
        subject({ kind: 'entry-template', route: '/videos/:slug', entryUrl: 'https://aglyn.com/videos/intro' }),
      ),
    ).toEqual(['Found while showing https://aglyn.com/videos/intro.'])
  })

  it('names the LAYOUT or COMPONENT the flagged content lives in, and how many pages use it', () => {
    expect(
      heldPageDetails(
        subject({
          name: 'About',
          route: '/about',
          url: 'https://acme.aglyn.site/about',
          source: { type: 'layout', id: 'main', name: 'Main', pagesUsing: 12 },
        }),
      ),
    ).toEqual([
      'Address: https://acme.aglyn.site/about.',
      'The flagged content is in the layout "Main", used on 12 pages, not on the page itself.',
    ])
    expect(
      heldPageDetails(subject({ source: { type: 'component', id: 'hdr', name: 'Header', pagesUsing: 1 } })),
    ).toEqual(['The flagged content is in the component "Header", used on 1 page, not on the page itself.'])
    expect(
      heldPageDetails(subject({ source: { type: 'component', id: 'hdr', name: null, pagesUsing: null } })),
    ).toEqual(['The flagged content is in a component, not on the page itself.'])
  })
})

describe('what visitors see', () => {
  it.each([
    ['live', 'Visitors still see this page while it is reviewed.'],
    ['previous-version', 'Visitors see the previous version of this page until the review is done.'],
    ['not-found', 'Visitors see a not-found page until the review is done.'],
    ['built-in-design', 'Visitors see the site’s built-in design for these pages until the review is done.'],
    ['published-version', 'Visitors in this variant see the page’s published version until the review is done.'],
  ] as const)('%s', (visitorView, sentence) => {
    expect(heldPageVisitorSentence({ visitorView })).toBe(sentence)
  })
})

describe('where the owner fixes it', () => {
  it('opens the held version of the page, template or variant', () => {
    expect(heldPageConsolePath(subject({ kind: 'entry-template' }), 'DXnRbPH4CQ')).toBe(
      '/DXnRbPH4CQ/screens/IhmjX3ymSg/versions/v9/view',
    )
  })

  it('opens the layout or component when that is where the content lives', () => {
    const layout = subject({ source: { type: 'layout', id: 'main', name: 'Main', pagesUsing: 3 } })
    expect(heldPageConsolePath(layout, 'h')).toBe('/h/layouts/main')
    expect(heldPageTargets(layout)).toEqual([
      { type: 'screen', id: 'IhmjX3ymSg' },
      { type: 'layout', id: 'main' },
    ])
    const component = subject({ source: { type: 'component', id: 'hdr', name: null, pagesUsing: null } })
    expect(heldPageConsolePath(component, 'h')).toBe('/h/components/hdr')
  })

  it('reads the page back out of a notice written before notices described it', () => {
    expect(parseHeldPageItemPath('/DXnRbPH4CQ/screens/IhmjX3ymSg/versions/v9/view')).toEqual({
      screenId: 'IhmjX3ymSg',
      versionId: 'v9',
    })
    expect(parseHeldPageItemPath('/org/emails/messages/x')).toBeNull()
    expect(parseHeldPageItemPath(null)).toBeNull()
  })
})

describe('the status chip', () => {
  it('says held, flagged-and-live, or not approved — and nothing that reads as a release', () => {
    expect(pageHoldChip('page-held', 'held')).toEqual({ label: 'Held for review', color: 'warning' })
    expect(pageHoldChip('page-held', 'in-review')).toEqual({ label: 'Held for review', color: 'warning' })
    expect(pageHoldChip('page-flagged', 'in-review')).toEqual({
      label: 'Flagged — live, under review',
      color: 'info',
    })
    expect(pageHoldChip('page-held', 'rejected')).toEqual({ label: 'Not approved', color: 'error' })
  })

  it('shows only what is still open', () => {
    expect(isOpenPageHoldStatus('held')).toBe(true)
    expect(isOpenPageHoldStatus('in-review')).toBe(true)
    expect(isOpenPageHoldStatus('rejected')).toBe(true)
    expect(isOpenPageHoldStatus('released')).toBe(false)
    expect(isOpenPageHoldStatus('closed')).toBe(false)
    expect(isOpenPageHoldStatus(null)).toBe(false)
  })
})
