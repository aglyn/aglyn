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
 * A page built one section at a time (AGL-2907), against the REAL palette
 * validator and doctrine: every golden brief is replayed pass by pass through
 * the section check and the page assembly the page step runs, and the page
 * that comes out is held to the whole-page doctrine. Nothing is stubbed.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiJobPlan } from '../model/ai-jobs.types'
import { AI_DOCTRINE_SYSTEM_BLOCK, aiDoctrineSystemBlocks } from '../runtime/ai-doctrine'
import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { AI_PAGE_BRIEF_FIXTURES, type AiPageBriefFixture } from './fixtures/ai-page-briefs'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_TOOL,
  aiEmptyPage,
  aiPageCheckContext,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  aiPageSectionPrompt,
  aiPageWithSection,
  type AiPageSection,
} from './ai-job-page-sections'

const confirmed = (fixture: AiPageBriefFixture): AiJobPlan => ({
  ...fixture.plan,
  status: 'confirmed',
  labels: {},
  proposedAt: null,
  confirmedAt: null,
  confirmedBy: 'uid-1',
})

type Stored = Record<string, { $id?: string; parentId?: string | null; nodes?: string[] }>

/** Replay a fixture's answers through the check and the assembly, as the passes would. */
function replay(fixture: AiPageBriefFixture, jobId = 'job-golden') {
  const screen = fixture.plan.screens[0]
  const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId(jobId, index))
  const context = aiPageCheckContext(fixture.inventory)
  let page = aiEmptyPage()
  let last: AiPageSection | null = null
  fixture.answers.forEach((answer, index) => {
    const result = aiPageSectionCheck({
      page,
      sectionIds,
      index,
      context,
      uses: screen.sections[index].uses,
      inventory: fixture.inventory,
    })({ tree: JSON.stringify(answer) })
    expect([fixture.id, index, result.violations]).toEqual([fixture.id, index, []])
    if (!result.value) throw new Error(`${fixture.id} pass ${index + 1} kept nothing`)
    page = aiPageWithSection(page, result.value, sectionIds)
    last = result.value
  })
  return { page, sectionIds, context, last: last as AiPageSection | null }
}

describe('the golden pages, a section a pass', () => {
  it.each(AI_PAGE_BRIEF_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    '%s: every pass keeps the page’s rules, and the page that comes out keeps them whole',
    (_id, fixture) => {
      const { page, sectionIds, context } = replay(fixture)
      const nodes = page as unknown as Stored
      expect(nodes[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(sectionIds)
      for (const [id, node] of Object.entries(nodes)) {
        expect([id, node.$id]).toEqual([id, id])
        if (id === CANVAS_ROOT_ELEMENT_ID) continue
        expect([id, nodes[node.parentId as string]?.nodes?.includes(id)]).toEqual([id, true])
      }
      const whole = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page }, 'page', context)
      expect(whole.violations).toEqual([])
      expect(JSON.stringify(page)).not.toContain('{{')
    },
  )

  it('replaces a section a pass writes again, and never doubles it', () => {
    const { page, sectionIds, last } = replay(AI_PAGE_BRIEF_FIXTURES[0])
    const again = aiPageWithSection(page, last as AiPageSection, sectionIds)
    expect(Object.keys(again).sort()).toEqual(Object.keys(page).sort())
    expect((again as unknown as Stored)[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(sectionIds)
  })

  it('puts a section in its plan position, and keeps what a member added to the page where it is', () => {
    const fixture = AI_PAGE_BRIEF_FIXTURES[0]
    const { page, sectionIds } = replay(fixture)
    const nodes = page as unknown as Record<string, Record<string, unknown>>
    const [first, second] = sectionIds
    const member = { $id: 'member-note', componentId: 'muiTypography', parentId: CANVAS_ROOT_ELEMENT_ID, props: { children: 'Ours' }, nodes: [] }
    const withNote = {
      ...nodes,
      'member-note': member,
      [CANVAS_ROOT_ELEMENT_ID]: { ...nodes[CANVAS_ROOT_ELEMENT_ID], nodes: [first, 'member-note', ...sectionIds.slice(1)] },
    } as unknown as NodesMap
    const withoutSecond = { ...(withNote as unknown as Record<string, Record<string, unknown>>) }
    withoutSecond[CANVAS_ROOT_ELEMENT_ID] = {
      ...withoutSecond[CANVAS_ROOT_ELEMENT_ID],
      nodes: [first, 'member-note', ...sectionIds.slice(2)],
    }
    const section = { rootId: second, nodes: { [second]: nodes[second] } as unknown as NodesMap, load: null }
    const restored = aiPageWithSection(withoutSecond as unknown as NodesMap, section, sectionIds)
    expect((restored as unknown as Stored)[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual([first, 'member-note', ...sectionIds.slice(1)])
  })
})

describe('a section that breaks the page’s rules', () => {
  const fixture = AI_PAGE_BRIEF_FIXTURES[0]
  const screen = fixture.plan.screens[0]
  const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId('job-negative', index))
  const context = aiPageCheckContext(fixture.inventory)
  const firstPage = () => {
    const first = aiPageSectionCheck({ page: aiEmptyPage(), sectionIds, index: 0, context, uses: screen.sections[0].uses, inventory: fixture.inventory })({
      tree: JSON.stringify(fixture.answers[0]),
    })
    return aiPageWithSection(aiEmptyPage(), first.value as AiPageSection, sectionIds)
  }

  it('is refused for a second h1, naming and quoting only its own node by the model’s id', () => {
    const result = aiPageSectionCheck({ page: firstPage(), sectionIds, index: 1, context, uses: [], inventory: fixture.inventory })({
      tree: JSON.stringify(fixture.answers[0]),
    })
    expect(result.violations.map(({ code, nodeIds }) => ({ code, nodeIds }))).toEqual([
      { code: 'multiple-h1', nodeIds: ['a1'] },
    ])
    expect(Object.keys(result.offending ?? {})).toEqual(['a1'])
  })

  it('is refused when it leaves out a component its plan line places (rule 7)', () => {
    const result = aiPageSectionCheck({
      page: firstPage(),
      sectionIds,
      index: 1,
      context,
      uses: ['cmp-service-card', 'frm-quote', 'scr-contact'],
      inventory: fixture.inventory,
    })({ tree: JSON.stringify(fixture.answers[2]) })
    expect(result.violations).toEqual([
      expect.objectContaining({
        rule: 7,
        code: 'plan-reuse-not-placed',
        message: expect.stringContaining('cmp-service-card, frm-quote'),
      }),
    ])
  })

  it('is unreadable unless it is exactly one Section inside the document wrapper', () => {
    const two = {
      rootId: 'root',
      nodes: {
        root: { componentId: 'div', nodes: ['x', 'y'] },
        x: { componentId: 'section', props: { element: 'section' }, nodes: ['xt'] },
        xt: { componentId: 'muiTypography', props: { variant: 'h1', component: 'h1', children: 'One' } },
        y: { componentId: 'section', props: { element: 'section' }, nodes: ['yt'] },
        yt: { componentId: 'muiTypography', props: { variant: 'h2', component: 'h2', children: 'Two' } },
      },
    }
    const result = aiPageSectionCheck({ page: aiEmptyPage(), sectionIds, index: 0, context, uses: [], inventory: fixture.inventory })({
      tree: JSON.stringify(two),
    })
    expect(result.value).toBeNull()
    expect(result.violations.map((violation) => violation.code)).toEqual(['section-shape'])
  })
})

describe('what a pass asks for', () => {
  const fixture = AI_PAGE_BRIEF_FIXTURES[1]
  const plan = confirmed(fixture)
  const screen = plan.screens[0]

  it('names the page, its type, the brief, the plan and this section, and what is built above it', () => {
    const job = { brief: fixture.brief, inputs: { pageType: fixture.pageType } }
    const first = aiPageSectionPrompt({ job, plan, screen, index: 0, maxElements: 23 })
    expect(first).toContain(`Page: "${screen.title}" at ${screen.slug}`)
    expect(first).toContain('Page type: a page about one service')
    expect(first).toContain(`Brief: ${fixture.brief}`)
    expect(first).toContain('Confirmed plan:')
    expect(first).toContain(`Build section 1 of ${screen.sections.length}: "${screen.sections[0].name}".`)
    expect(first).toContain('Nothing is built yet: this section holds the page’s h1.')
    expect(first).toContain('Keep this section to at most 23 elements.')

    const second = aiPageSectionPrompt({ job, plan, screen, index: 1, maxElements: 23 })
    expect(second).toContain(`Build section 2 of ${screen.sections.length}: "${screen.sections[1].name}". It places cmp-treatment-step. It shows 4 items.`)
    expect(second).toContain(`Already built, above it: 1. ${screen.sections[0].name}.`)
    // A reference, never content: no answer of any section rides in the request.
    expect(second).not.toContain('Consultation and 3D scan')
  })

  it('sends the doctrine, the page instructions and the screen palette as the cached prefix, and the site after it', () => {
    const blocks = aiDoctrineSystemBlocks(fixture.inventory, { instructions: AI_JOB_PAGE_INSTRUCTIONS })
    expect(blocks).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      AI_JOB_PAGE_INSTRUCTIONS[0],
      { text: AI_PALETTE_CATALOG.screen, cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
    expect(() => validateAiSystemBlocks(blocks)).not.toThrow()
    expect(AI_PAGE_SECTION_TOOL).toMatchObject({ name: 'submit_section', strict: true })
  })
})
