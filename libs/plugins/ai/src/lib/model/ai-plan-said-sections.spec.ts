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

import type { AiBuildPlanScreen } from './ai-build-plan'
import {
  AI_PLAN_SAID_SECTION_ITEMS,
  AI_PLAN_SAID_SECTION_NAME,
  aiPlanHasCustomerWords,
  aiPlanSectionNameWithoutPlaceholder,
  aiPlanSectionSaysCustomerWords,
  aiSettlePlanPlaceholderNames,
  aiSettlePlanSaidSections,
} from './ai-plan-said-sections'
import { emptyAiSiteInventory } from './ai-site-inventory'

const section = (name: string, items = 0, uses: string[] = []) => ({ name, uses, items })

/** A planned page with only what the settling reads: its address and its sections. */
const screen = (slug: string, names: string[]): AiBuildPlanScreen =>
  ({ slug, sections: names.map((name) => section(name)) }) as unknown as AiBuildPlanScreen

/** The live Whitmore Lane Family Law home (beta.262, 2026-10-16), as its plan named it. */
const WHITMORE = {
  screens: [
    screen('/', [
      'Hero',
      'Practice areas',
      'Why families choose us',
      'Client feedback placeholder',
      'Free consultation',
    ]),
    screen('/about', ['Our attorneys', 'Our values']),
  ],
}

describe('a section of customer words, by its name (AGL-3887)', () => {
  it.each([
    'Client feedback placeholder',
    'Testimonials',
    'Kind words',
    'What our clients say',
    'What past clients are saying',
    'Patient stories',
    'Families’ words',
    'Google reviews',
    'Reviews',
    'Success stories',
    'In their own words',
  ])('reads "%s" as one', (name) => {
    expect(aiPlanSectionSaysCustomerWords(name)).toBe(true)
  })

  it.each([
    'Free case review',
    'Plan review',
    'Practice areas',
    'Praise & worship',
    'Why people choose us',
    'What working together is like',
    'Customer quotes and estimates',
  ])('reads "%s" as none', (name) => {
    expect(aiPlanSectionSaysCustomerWords(name)).toBe(false)
  })
})

describe('a section never named a placeholder (AGL-3887)', () => {
  it.each([
    ['Client feedback placeholder', 'Client feedback'],
    ['Gallery (placeholder)', 'Gallery'],
    ['Placeholder: team photos', 'team photos'],
    ['Map [placeholder]', 'Map'],
    ['Placeholder', 'Section'],
    ['Hero', 'Hero'],
  ])('names "%s" as "%s"', (name, expected) => {
    expect(aiPlanSectionNameWithoutPlaceholder(name)).toBe(expected)
  })

  it('settles every page of any plan, and leaves a plan with none untouched', () => {
    const settled = aiSettlePlanPlaceholderNames(WHITMORE)
    expect(settled.screens[0].sections[3].name).toBe('Client feedback')
    expect(settled.screens[1]).toBe(WHITMORE.screens[1])
    const clean = { screens: [screen('/', ['Hero', 'Services'])] }
    expect(aiSettlePlanPlaceholderNames(clean)).toBe(clean)
  })
})

describe('a site start plans no section of customer words it has none of (AGL-3887)', () => {
  it('plans the Whitmore home’s "Client feedback placeholder" as what working with the firm is like', () => {
    const settled = aiSettlePlanSaidSections(WHITMORE, { hasCustomerWords: false, homeMin: 5 })
    expect(settled.screens[0].sections.map((one) => one.name)).toEqual([
      'Hero',
      'Practice areas',
      'Why families choose us',
      AI_PLAN_SAID_SECTION_NAME,
      'Free consultation',
    ])
    expect(settled.screens[0].sections[3].items).toBe(AI_PLAN_SAID_SECTION_ITEMS)
    // The page without one is the page as planned.
    expect(settled.screens[1]).toBe(WHITMORE.screens[1])
  })

  it('keeps the section where the customer words are real', () => {
    expect(aiSettlePlanSaidSections(WHITMORE, { hasCustomerWords: true, homeMin: 5 })).toBe(WHITMORE)
  })

  it('takes the section out where the page already says what working together is like, and keeps its fewest', () => {
    const plan = {
      screens: [
        screen('/', ['Hero', 'Services', 'Our process', 'Kind words', 'About', 'Book a session']),
        screen('/services', ['Services', 'How we work', 'Testimonials']),
      ],
    }
    const settled = aiSettlePlanSaidSections(plan, { hasCustomerWords: false, homeMin: 5 })
    expect(settled.screens[0].sections.map((one) => one.name)).toEqual(['Hero', 'Services', 'Our process', 'About', 'Book a session'])
    expect(settled.screens[1].sections.map((one) => one.name)).toEqual(['Services', 'How we work'])
  })

  it('recasts the section rather than take a home under its fewest', () => {
    const plan = { screens: [screen('/', ['Hero', 'Our approach', 'Services', 'Testimonials', 'Contact'])] }
    const settled = aiSettlePlanSaidSections(plan, { hasCustomerWords: false, homeMin: 5 })
    expect(settled.screens[0].sections.map((one) => one.name)).toEqual([
      'Hero',
      'Our approach',
      'Services',
      AI_PLAN_SAID_SECTION_NAME,
      'Contact',
    ])
  })

  it('recasts the first of two and takes out the second', () => {
    const plan = { screens: [screen('/', ['Hero', 'Services', 'Testimonials', 'About', 'Reviews', 'FAQ', 'Contact'])] }
    const settled = aiSettlePlanSaidSections(plan, { hasCustomerWords: false, homeMin: 5 })
    expect(settled.screens[0].sections.map((one) => one.name)).toEqual([
      'Hero',
      'Services',
      AI_PLAN_SAID_SECTION_NAME,
      'About',
      'FAQ',
      'Contact',
    ])
  })

  it('never touches a page’s first section, and returns a plan with nothing to settle as it was', () => {
    const plan = { screens: [screen('/reviews', ['Reviews', 'Leave a review'])] }
    expect(aiSettlePlanSaidSections(plan, { hasCustomerWords: false, homeMin: 5 })).toBe(plan)
  })
})

describe('whether the customer words are real (AGL-3887)', () => {
  const inventory = emptyAiSiteInventory('host-1')

  it('has none for a family law firm’s guided start', () => {
    expect(
      aiPlanHasCustomerWords({
        brief: 'A two-attorney family law firm in Columbus, Ohio. Divorce, custody and free case reviews.',
        inventory,
        siteKind: 'services',
      }),
    ).toBe(false)
  })

  it('has them in a store, whose platform shows its shoppers’ reviews', () => {
    expect(aiPlanHasCustomerWords({ brief: 'Hand-poured candles', inventory, siteKind: 'store' })).toBe(true)
  })

  it('has them where the site keeps a dataset of them', () => {
    const withReviews = { ...inventory, datasets: [{ id: 'ds-1', name: 'Client testimonials', fields: ['Quote', 'Name'] }] }
    expect(aiPlanHasCustomerWords({ brief: 'A bakery', inventory: withReviews })).toBe(true)
  })

  it('has them where the brief asks for them or quotes one with its speaker', () => {
    expect(aiPlanHasCustomerWords({ brief: 'A plumber. Add a testimonials section.' })).toBe(true)
    expect(aiPlanHasCustomerWords({ brief: 'A plumber. “Fixed our leak in an hour, and tidy too.” — Dana R.' })).toBe(true)
  })
})
