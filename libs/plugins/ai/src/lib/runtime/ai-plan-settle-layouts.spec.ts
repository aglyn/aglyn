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
import { aiSettlePlanLayouts, aiSettlePlanRefs } from './ai-doctrine-validators'

/*
 * A page whose layout has one answer is given it (2026-10-07): a live plan
 * for a bookkeeper left one page's layout empty beside the layout it created,
 * and rule 2 refused the whole plan.
 */

const page = (title: string, slug: string, layout: string | null): AiBuildPlan['screens'][number] => ({
  title,
  slug,
  layout,
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: title,
  seoDescription: `${title} for small businesses.`,
  sections: [{ name: 'intro', uses: [], items: 0 }],
})

const layout = (name: string): AiBuildPlan['create'][number] => ({
  kind: 'layout',
  name,
  why: 'The site has no layout yet.',
  duplicateOf: null,
  fields: ['header', 'nav', 'main', 'footer'],
})

const EMPTY = emptyAiSiteInventory('host-1')

describe('a page whose layout has one answer', () => {
  it('goes in the one layout an empty site’s plan creates', () => {
    const plan: AiBuildPlan = {
      reuse: [],
      create: [layout('Site layout')],
      screens: [page('Home', '/', 'new:Site layout'), page('Services', '/services', null)],
    }
    expect(aiSettlePlanLayouts(plan, EMPTY).screens.map((screen) => screen.layout)).toEqual([
      'new:Site layout',
      'new:Site layout',
    ])
  })

  it('is left for the rule to ask about on a site that has a layout of its own', () => {
    const site = { ...EMPTY, layouts: [{ id: 'laySite', name: 'Site', parentId: null }] }
    const plan: AiBuildPlan = { reuse: [], create: [], screens: [page('Home', '/', null)] }
    expect(aiSettlePlanLayouts(plan, site)).toBe(plan)
  })

  it('is left for the rule to ask about when two layouts could frame it', () => {
    const plan: AiBuildPlan = {
      reuse: [],
      create: [layout('Main'), layout('Landing')],
      screens: [page('Home', '/', null)],
    }
    expect(aiSettlePlanLayouts(plan, EMPTY)).toBe(plan)
  })

  it('plans the site layout and puts every page in it when an empty site’s plan has none', () => {
    const plan: AiBuildPlan = {
      reuse: [],
      create: [],
      screens: [page('Home', '/', 'default'), page('Contact', '/contact', 'default')],
    }
    const settled = aiSettlePlanLayouts(plan, EMPTY)
    expect(settled.create).toEqual([
      expect.objectContaining({ kind: 'layout', name: 'Site layout', fields: ['header', 'nav', 'main', 'footer'] }),
    ])
    expect(settled.screens.map((screen) => screen.layout)).toEqual(['new:Site layout', 'new:Site layout'])
    expect(aiDoctrinePlanCheck(EMPTY)(plan as never).violations.map((violation) => violation.code)).not.toContain(
      'plan-screen-without-layout',
    )
  })

  it('is no longer refused by the plan check', () => {
    const plan: AiBuildPlan = {
      reuse: [],
      create: [layout('Site layout')],
      screens: [page('Home', '/', 'new:Site layout'), page('Services', '/services', null)],
    }
    const checked = aiDoctrinePlanCheck(EMPTY)(plan as never)
    expect(checked.violations.map((violation) => violation.code)).not.toContain('plan-screen-without-layout')
    expect(checked.value?.screens[1].layout).toBe('new:Site layout')
  })
})

describe('a reference that spells a creation differently', () => {
  const form: AiBuildPlan['create'][number] = {
    kind: 'form',
    name: 'Cake order form',
    why: 'People order cakes.',
    duplicateOf: null,
    fields: ['name', 'email', 'date'],
  }
  const withUse = (ref: string): AiBuildPlan => ({
    reuse: [],
    create: [layout('Site layout'), form],
    screens: [{ ...page('Order', '/order', 'new:Site layout'), sections: [{ name: 'order', uses: [ref], items: 0 }] }],
  })

  it('points at the one creation it names, case and punctuation aside', () => {
    expect(aiSettlePlanRefs(withUse('new:cake-order-form')).screens[0].sections[0].uses).toEqual(['new:Cake order form'])
  })

  it('leaves a reference that names nothing the plan creates', () => {
    const plan = withUse('new:quote-form')
    expect(aiSettlePlanRefs(plan)).toBe(plan)
  })
})
