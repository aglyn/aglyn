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
import {
  emptyAiSiteInventory,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import { aiDoctrinePlanCheck } from './ai-doctrine'
import { aiSettlePlanLayoutsInSections } from './ai-doctrine-validators'

/*
 * A section that places a layout has it taken out of its uses when the page's
 * layout has one answer (AGL-3807): a live Free dental start of 2026-10-15
 * named the site's layout in every section and was refused under
 * `plan-layout-in-section` on both attempts.
 */

type Section = AiBuildPlan['screens'][number]['sections'][number]
const section = (name: string, uses: string[] = [], items = 0): Section => ({
  name,
  uses,
  items,
})

const page = (
  layout: string | null,
  sections: Section[],
): AiBuildPlan['screens'][number] => ({
  title: 'Home',
  slug: '/',
  layout,
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: 'Home | Maple Street Dental',
  seoDescription: 'Gentle family dental care at Maple Street Dental.',
  sections,
})

/** A site with two layouts of its own, so a page could mean either. */
const SITE: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [
    { id: 'laySite', name: 'Site layout', parentId: null },
    { id: 'layLanding', name: 'Landing layout', parentId: null },
  ],
}

const plan = (
  screens: AiBuildPlan['screens'],
  create: AiBuildPlan['create'] = [],
): AiBuildPlan => ({
  reuse: [],
  create,
  screens,
})
const uses = (settled: AiBuildPlan) =>
  settled.screens.map((screen) => screen.sections.map((one) => one.uses))
const codes = (answer: AiBuildPlan) =>
  aiDoctrinePlanCheck(SITE)(answer as never).violations.map(
    (violation) => violation.code,
  )

describe('a section that places a layout', () => {
  it('on a page that names no layout: puts the page in it and takes it out of the section', () => {
    const answer = plan([
      page(null, [section('Hero', ['laySite']), section('Services', [], 3)]),
    ])
    const settled = aiSettlePlanLayoutsInSections(answer, SITE)
    expect(settled.screens[0].layout).toBe('laySite')
    expect(uses(settled)).toEqual([[[], []]])
    expect(codes(answer)).not.toContain('plan-layout-in-section')
    expect(codes(answer)).not.toContain('plan-screen-without-layout')
  })

  it('on a page whose layout names nothing: puts the page in the one layout its sections name', () => {
    const answer = plan([page('default', [section('Hero', ['laySite'])])])
    expect(aiSettlePlanLayoutsInSections(answer, SITE).screens[0].layout).toBe(
      'laySite',
    )
  })

  it('on a page already in that layout: takes it out of the sections, and keeps what else they place', () => {
    const form: AiBuildPlan['create'][number] = {
      kind: 'form',
      name: 'Booking form',
      why: 'Parents book visits.',
      duplicateOf: null,
      fields: ['name', 'email'],
    }
    const answer = plan(
      [
        page('laySite', [
          section('Hero', ['laySite']),
          section('Book a visit', ['laySite', 'new:Booking form']),
        ]),
      ],
      [form],
    )
    const settled = aiSettlePlanLayoutsInSections(answer, SITE)
    expect(settled.screens[0].layout).toBe('laySite')
    expect(uses(settled)).toEqual([[[], ['new:Booking form']]])
    expect(codes(answer)).not.toContain('plan-layout-in-section')
  })

  it('reads a layout the plan creates, however its reference spells it', () => {
    const layout: AiBuildPlan['create'][number] = {
      kind: 'layout',
      name: 'Site layout',
      why: 'The site has none.',
      duplicateOf: null,
      fields: ['header', 'nav', 'main', 'footer'],
    }
    const answer = plan(
      [page('new:Site layout', [section('Hero', ['new:site-layout'])])],
      [layout],
    )
    const checked = aiDoctrinePlanCheck(emptyAiSiteInventory('host-1'))(
      answer as never,
    )
    expect(checked.violations.map((violation) => violation.code)).not.toContain(
      'plan-layout-in-section',
    )
    expect(uses(checked.value as AiBuildPlan)).toEqual([[[]]])
  })

  it('on a page in a different layout: is left for the rule to ask about', () => {
    const answer = plan([page('layLanding', [section('Hero', ['laySite'])])])
    expect(aiSettlePlanLayoutsInSections(answer, SITE)).toBe(answer)
    expect(codes(answer)).toContain('plan-layout-in-section')
  })

  it('when the page’s sections name two layouts: is left for the rule to ask about', () => {
    const answer = plan([
      page(null, [
        section('Hero', ['laySite']),
        section('Offer', ['layLanding']),
      ]),
    ])
    expect(aiSettlePlanLayoutsInSections(answer, SITE)).toBe(answer)
    expect(codes(answer)).toContain('plan-layout-in-section')
  })

  it('on a page whose layout names a record of another kind: is left for the rule to ask about', () => {
    const site: AiSiteInventory = {
      ...SITE,
      templates: [{ id: 'tplPost', name: 'Post', kind: 'post' }],
    }
    const answer = plan([page('tplPost', [section('Hero', ['laySite'])])])
    expect(aiSettlePlanLayoutsInSections(answer, site)).toBe(answer)
  })

  it('leaves a plan whose sections place no layout untouched', () => {
    const answer = plan([
      page('laySite', [section('Hero'), section('Services', [], 3)]),
    ])
    expect(aiSettlePlanLayoutsInSections(answer, SITE)).toBe(answer)
  })
})
