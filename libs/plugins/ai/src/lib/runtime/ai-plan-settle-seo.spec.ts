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
import {
  AI_SEO_DESCRIPTION_MAX,
  AI_SEO_TITLE_MAX,
  aiSettlePlanSeo,
} from './ai-doctrine-validators'

/*
 * A page's search title or description a few words past its length is cut at
 * a word in code (AGL-3837): the live Free travel-blog start of 2026-10-15
 * wrote a home description of 173 characters against 170 on both answers and
 * stopped under `plan-seo`.
 */

const EMPTY = emptyAiSiteInventory('host-1')

const page = (
  seo: Partial<Pick<AiBuildPlan['screens'][number], 'seoTitle' | 'seoDescription'>> = {},
): AiBuildPlan['screens'][number] => ({
  title: 'Home',
  slug: '/',
  layout: null,
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: 'Long Train Journeys Through Europe',
  seoDescription: 'One traveler’s notes on the long train journeys of Europe.',
  sections: [{ name: 'Hero', uses: [], items: 0 }],
  ...seo,
})

const plan = (screen: AiBuildPlan['screens'][number], language?: string): AiBuildPlan => ({
  reuse: [],
  create: [],
  screens: [screen],
  ...(language ? { language } : {}),
})

const codes = (answer: AiBuildPlan) =>
  aiDoctrinePlanCheck(EMPTY)(answer as never).violations.map((violation) => violation.code)

/** The travel blog's home description: 173 characters, three past the limit. */
const TRAVEL_BLOG_DESCRIPTION =
  'Slow travel by rail across Europe, one long train journey at a time: night trains, mountain lines and coastal routes, with honest notes on tickets, sleepers, food and views.'

describe('an over-length plan search listing', () => {
  it('cuts the travel blog’s 173-character description to a whole word within 170', () => {
    expect(TRAVEL_BLOG_DESCRIPTION).toHaveLength(173)
    const settled = aiSettlePlanSeo(plan(page({ seoDescription: TRAVEL_BLOG_DESCRIPTION }), 'en'))
    const description = settled.screens[0].seoDescription
    expect(description.length).toBeLessThanOrEqual(AI_SEO_DESCRIPTION_MAX)
    expect(TRAVEL_BLOG_DESCRIPTION.startsWith(description)).toBe(true)
    expect(TRAVEL_BLOG_DESCRIPTION.charAt(description.length)).toMatch(/[\s,.]/)
    // "…food and" would end on a joining word, so "and" goes too.
    expect(description).toBe(
      'Slow travel by rail across Europe, one long train journey at a time: night trains, mountain lines and coastal routes, with honest notes on tickets, sleepers, food',
    )
  })

  it('is settled before the rules read the plan, which then passes', () => {
    const answer = plan(page({ seoDescription: TRAVEL_BLOG_DESCRIPTION }), 'en')
    expect(codes(aiSettlePlanSeo(answer))).not.toContain('plan-seo')
    const checked = aiDoctrinePlanCheck(EMPTY)(answer as never)
    expect(checked.violations.map((violation) => violation.code)).not.toContain('plan-seo')
    expect((checked.value as AiBuildPlan).screens[0].seoDescription.length).toBeLessThanOrEqual(
      AI_SEO_DESCRIPTION_MAX,
    )
  })

  it.each([
    {
      case: 'an English title cut at a joining word and a separator',
      language: 'en',
      field: 'seoTitle' as const,
      value: 'Long Train Journeys Through Europe: Night Trains and Slow Routes | The Slow Rail',
      expected: 'Long Train Journeys Through Europe: Night Trains and Slow Routes',
    },
    {
      case: 'an English description cut at a joining word',
      language: 'en',
      field: 'seoDescription' as const,
      value: TRAVEL_BLOG_DESCRIPTION,
      expected:
        'Slow travel by rail across Europe, one long train journey at a time: night trains, mountain lines and coastal routes, with honest notes on tickets, sleepers, food',
    },
    {
      case: 'a Spanish title cut at a separator',
      language: 'es',
      field: 'seoTitle' as const,
      value: 'Viajes largos en tren por Europa: trenes nocturnos y rutas lentas | Diario de un viajero',
      expected: 'Viajes largos en tren por Europa: trenes nocturnos y rutas lentas',
    },
    {
      case: 'a Spanish description cut at the Spanish "y"',
      language: 'es',
      field: 'seoDescription' as const,
      value:
        'Viajes lentos en tren por Europa, un trayecto largo cada vez: trenes nocturnos, líneas de montaña y rutas por la costa, con notas sinceras sobre billetes, literas y comida de la región.',
      expected:
        'Viajes lentos en tren por Europa, un trayecto largo cada vez: trenes nocturnos, líneas de montaña y rutas por la costa, con notas sinceras sobre billetes, literas',
    },
  ])('$case', ({ language, field, value, expected }) => {
    const settled = aiSettlePlanSeo(plan(page({ [field]: value }), language))
    const max = field === 'seoTitle' ? AI_SEO_TITLE_MAX : AI_SEO_DESCRIPTION_MAX
    expect(settled.screens[0][field]).toBe(expected)
    expect(settled.screens[0][field].length).toBeLessThanOrEqual(max)
    expect(codes(settled)).not.toContain('plan-seo')
  })

  it('reads the dangling word in the plan’s language: English keeps a Spanish "y"', () => {
    const value =
      'Viajes lentos en tren por Europa, un trayecto largo cada vez: trenes nocturnos, líneas de montaña y rutas por la costa, con notas sinceras sobre billetes, literas y comida de la región.'
    const spanish = aiSettlePlanSeo(plan(page({ seoDescription: value }), 'es')).screens[0].seoDescription
    const english = aiSettlePlanSeo(plan(page({ seoDescription: value }))).screens[0].seoDescription
    expect(spanish.endsWith('literas')).toBe(true)
    expect(english.endsWith('literas y')).toBe(true)
  })

  it.each([
    { case: 'a missing description', seo: { seoDescription: '' } },
    { case: 'a blank description', seo: { seoDescription: '   ' } },
    { case: 'a missing title', seo: { seoTitle: '' } },
  ])('leaves $case for the rule to refuse', ({ seo }) => {
    const answer = plan(page(seo), 'en')
    expect(aiSettlePlanSeo(answer)).toBe(answer)
    expect(codes(answer)).toContain('plan-seo')
  })

  it('leaves a value whose cut would split a word for the rule to re-ask', () => {
    const answer = plan(page({ seoDescription: `Rail notes: ${'x'.repeat(170)}` }), 'en')
    expect(aiSettlePlanSeo(answer)).toBe(answer)
    expect(codes(answer)).toContain('plan-seo')
  })

  it('leaves a value whose cut would keep under half its length for the rule to re-ask', () => {
    // Cut at the space before the long word, then "and the" twice comes off:
    // 26 characters of 70 is no longer the line the model wrote.
    const answer = plan(page({ seoTitle: `Night trains across Europe and the and the ${'y'.repeat(40)}` }), 'en')
    expect(aiSettlePlanSeo(answer)).toBe(answer)
    expect(codes(answer)).toContain('plan-seo')
  })

  it('leaves a plan within its lengths untouched', () => {
    const answer = plan(page(), 'en')
    expect(aiSettlePlanSeo(answer)).toBe(answer)
  })
})
