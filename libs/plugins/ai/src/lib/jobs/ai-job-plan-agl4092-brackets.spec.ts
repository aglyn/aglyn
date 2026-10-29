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
 * A PLAN CARD SHOWS NO BRACKET (AGL-4092). The 2026-10-28 Assist build of an
 * About page proposed sections named "Who we are: …, with [year founded] and
 * [team story]", "Young riders: …, and [age and class requirements]" and
 * "Contact details: [email], [phone], …", and the plan card printed them as
 * written. Every plan's prompt told it to: doctrine rule 14 said to "mark it
 * in square brackets instead of inventing it", and so did the site context
 * every build's plan reads. The pages already wrote around a missing fact;
 * the card did not.
 *
 * Rule 14, the context's rule and the text job's rule now say to leave a
 * missing fact out, and a plan's section names are settled with no gap left
 * in them, whatever a model still writes. Pure: no model is asked.
 */

import type { AiBuildPlan } from '../model/ai-build-plan'
import { aiSettlePlanPlaceholderNames, aiPlanSectionNameWithoutPlaceholder } from '../model/ai-plan-said-sections'
import { AI_SITE_CONTEXT_RULE } from '../model/ai-site-context'
import { AI_BUILDING_DOCTRINE } from '../runtime/ai-doctrine'
import { aiPlanSaidSettle } from './ai-job-plan-step'
import { AI_JOB_TEXT_SYSTEM } from './ai-job-text-step'
import { ASSIST_ABOUT_PLAN, ASSIST_ABOUT_SECTION_NAMES } from './fixtures/ai-site-agl4092-datasets'

const rule = (n: number) => AI_BUILDING_DOCTRINE.split('\n').find((line) => line.startsWith(`${n}. `)) ?? ''

const names = (plan: Pick<AiBuildPlan, 'screens'>) => plan.screens.flatMap((screen) => screen.sections.map((section) => section.name))

describe('a plan’s section names (AGL-4092)', () => {
  it('come out of the recorded About plan with no gap in them', () => {
    const settled = aiSettlePlanPlaceholderNames(ASSIST_ABOUT_PLAN)
    expect(names(settled)).toEqual(ASSIST_ABOUT_SECTION_NAMES)
    for (const gap of ['[year founded]', '[team story]', '[age and class requirements]', '[email]', '[phone]']) {
      expect(JSON.stringify(settled)).not.toContain(gap)
    }
  })

  it('are settled so on a build’s plan, the kind an Assist build proposes', () => {
    const settle = aiPlanSaidSettle({ kind: 'build', brief: 'An About page', inputs: {} }, null, 4)
    expect(names(settle(ASSIST_ABOUT_PLAN as AiBuildPlan))).toEqual(ASSIST_ABOUT_SECTION_NAMES)
  })

  it('lose "to be added" and TBD as they lose the word placeholder', () => {
    expect(aiPlanSectionNameWithoutPlaceholder('Our story (details to be added)')).toBe('Our story')
    expect(aiPlanSectionNameWithoutPlaceholder('Race schedule - TBD')).toBe('Race schedule')
    expect(aiPlanSectionNameWithoutPlaceholder('Sponsor wall: logos to be added')).toBe('Sponsor wall: logos')
    expect(aiPlanSectionNameWithoutPlaceholder('[Team story]')).toBe('Section')
    expect(aiPlanSectionNameWithoutPlaceholder('Testimonials placeholder')).toBe('Testimonials')
    // A name with nothing to settle is the same string.
    const name = 'Where we race and who we serve: Lockhart, Luling, San Marcos, Austin and Central Texas'
    expect(aiPlanSectionNameWithoutPlaceholder(name)).toBe(name)
  })
})

describe('what a plan and a text job are told of a missing fact (AGL-4092)', () => {
  it('rule 14 says to leave it out, never to mark it in square brackets', () => {
    expect(rule(14)).toContain('leave it out and write the sentence without it: never a bracket, a placeholder or an invented fact')
    expect(rule(14)).not.toContain('mark it in square brackets instead of inventing it')
  })

  it('the site context says the same, with no bracketed example', () => {
    expect(AI_SITE_CONTEXT_RULE).toContain('leave it out and write the sentence without it')
    expect(AI_SITE_CONTEXT_RULE).not.toMatch(/\[|bracket/i)
  })

  it('the text job is told to leave a missing detail out', () => {
    const system = AI_JOB_TEXT_SYSTEM.map((block) => block.text).join('\n')
    expect(system).toContain('where a detail is missing, leave it out and write the sentence without it')
    expect(system).not.toMatch(/square brackets|placeholder/i)
  })
})
