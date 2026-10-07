/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import type { AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiLayoutFrameCheck, aiLayoutFrameTargets, aiLayoutHomeId, aiLayoutNavPages } from './ai-job-layout-language'
import { AI_LAYOUT_SITE_PAGES_INPUT, aiLayoutSitePagesOfPlan } from './ai-job-layout-site-pages'

/** The guided start's plan as the e2e run kept it: its Home marked `nav: false`. */
const SCREENS = [
  { id: 'rlv3yk2I46', title: 'Home', slug: '/', nav: false, record: null },
  { id: 'Fw0B612Zew', title: 'Contact', slug: '/contact', nav: true, record: null },
  { id: 'tmplRecord', title: 'Dog', slug: '/dogs', nav: true, record: { datasetId: 'dogs' } },
] as unknown as AiBuildPlanScreen[]

const job = {
  $id: 'job-frame',
  brief: 'A 2-page website for a dog groomer in Austin.',
  inputs: { businessName: 'Hillside Dog Grooming', [AI_LAYOUT_SITE_PAGES_INPUT]: aiLayoutSitePagesOfPlan(SCREENS) },
} as unknown as AiJob

/** Every string a node map holds, as the e2e's `linksTo` reads a layout for a page's id. */
function linked(nodes: unknown, id: string): boolean {
  const strings: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(nodes)
  return strings.includes(id)
}

describe('a frame links every page the site builds, whatever its answer says (AGL-3660)', () => {
  it('puts every planned page in the navigation, the home page first, record templates aside', () => {
    expect(aiLayoutSitePagesOfPlan(SCREENS).map((page) => page.id)).toEqual(['rlv3yk2I46', 'Fw0B612Zew'])
    const pages = aiLayoutNavPages(job, emptyAiSiteInventory('host-1'))
    expect(pages.map((page) => [page.label, page.slug])).toEqual([
      ['Home', '/'],
      ['Contact', '/contact'],
    ])
  })

  it('links Home and Contact from the header, the brand and the footer when the answer leaves Home out', () => {
    const inventory = emptyAiSiteInventory('host-1')
    const pages = aiLayoutNavPages(job, inventory)
    const check = aiLayoutFrameCheck({
      siteName: 'Hillside Dog Grooming',
      homeId: aiLayoutHomeId(pages, inventory),
      pages,
      targets: aiLayoutFrameTargets(job, inventory),
      extend: () => [],
    })
    const item = (title: string, to: string) => ({ title, text: '', to })
    const result = check({
      header: { band: 'plain', align: 'start', cols: [], blocks: [{ kind: 'button', col: -1, text: 'Get in Touch', to: 'page:Fw0B612Zew', icon: '', style: 'primary', items: [] }] },
      footer: {
        band: 'soft',
        align: 'start',
        cols: [2, 1],
        blocks: [
          { kind: 'text', col: 0, text: 'Gentle grooming for Austin dogs.', to: '', icon: '', style: 'none', items: [] },
          // The answer's own links name only Contact.
          { kind: 'list', col: 1, text: '', to: '', icon: '', style: 'none', items: [item('Contact', 'page:Fw0B612Zew')] },
        ],
      },
    })
    expect(result.violations).toEqual([])
    const nodes = Object.values(result.value?.nodes ?? {}) as Array<{ componentId: string; props?: Record<string, unknown> }>
    const links = nodes.filter((node) => node.componentId === 'muiScreenLink').map((node) => [node.props?.['children'], node.props?.['screenId']])
    // The brand goes home; the header's navigation, the phone menu and the footer each link Home and Contact.
    expect(links).toContainEqual(['Hillside Dog Grooming', 'rlv3yk2I46'])
    expect(links.filter(([label]) => label === 'Home')).toHaveLength(3)
    expect(links.filter(([label]) => label === 'Contact')).toHaveLength(3)
    expect(linked(result.value?.nodes, 'rlv3yk2I46')).toBe(true)
    expect(linked(result.value?.nodes, 'Fw0B612Zew')).toBe(true)
  })
})
