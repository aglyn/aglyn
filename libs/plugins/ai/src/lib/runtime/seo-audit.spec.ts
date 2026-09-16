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
 * The site SEO audit's scoring (AGL-2910), against fixture pages built from
 * real node maps: every finding the audit makes, the pages it asks a model to
 * fix and in what order, and the findings it must NOT make — a home page is
 * never an orphan, a keyword the page says is never reported missing.
 */

import { aiSeoPageFacts } from './seo-page-facts'
import {
  aiSeoAudit,
  aiSeoAuditBatches,
  aiSeoHeadingDemotions,
  aiSeoNormalizePath,
  parseAiSeoKeywordLines,
  type AiSeoAuditPage,
} from './seo-audit'

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
  nodes: [],
})
const paragraph = (text: string) => ({ componentId: 'muiTypography', props: { variant: 'body1', children: text }, nodes: [] })

function page(
  screenId: string,
  path: string,
  nodes: NodeMap,
  patch: Partial<AiSeoAuditPage> = {},
): AiSeoAuditPage {
  return {
    screenId,
    path,
    name: screenId,
    versionId: `${screenId}-v1`,
    seo: {},
    description: '',
    facts: aiSeoPageFacts(nodes, { rootId: 'root' }),
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

const codes = (report: ReturnType<typeof aiSeoAudit>, screenId: string) =>
  report.pages.find((entry) => entry.screenId === screenId)?.findings.map((entry) => entry.code)

describe('aiSeoAudit, page by page', () => {
  const report = aiSeoAudit([HOME, LAMPS, ABOUT, OFFER], site)

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

  it('scores by severity and queues the worst pages first for generated fixes', () => {
    expect(report.pages.every((entry) => entry.score >= 0 && entry.score <= 100)).toBe(true)
    expect(report.queue[0]).toBe('lamps')
    expect(report.queue).not.toContain('home')
    expect(report.score).toBe(
      Math.round(report.pages.reduce((sum, entry) => sum + entry.score, 0) / report.pages.length),
    )
  })
})

describe('aiSeoAudit, the site', () => {
  it('says when search engines are discouraged, and when the structured data or agent guidance is missing', () => {
    const report = aiSeoAudit([HOME], { ...site, discouraged: true })
    expect(report.site.map((entry) => entry.code)).toEqual([
      'search-discouraged',
      'entity-incomplete',
      'llms-guidance-missing',
    ])
    expect(report.siteProposal).toBe(true)
  })

  it('owes no site-wide proposal once the site has both', () => {
    const report = aiSeoAudit([HOME], {
      discouraged: false,
      entity: { name: 'Acme', description: 'Acme makes lamps.' },
      agent: { whenToUse: 'Lamp questions.' },
    })
    expect(report.site).toEqual([])
    expect(report.siteProposal).toBe(false)
  })

  it('says what it skipped, and audits an empty site as nothing to fix', () => {
    const report = aiSeoAudit([], site, { skipped: 3 })
    expect(report).toMatchObject({ pages: [], skipped: 3, queue: [], score: 100 })
  })
})

describe('the audit’s helpers', () => {
  it('splits the queue into batches of its size', () => {
    expect(aiSeoAuditBatches({ queue: ['a', 'b', 'c', 'd', 'e'], batchSize: 2 })).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('reads keyword lines by page path, whatever slashes they were typed with', () => {
    expect(parseAiSeoKeywordLines('/lamps: brass lamps, dimmable\nabout/ : acme\nno path here\n: orphan')).toEqual({
      '/lamps': ['brass lamps', 'dimmable'],
      '/about': ['acme'],
    })
    expect(aiSeoNormalizePath('')).toBe('/')
    expect(aiSeoNormalizePath('//a/b/')).toBe('/a/b')
  })

  it('demotes every main heading after the first editable one', () => {
    expect(aiSeoHeadingDemotions(OFFER.facts)).toEqual([{ kind: 'h1-demote', nodeId: 'b' }])
    expect(aiSeoHeadingDemotions(ABOUT.facts)).toEqual([])
  })
})
