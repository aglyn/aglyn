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
 * the doors admit, and the plans a page job can build — one screen, with the
 * layout, forms and components it creates built first (AGL-3031).
 */

import { AI_PAGE_BRIEF_FIXTURES } from '../jobs/fixtures/ai-page-briefs'
import {
  AI_FREE_PAGE_RECORDED_PLAN,
  AI_FREE_PAGE_STOPPED_RECORDING,
} from '../jobs/fixtures/ai-free-page-recording'
import type { AiBuildPlan } from './ai-build-plan'
import {
  AI_PAGE_CREATE_KINDS,
  AI_PAGE_TYPES,
  aiPageCreationRefusal,
  aiPagePlanPrerequisites,
  aiPagePlanRefusal,
  aiPagePlanShapeRefusal,
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

  it('builds the layout, forms and components its plan creates, and refuses what another job builds, naming where it is made (AGL-3031)', () => {
    expect(AI_PAGE_CREATE_KINDS).toEqual(['layout', 'form', 'component'])
    expect(
      aiPagePlanRefusal(
        withCreations([creation('layout', 'Site layout'), creation('component', 'Service card'), creation('form', 'Quote request')]),
      ),
    ).toBeNull()
    expect(aiPagePlanRefusal(withCreations([creation('template', 'Service page')]))).toBe(
      'This page needs what the site does not have yet. Create the template “Service page” in the Templates library, then describe the page again.',
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
      'This page needs what the site does not have yet. Create the theme change “Warmer accent” in the Theme section and the dataset “Team members” on the Datasets page, then describe the page again.',
    )
  })

  it('names a creation once, and a new: reference the create list does not carry', () => {
    const plan: AiBuildPlan = {
      ...withCreations([creation('component', 'Service card'), creation('email', 'Welcome'), creation('email', 'welcome')]),
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
      { kind: 'email', name: 'Welcome' },
      { kind: 'component', name: 'Quote strip' },
    ])
  })

  it('still names an undeclared creation in a plan confirmed before the plan rules refused one (AGL-3040)', () => {
    // The plan rules now refuse this plan before it is kept (rule 7,
    // `plan-creation-undeclared`); one confirmed earlier stops at the door
    // with the sentence the live recording stopped with, not at a dead pass.
    const { candidate } = AI_FREE_PAGE_STOPPED_RECORDING
    expect(aiPagePlanPrerequisites(AI_FREE_PAGE_RECORDED_PLAN)).toEqual([{ kind: 'component', name: 'consultation-form' }])
    expect(`stopped: ${aiPagePlanRefusal(AI_FREE_PAGE_RECORDED_PLAN)}`).toBe(candidate.note)
  })

  it('holds a plan’s shape apart from what it creates (AGL-3030)', () => {
    // The plan step re-asks a plan of the wrong shape, and the plan rules
    // refuse a creation, so the shape refusal says nothing about creations.
    const creating = withCreations([creation('template', 'Service page')])
    expect(aiPagePlanShapeRefusal(creating)).toBeNull()
    expect(aiPagePlanRefusal(creating)).toContain('Create the template “Service page”')
    const twoPages = { ...FIXTURE.plan, screens: [FIXTURE.plan.screens[0], FIXTURE.plan.screens[0]] }
    expect(aiPagePlanShapeRefusal(twoPages)).toBe(aiPagePlanRefusal(twoPages))
  })

  it('refuses the creations the site cannot take now, each with why, in one sentence (AGL-3031)', () => {
    expect(aiPageCreationRefusal([])).toBeNull()
    expect(
      aiPageCreationRefusal([
        { kind: 'layout', name: 'Site frame', path: 'create[0]', reason: 'this site already holds the 1 shared layout its plan includes', message: '' },
        { kind: 'form', name: 'Quote request', path: 'create[1]', reason: "this workspace's plan does not include saved forms", message: '' },
      ]),
    ).toBe(
      "This page cannot be built as planned: it creates the layout “Site frame”, because this site already holds the 1 shared layout its plan includes; and the form “Quote request”, because this workspace's plan does not include saved forms. Describe the page again.",
    )
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
