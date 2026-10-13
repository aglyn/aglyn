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

import type { AiBuildPlan } from '../model/ai-build-plan'
import { aiUnrestrictedPlanCapabilities, type AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { AI_SITE_EMPTY_GALLERY_CODE, AI_SITE_GALLERY_MIN_ITEMS, aiSiteEmptyGalleryViolations } from '../model/ai-site-job'
import { aiDoctrinePlanCheck } from './ai-doctrine'
import { aiSettlePlanGalleries } from './ai-doctrine-validators'

/*
 * A site start's section that shows the work is given its fewest pieces in
 * code (AGL-3754), rather than re-asked under `plan-empty-gallery`, whose one
 * answer is "plan it with three to six items".
 */

type Section = AiBuildPlan['screens'][number]['sections'][number]
const section = (name: string, items = 0, uses: string[] = []): Section => ({ name, uses, items })

const page = (title: string, slug: string, sections: Section[]): AiBuildPlan['screens'][number] => ({
  title,
  slug,
  layout: 'new:Site layout',
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: `${title} | Juniper Clay`,
  seoDescription: `${title} at Juniper Clay, stoneware thrown by hand.`,
  sections,
})

const LAYOUT: AiBuildPlan['create'][number] = {
  kind: 'layout',
  name: 'Site layout',
  why: 'The site has no layout yet.',
  duplicateOf: null,
  fields: ['header', 'nav', 'main', 'footer'],
}

const EMPTY = emptyAiSiteInventory('host-1')
const SITE: AiPlanCapabilities = { ...aiUnrestrictedPlanCapabilities(), galleryMinItems: AI_SITE_GALLERY_MIN_ITEMS }

/** The live Juniper Clay shape (2026-10-08): a Portfolio page whose gallery holds `items` pieces. */
const juniper = (items: number, extra: Section[] = []): AiBuildPlan => ({
  reuse: [],
  create: [LAYOUT],
  screens: [
    page('Home', '/', [section('Hero'), section('About the studio'), section('Testimonials', 3)]),
    page('Portfolio', '/portfolio', [section('Portfolio Hero'), section('Works Gallery', items), ...extra]),
  ],
})

const counts = (plan: AiBuildPlan) => plan.screens.map((screen) => screen.sections.map((one) => one.items))

describe('a section that shows the work is given its fewest pieces (AGL-3754)', () => {
  it.each([0, 1, 2])('raises a gallery of %i to three', (count) => {
    const settled = aiSettlePlanGalleries(juniper(count), EMPTY, SITE)
    expect(settled.screens[1].sections[1].items).toBe(3)
    expect(aiSiteEmptyGalleryViolations(settled)).toEqual([])
  })

  it.each([3, 4, 5, 6])('returns the plan itself when its gallery already has %i', (count) => {
    const plan = juniper(count)
    expect(aiSettlePlanGalleries(plan, EMPTY, SITE)).toBe(plan)
  })

  it('leaves every section that does not show the work as planned, a framing "Portfolio Hero" too', () => {
    const plan = juniper(0, [section('How we work', 1), section('Why galleries choose us', 2), section('Commission inquiry')])
    expect(counts(aiSettlePlanGalleries(plan, EMPTY, SITE))).toEqual([
      [0, 0, 3],
      [0, 3, 1, 2, 0],
    ])
  })

  it('raises every thin gallery on every page, and keeps the rest of each section', () => {
    const plan: AiBuildPlan = {
      ...juniper(1),
      screens: [
        page('Home', '/', [section('Hero'), section('Featured work', 2, ['new:Site layout'])]),
        ...juniper(1).screens.slice(1),
      ],
    }
    const settled = aiSettlePlanGalleries(plan, EMPTY, SITE)
    expect(counts(settled)).toEqual([
      [0, 3],
      [0, 3],
    ])
    expect(settled.screens[0].sections[1]).toEqual({ name: 'Featured work', uses: ['new:Site layout'], items: 3 })
    expect(plan.screens[0].sections[1].items).toBe(2)
  })

  it('leaves one item of a list split into sections for rule 1 to join', () => {
    const plan: AiBuildPlan = {
      ...juniper(4),
      screens: [
        juniper(4).screens[0],
        page('Portfolio', '/portfolio', [section('Portfolio Hero'), section('Gallery: vases', 1), section('Gallery: bowls', 1)]),
      ],
    }
    expect(aiSettlePlanGalleries(plan, EMPTY, SITE)).toBe(plan)
  })

  it('settles nothing for a job that sets no fewest pieces', () => {
    const plan = juniper(0)
    expect(aiSettlePlanGalleries(plan, EMPTY, aiUnrestrictedPlanCapabilities())).toBe(plan)
    expect(aiSettlePlanGalleries(plan, EMPTY, null)).toBe(plan)
  })

  describe('in the plan check', () => {
    it('hands a site start its gallery at three, so the gallery check finds nothing to ask', () => {
      const result = aiDoctrinePlanCheck(EMPTY, null, SITE)(juniper(0) as never)
      expect(result.value?.screens[1].sections[1].items).toBe(3)
      expect(aiSiteEmptyGalleryViolations(result.value as AiBuildPlan)).toEqual([])
      expect(result.violations.map((violation) => violation.code)).not.toContain(AI_SITE_EMPTY_GALLERY_CODE)
    })

    it("keeps another job's count as planned", () => {
      const result = aiDoctrinePlanCheck(EMPTY, null, aiUnrestrictedPlanCapabilities())(juniper(0) as never)
      expect(result.value?.screens[1].sections[1].items).toBe(0)
    })
  })
})
