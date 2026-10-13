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
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiDoctrinePlanCheck } from './ai-doctrine'
import { aiSettlePlanLayoutRegionSections } from './ai-doctrine-validators'

/*
 * A page section that is a layout region is taken off the page (AGL-3750): a
 * live Free start of 2026-10-12, "a bakery that sells cakes to order",
 * planned a Header and a Footer on its pages three times, was refused under
 * `plan-layout-region-section` each time, and stopped.
 */

type Section = AiBuildPlan['screens'][number]['sections'][number]
const section = (name: string, uses: string[] = [], items = 0): Section => ({ name, uses, items })

const page = (title: string, slug: string, sections: Section[]): AiBuildPlan['screens'][number] => ({
  title,
  slug,
  layout: 'new:Site layout',
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: `${title} | Crumb & Co`,
  seoDescription: `${title} at Crumb & Co, cakes baked to order in Tulsa.`,
  sections,
})

const LAYOUT: AiBuildPlan['create'][number] = {
  kind: 'layout',
  name: 'Site layout',
  why: 'The site has no layout yet.',
  duplicateOf: null,
  fields: ['header', 'nav', 'main', 'footer'],
}
const FORM: AiBuildPlan['create'][number] = {
  kind: 'form',
  name: 'Cake order form',
  why: 'People order cakes.',
  duplicateOf: null,
  fields: ['name', 'email', 'date'],
}

const EMPTY = emptyAiSiteInventory('host-1')
const names = (plan: AiBuildPlan) => plan.screens.map((screen) => screen.sections.map((one) => one.name))

/** The live plan's shape: each page opens with a Header and closes with a Footer. */
const BAKERY: AiBuildPlan = {
  reuse: [],
  create: [LAYOUT, FORM],
  screens: [
    page('Home', '/', [
      section('Header'),
      section('Hero'),
      section('Cakes we bake', [], 3),
      section('Why order from us'),
      section('Testimonials', [], 3),
      section('Order a cake', ['new:Cake order form']),
      section('Footer'),
    ]),
    page('Order', '/order', [
      section('Site navigation'),
      section('Order form', ['new:Cake order form']),
      section('Footer'),
    ]),
  ],
}

describe('a page section that is a layout region', () => {
  it('is taken off every page that plans one, the rest kept in order', () => {
    expect(names(aiSettlePlanLayoutRegionSections(BAKERY, EMPTY))).toEqual([
      ['Hero', 'Cakes we bake', 'Why order from us', 'Testimonials', 'Order a cake'],
      ['Order form'],
    ])
  })

  it('is no longer refused by the plan check', () => {
    const checked = aiDoctrinePlanCheck(EMPTY)(BAKERY as never)
    expect(checked.violations.map((violation) => violation.code)).not.toContain('plan-layout-region-section')
    expect(names(checked.value as AiBuildPlan)[1]).toEqual(['Order form'])
  })

  it('is read by the rule’s own names: a nav bar, a site header, an announcement bar, a cookie banner', () => {
    const plan: AiBuildPlan = {
      ...BAKERY,
      screens: [
        page('Home', '/', [
          section('Announcement bar'),
          section('Nav bar'),
          section('Site header'),
          section('Hero'),
          section('Cookie banner'),
        ]),
      ],
    }
    expect(names(aiSettlePlanLayoutRegionSections(plan, EMPTY))).toEqual([['Hero']])
  })

  it('is taken off when it places only the layout, which rule 2 refuses placing as well', () => {
    const plan: AiBuildPlan = {
      ...BAKERY,
      screens: [page('Home', '/', [section('Header', ['new:Site layout']), section('Hero')])],
    }
    const checked = aiDoctrinePlanCheck(EMPTY)(plan as never)
    expect(names(checked.value as AiBuildPlan)).toEqual([['Hero']])
    expect(checked.violations.map((violation) => violation.code)).not.toContain('plan-layout-in-section')
  })

  it('is left for the rule to ask about when it places a form or a component', () => {
    const plan: AiBuildPlan = {
      ...BAKERY,
      screens: [page('Home', '/', [section('Hero'), section('Footer newsletter', ['new:Cake order form'])])],
    }
    expect(aiSettlePlanLayoutRegionSections(plan, EMPTY)).toBe(plan)
    expect(aiDoctrinePlanCheck(EMPTY)(plan as never).violations.map((violation) => violation.code)).toContain(
      'plan-layout-region-section',
    )
  })

  it('never leaves a page with no sections: a page of only regions is re-asked as before', () => {
    const plan: AiBuildPlan = {
      ...BAKERY,
      screens: [
        page('Home', '/', [section('Header'), section('Hero'), section('Footer')]),
        page('Contact', '/contact', [section('Header'), section('Footer')]),
      ],
    }
    const settled = aiSettlePlanLayoutRegionSections(plan, EMPTY)
    expect(names(settled)).toEqual([['Hero'], ['Header', 'Footer']])
    expect(aiDoctrinePlanCheck(EMPTY)(plan as never).violations).toContainEqual(
      expect.objectContaining({
        code: 'plan-layout-region-section',
        paths: ['screens[1].sections[0]', 'screens[1].sections[1]'],
      }),
    )
  })

  it('returns the plan itself when no page plans a region', () => {
    const plan: AiBuildPlan = { ...BAKERY, screens: [page('Home', '/', [section('Hero'), section('Our cakes', [], 3)])] }
    expect(aiSettlePlanLayoutRegionSections(plan, EMPTY)).toBe(plan)
  })
})
