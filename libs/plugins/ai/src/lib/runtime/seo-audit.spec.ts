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
 * What a site audit job adds to the platform's SEO check (AGL-2910): the
 * pages it queues for generated fixes and in what order, whether the
 * site-wide proposal is owed, the batches, and the heading fixes that need
 * no model. The findings themselves are the check's, proved in
 * `@aglyn/aglyn/app-utils/seo-audit.spec.ts`.
 */

import type { SeoAuditPage } from '@aglyn/aglyn/app-utils/seo-audit'
import { seoPageFacts } from '@aglyn/aglyn/app-utils/seo-page-facts'
import { aiSeoAudit, aiSeoAuditBatches, aiSeoHeadingDemotions } from './seo-audit'

type NodeMap = Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }>

function body(children: NodeMap): NodeMap {
  return {
    root: { componentId: 'div', nodes: ['main'] },
    main: { componentId: 'section', props: { component: 'main' }, nodes: Object.keys(children) },
    ...children,
  }
}

const heading = (level: number, text: string) => ({
  componentId: 'muiTypography',
  props: { variant: `h${level}`, children: text },
  nodes: [],
})

function page(screenId: string, path: string, nodes: NodeMap, patch: Partial<SeoAuditPage> = {}): SeoAuditPage {
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

const HOME = page('home', '/', body({ h: heading(1, 'Brass desk lamps made to order') }), {
  seo: { title: 'Acme Lamps — brass desk lamps made to order', description: 'Brass desk lamps, made to order.' },
})
// No heading, no listing: the worst page.
const LAMPS = page('lamps', '/lamps', body({ h: heading(2, 'Our lamps') }))
// Only an extra heading and no link: nothing a model writes.
const OFFER = page(
  'offer',
  '/offer',
  body({ a: heading(1, 'Spring offer on brass lamps'), b: heading(1, 'Order by May') }),
  { seo: { title: 'Spring offer', description: 'Brass lamps on offer this spring.' }, linkedFrom: false },
)
const ABOUT = page('about', '/about', body({ h: heading(1, 'About') }), {
  seo: { title: 'About Acme', description: 'Who makes the lamps.' },
})

const site = { discouraged: false, entity: { name: 'Acme', description: '' }, agent: { whenToUse: '' } }

describe('aiSeoAudit', () => {
  const report = aiSeoAudit([HOME, LAMPS, OFFER, ABOUT], site)

  it('carries the SEO check’s findings as they are', () => {
    expect(report.kind).toBe('audit')
    expect(report.pages.find((entry) => entry.screenId === 'offer')?.findings.map((entry) => entry.code)).toEqual([
      'h1-multiple',
      'orphan',
    ])
  })

  it('queues the pages generated text can fix, the worst first, and never one it cannot', () => {
    expect(report.queue).toEqual(['lamps', 'about'])
    expect(report.batchSize).toBe(8)
  })

  it('owes the site-wide proposal only while the structured data or the guidance is missing', () => {
    expect(report.siteProposal).toBe(true)
    const complete = aiSeoAudit([HOME], {
      discouraged: true,
      entity: { name: 'Acme', description: 'Acme makes lamps.' },
      agent: { whenToUse: 'Lamp questions.' },
    })
    expect(complete.site.map((entry) => entry.code)).toEqual(['search-discouraged'])
    expect(complete.siteProposal).toBe(false)
  })

  it('audits an empty site as nothing to queue', () => {
    expect(aiSeoAudit([], site, { skipped: 3 })).toMatchObject({ pages: [], skipped: 3, queue: [], score: 100 })
  })
})

describe('the audit’s helpers', () => {
  it('splits the queue into batches of its size', () => {
    expect(aiSeoAuditBatches({ queue: ['a', 'b', 'c', 'd', 'e'], batchSize: 2 })).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('demotes every main heading after the first editable one', () => {
    expect(aiSeoHeadingDemotions(OFFER.facts)).toEqual([{ kind: 'h1-demote', nodeId: 'b' }])
    expect(aiSeoHeadingDemotions(ABOUT.facts)).toEqual([])
  })
})
