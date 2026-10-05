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
 * The SEO check's findings and scores, against fixture pages built from real
 * node maps: every finding it makes, and the findings it must NOT make — a
 * home page is never an orphan, a keyword the page says is never reported
 * missing.
 */

import {
  parseSeoKeywordLines,
  readSeoKeywordLines,
  seoAudit,
  seoAuditFindingCount,
  seoNormalizePath,
  type SeoAuditPage,
} from './seo-audit'
import { seoPageFacts } from './seo-page-facts'

type NodeMap = Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }>

/** A page body: a document root, a `main` region, and the given children in it. */
function body(children: NodeMap): NodeMap {
  return {
    root: { componentId: 'div', nodes: ['nav', 'main'] },
    // Navigation is chrome: its heading must not count as the page's.
    nav: { componentId: 'section', props: { component: 'nav' }, nodes: ['navHeading'] },
    navHeading: { componentId: 'muiTypography', props: { variant: 'h1', children: 'Acme' }, nodes: [] },
    main: { componentId: 'section', props: { component: 'main' }, nodes: Object.keys(children) },
    ...children,
  }
}

const heading = (level: number, text: string) => ({
  componentId: 'muiTypography',
  props: { variant: `h${level}`, children: text },
  nodes: [] as string[],
})
const paragraph = (text: string) => ({ componentId: 'muiTypography', props: { variant: 'body1', children: text }, nodes: [] as string[] })

function page(
  screenId: string,
  path: string,
  nodes: NodeMap,
  patch: Partial<SeoAuditPage> = {},
): SeoAuditPage {
  return {
    screenId,
    path,
    name: screenId,
    versionId: `${screenId}-v1`,
    seo: {},
    description: '',
    facts: seoPageFacts(nodes, { rootId: 'root' }),
    linkedFrom: true,
    keywords: [],
    ...patch,
  }
}

const HOME = page(
  'home',
  '/',
  body({ h: heading(1, 'Brass desk lamps made to order'), p: paragraph('Hand-finished in Austin.') }),
  {
    seo: { title: 'Acme Lamps — brass desk lamps made to order', description: 'Brass desk lamps, made to order.' },
    linkedFrom: false,
  },
)
const LAMPS = page(
  'lamps',
  '/lamps',
  body({
    h: heading(2, 'Our lamps'),
    img: { componentId: 'image', props: { src: 'media:host-1/lamp' }, nodes: [] },
    p: paragraph('Every lamp is dimmable and finished by hand.'),
  }),
  {
    seo: { title: 'Lamps', description: 'The lamps we make.' },
    keywords: ['dimmable', 'floor lamps'],
  },
)
const ABOUT = page('about', '/about', body({ h: heading(1, 'About'), p: paragraph('We are Acme.') }), {
  seo: { title: 'lamps', description: 'The lamps we make.' },
})
const OFFER = page(
  'offer',
  '/offer',
  body({ a: heading(1, 'Spring offer on brass lamps'), b: heading(1, 'Order by May') }),
  { seo: { title: 'x'.repeat(61) }, linkedFrom: false },
)

const site = { discouraged: false, entity: { name: 'Acme', description: '' }, agent: { whenToUse: '' } }

const codes = (report: ReturnType<typeof seoAudit>, screenId: string) =>
  report.pages.find((entry) => entry.screenId === screenId)?.findings.map((entry) => entry.code)

describe('seoAudit, page by page', () => {
  const report = seoAudit([HOME, LAMPS, ABOUT, OFFER], site)

  it('finds nothing on a page that has what a search result needs', () => {
    expect(codes(report, 'home')).toEqual([])
    expect(report.pages[0].score).toBe(100)
  })

  it('finds titles and descriptions two pages share, and names the twin', () => {
    const lamps = report.pages.find((entry) => entry.screenId === 'lamps')
    expect(lamps?.findings.find((entry) => entry.code === 'title-duplicate')).toMatchObject({
      severity: 'high',
      screenIds: ['about'],
    })
    expect(lamps?.findings.find((entry) => entry.code === 'description-duplicate')?.screenIds).toEqual(['about'])
  })

  it('finds a page with no main heading, and does not count the navigation’s', () => {
    expect(codes(report, 'lamps')).toContain('h1-missing')
  })

  it('finds a main heading that says little, and a page with more than one', () => {
    expect(codes(report, 'about')).toContain('h1-thin')
    const offer = report.pages.find((entry) => entry.screenId === 'offer')
    expect(offer?.findings.find((entry) => entry.code === 'h1-multiple')?.nodeIds).toEqual(['b'])
  })

  it('does not judge a main heading made of a token by what it says', () => {
    const bound = seoAudit([page('bound', '/bound', body({ t: heading(1, '{{item.name}}') }))], site)
    expect(codes(bound, 'bound')).not.toContain('h1-thin')
    expect(codes(bound, 'bound')).not.toContain('h1-missing')
  })

  it('names an element once when several of its copies are found (AGL-3501)', () => {
    const facts = seoPageFacts(
      {
        root: { componentId: 'div', nodes: ['main'] },
        main: { componentId: 'section', props: { component: 'main' }, nodes: ['a', 'rep__list__0__b', 'rep__list__1__b'] },
        a: heading(1, 'Roofing in Ohio, done right'),
        list: { componentId: 'muiStack', props: { repeatDataset: 'services' }, nodes: ['b'] },
        b: heading(1, '{{item.name}}'),
        rep__list__0__b: heading(1, 'Roof repair'),
        rep__list__1__b: heading(1, 'Siding'),
      } as NodeMap,
      {
        rootId: 'root',
        pageNodes: {
          root: { componentId: 'div', nodes: ['main'] },
          main: { componentId: 'section', props: { component: 'main' }, nodes: ['a', 'list'] },
          a: heading(1, 'Roofing in Ohio, done right'),
          list: { componentId: 'muiStack', props: { repeatDataset: 'services' }, nodes: ['b'] },
          b: heading(1, '{{item.name}}'),
        },
      },
    )
    const report = seoAudit([page('services', '/services', {}, { facts })], site)
    const multiple = report.pages[0].findings.find((entry) => entry.code === 'h1-multiple')
    expect(multiple?.message).toContain('3 main headings')
    expect(multiple?.nodeIds).toEqual(['b'])
  })

  it('finds images without a description, by node', () => {
    const lamps = report.pages.find((entry) => entry.screenId === 'lamps')
    expect(lamps?.findings.find((entry) => entry.code === 'image-alt-missing')?.nodeIds).toEqual(['img'])
  })

  it('finds a page nothing links to — and never the home page', () => {
    expect(codes(report, 'offer')).toContain('orphan')
    expect(codes(report, 'home')).not.toContain('orphan')
  })

  it('finds a title past its length, and a missing description', () => {
    expect(codes(report, 'offer')).toEqual(expect.arrayContaining(['title-too-long', 'description-missing']))
  })

  it('reports a keyword the page never says, and not one it does', () => {
    const lamps = report.pages.find((entry) => entry.screenId === 'lamps')
    const missing = lamps?.findings.filter((entry) => entry.code === 'keyword-missing').map((entry) => entry.keyword)
    expect(missing).toEqual(['floor lamps'])
    expect(lamps?.keywords).toEqual([
      { keyword: 'dimmable', inTitle: false, inDescription: false, inH1: false, inBody: true },
      { keyword: 'floor lamps', inTitle: false, inDescription: false, inH1: false, inBody: false },
    ])
  })

  it('scores each page by severity, and the site by the average', () => {
    expect(report.pages.every((entry) => entry.score >= 0 && entry.score <= 100)).toBe(true)
    expect(report.score).toBe(
      Math.round(report.pages.reduce((sum, entry) => sum + entry.score, 0) / report.pages.length),
    )
    expect(seoAuditFindingCount(report)).toBe(
      report.pages.reduce((sum, entry) => sum + entry.findings.length, report.site.length),
    )
  })
})

describe('seoAudit, the site', () => {
  it('says when search engines are discouraged, and when the structured data or agent guidance is missing', () => {
    const report = seoAudit([HOME], { ...site, discouraged: true })
    expect(report.site.map((entry) => entry.code)).toEqual([
      'search-discouraged',
      'entity-incomplete',
      'llms-guidance-missing',
    ])
  })

  it('finds nothing about a site that has both', () => {
    const report = seoAudit([HOME], {
      discouraged: false,
      entity: { name: 'Acme', description: 'Acme makes lamps.' },
      agent: { whenToUse: 'Lamp questions.' },
    })
    expect(report.site).toEqual([])
  })

  it('says what it skipped, carries the scan’s notes, and scores an empty site as nothing to fix', () => {
    const report = seoAudit([], site, { skipped: 3, notes: ['A note.'] })
    expect(report).toMatchObject({ pages: [], skipped: 3, score: 100, notes: ['A note.'] })
  })
})

describe('the check’s helpers', () => {
  it('reads keyword lines by page path, whatever slashes they were typed with', () => {
    expect(parseSeoKeywordLines('/lamps: brass lamps, dimmable\nabout/ : acme\nno path here\n: orphan')).toEqual({
      '/lamps': ['brass lamps', 'dimmable'],
      '/about': ['acme'],
    })
    expect(seoNormalizePath('')).toBe('/')
    expect(seoNormalizePath('//a/b/')).toBe('/a/b')
  })

  it('holds a page to five keywords across its lines, and keeps the rest to name (AGL-3501)', () => {
    expect(readSeoKeywordLines('/lamps: a, b, c\nlamps: c, d, e, f\n/about: acme')).toEqual({
      keywords: { '/lamps': ['a', 'b', 'c', 'd', 'e'], '/about': ['acme'] },
      unchecked: { '/lamps': ['f'] },
    })
  })
})
