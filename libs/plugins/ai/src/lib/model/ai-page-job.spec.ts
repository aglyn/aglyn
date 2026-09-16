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

/**
 * What a page job is (AGL-2907): the page types a brief may name, the inputs
 * the doors admit, and the plans a page job can build — one screen, from
 * what the site already has, creating nothing.
 */

import { AI_PAGE_BRIEF_FIXTURES } from '../jobs/fixtures/ai-page-briefs'
import type { AiBuildPlan } from './ai-build-plan'
import {
  AI_PAGE_TYPES,
  aiPagePlanPrerequisites,
  aiPagePlanRefusal,
  aiPageTypeDefinition,
  parseAiPageJobInputs,
} from './ai-page-job'

const [FIXTURE] = AI_PAGE_BRIEF_FIXTURES

const withCreations = (create: AiBuildPlan['create']): AiBuildPlan => ({ ...FIXTURE.plan, create })
const creation = (kind: AiBuildPlan['create'][number]['kind'], name: string) => ({
  kind,
  name,
  why: 'Nothing the site has will do.',
  duplicateOf: null,
  fields: [],
})

describe('page types', () => {
  it('offers the eight types the Describe dialog lists, each with what the page is for', () => {
    expect(AI_PAGE_TYPES.map((type) => type.id)).toEqual([
      'landing',
      'about',
      'pricing',
      'contact',
      'blogIndex',
      'product',
      'service',
      'event',
    ])
    for (const type of AI_PAGE_TYPES) {
      expect(type.label.trim()).not.toBe('')
      // A clause the request completes: "Page type: <purpose>".
      expect(type.purpose).toMatch(/^[a-z].{20,}[^.]$/)
      expect(aiPageTypeDefinition(type.id)).toBe(type)
    }
    expect(aiPageTypeDefinition('homepage')).toBeNull()
    expect(aiPageTypeDefinition(3)).toBeNull()
  })

  it('reads a known type and no type, and refuses an unknown one by name', () => {
    expect(parseAiPageJobInputs({ pageType: 'blogIndex' })).toEqual({ pageType: 'blogIndex' })
    expect(parseAiPageJobInputs({})).toEqual({ pageType: null })
    expect(parseAiPageJobInputs(null)).toEqual({ pageType: null })
    expect(parseAiPageJobInputs({ pageType: '' })).toEqual({ pageType: null })
    expect(parseAiPageJobInputs({ pageType: 'homepage' })).toBe(
      'pageType must be one of landing, about, pricing, contact, blogIndex, product, service, event',
    )
  })
})

describe('the plans a page job builds', () => {
  it('builds every golden plan: one screen with sections, reusing what its site has', () => {
    for (const fixture of AI_PAGE_BRIEF_FIXTURES) {
      expect([fixture.id, aiPagePlanRefusal(fixture.plan)]).toEqual([fixture.id, null])
      expect([fixture.id, aiPagePlanPrerequisites(fixture.plan)]).toEqual([fixture.id, []])
    }
  })

  it('refuses a plan that creates, naming each creation and where a member makes it', () => {
    expect(aiPagePlanRefusal(withCreations([creation('component', 'Service card')]))).toBe(
      'This page needs what the site does not have yet. Create the component “Service card” on the Components page, then describe the page again.',
    )
    expect(
      aiPagePlanRefusal(
        withCreations([creation('component', 'Service card'), creation('form', 'Quote request')]),
      ),
    ).toBe(
      'This page needs what the site does not have yet. Create the component “Service card” on the Components page and the form “Quote request” on the Forms page, then describe the page again.',
    )
    expect(
      aiPagePlanRefusal(
        withCreations([
          creation('layout', 'Site layout'),
          creation('theme-change', 'Warmer accent'),
          creation('dataset', 'Team members'),
        ]),
      ),
    ).toBe(
      'This page needs what the site does not have yet. Create the layout “Site layout” on the Layouts page, the theme change “Warmer accent” in the Theme section and the dataset “Team members” on the Datasets page, then describe the page again.',
    )
  })

  it('names a creation once, and a new: reference the create list does not carry', () => {
    const plan: AiBuildPlan = {
      ...withCreations([creation('component', 'Service card')]),
      screens: [
        {
          ...FIXTURE.plan.screens[0],
          sections: [
            { name: 'cards', uses: ['new:Service card', 'new:Service card'], items: 3 },
            { name: 'quotes', uses: ['new:Quote strip'], items: 0 },
          ],
        },
      ],
    }
    expect(aiPagePlanPrerequisites(plan)).toEqual([
      { kind: 'component', name: 'Service card' },
      { kind: 'component', name: 'Quote strip' },
    ])
  })

  it('refuses a plan with no page, with two pages, and a page with no sections', () => {
    expect(aiPagePlanRefusal({ ...FIXTURE.plan, screens: [] })).toBe(
      'This plan has no page to build. Describe the page again.',
    )
    expect(aiPagePlanRefusal({ ...FIXTURE.plan, screens: [FIXTURE.plan.screens[0], FIXTURE.plan.screens[0]] })).toBe(
      'This plan builds 2 pages, and a page job builds one. Describe each page on its own.',
    )
    expect(aiPagePlanRefusal({ ...FIXTURE.plan, screens: [{ ...FIXTURE.plan.screens[0], sections: [] }] })).toBe(
      'This plan’s page has no sections to build. Describe the page again.',
    )
  })
})
