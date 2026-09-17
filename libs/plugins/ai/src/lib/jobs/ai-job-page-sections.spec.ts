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
import type { AiCompletion, AiProvider, AiProviderRequest } from '../providers/contract'
import {
  AI_DOCTRINE_SYSTEM_BLOCK,
  aiDoctrineSystemBlocks,
  aiReaskMessage,
  aiStoppedAtCeiling,
  runValidatedGeneration,
} from '../runtime/ai-doctrine'
import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { AI_FREE_PAGE_FIXTURE, AI_PAGE_BRIEF_FIXTURES, type AiPageBriefFixture } from './fixtures/ai-page-briefs'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_INLINE_LINE,
  AI_PAGE_SECTION_REPEAT_LINE,
  AI_PAGE_SECTION_TOOL,
  aiEmptyPage,
  aiPageCheckContext,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  aiPageSectionPrompt,
  aiPageSectionSmaller,
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

  it('is refused for a row of cards that is one column at every width, naming the model’s Grid and saying what to set (AGL-3055)', () => {
    // The live About page's shape: a Grid with no container, holding items sized 4.
    const answer = structuredClone(fixture.answers[1])
    const [rowId] = Object.entries(answer.nodes).find(([, node]) => node.props?.['container'] === true) ?? []
    const row = answer.nodes[rowId as string]
    row.props = { ariaLabel: 'What the inspection covers' }
    for (const cell of row.nodes ?? []) answer.nodes[cell].props = { size: '4' }
    const result = aiPageSectionCheck({ page: firstPage(), sectionIds, index: 1, context, uses: screen.sections[1].uses, inventory: fixture.inventory })({
      tree: JSON.stringify(answer),
    })
    expect(result.violations.map(({ rule, code, nodeIds }) => ({ rule, code, nodeIds }))).toEqual([
      { rule: 12, code: 'grid-not-container', nodeIds: [rowId] },
    ])
    expect(aiReaskMessage('page-section', 'submit_section', result.violations, result.offending)).toContain(
      `Set "container": true on it, and put each column in a Grid item sized like "xs:12 md:4". (nodes ${rowId})`,
    )
  })

  it('is refused for a subhead cut short, an empty list item and a button that goes nowhere, each named by the model’s own id with what to write instead (AGL-3072)', () => {
    // The live Free About hero's three defects, written into this brief's hero.
    const answer = structuredClone(fixture.answers[0])
    answer.nodes['a2'].props = { variant: 'h5', component: 'p', children: 'A licensed roofer checks shingles, flashing and gutters, with' }
    answer.nodes['a3'].props = { children: 'Request a quote', variant: 'contained' }
    answer.nodes['a7'] = { componentId: 'muiList', nodes: ['a8', 'a10'] }
    answer.nodes['a8'] = { componentId: 'muiListItem', nodes: ['a9'] }
    answer.nodes['a9'] = { componentId: 'muiListItemText', props: { primary: 'Shingles and flashing' } }
    answer.nodes['a10'] = { componentId: 'muiListItem', nodes: ['a11'] }
    answer.nodes['a11'] = { componentId: 'muiListItemText', props: {} }
    answer.nodes['a5'].nodes = [...(answer.nodes['a5'].nodes ?? []), 'a7']
    const result = aiPageSectionCheck({ page: aiEmptyPage(), sectionIds, index: 0, context, uses: [], inventory: fixture.inventory })({
      tree: JSON.stringify(answer),
    })
    expect(result.violations.map(({ rule, code, nodeIds }) => ({ rule, code, nodeIds }))).toEqual([
      { rule: 10, code: 'link-without-destination', nodeIds: ['a3'] },
      { rule: 14, code: 'dangling-word', nodeIds: ['a2'] },
      { rule: 16, code: 'empty-item', nodeIds: ['a10'] },
    ])
    expect(Object.keys(result.offending ?? {}).sort()).toEqual(['a10', 'a2', 'a3'])
    const reask = aiReaskMessage('page-section', 'submit_section', result.violations, result.offending)
    expect(reask).toContain(
      '"Request a quote" goes nowhere. Give it the "screenId" of a screen the site has, or an "href" that is a path on this site or an https: address the brief gives.',
    )
    expect(reask).toContain('its last word, "with", leaves the sentence unfinished. Finish the sentence, or end the line before "with". (nodes a2)')
    expect(reask).toContain('Write the words of its List Item Text, or take the item out. (nodes a10)')
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
    // The catalog shows no Grid's container or spacing, so the instructions name both and the size format (AGL-3055).
    expect(AI_PALETTE_CATALOG.screen).not.toMatch(/muiGrid \(Grid\)[^\n]*container=/)
    expect(AI_JOB_PAGE_INSTRUCTIONS[0].text).toContain('a Grid ("container": true, "spacing": 3) of Grid items sized like "xs:12 md:4"')
  })
})

/**
 * A section cut off at its ceiling (AGL-3042), through the REAL doctrine loop
 * and section check, with a fake provider standing in for the model. A tool
 * call the provider stops on `max_tokens` hands over what had arrived: a
 * `tree` cut mid-string, or an empty input. The section check reads either as
 * a tree it cannot use; the loop refuses it as too large instead, and asks for
 * a smaller one.
 */
describe('a section cut off at its ceiling (AGL-3042)', () => {
  const fixture = AI_PAGE_BRIEF_FIXTURES[0]
  const screen = fixture.plan.screens[0]
  const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId('job-cut', index))
  const CEILING = 1_050
  const SMALLER = aiPageSectionSmaller({ maxElements: 15 })

  const cutOff = (input: Record<string, unknown>): AiCompletion => ({
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_PAGE_SECTION_TOOL.name, input }],
    usage: { inputTokens: 1_200, outputTokens: CEILING, cacheReadTokens: 9_000, cacheWriteTokens: 0 },
    estCostUsd: 0.02,
    stopReason: 'max_tokens',
  })
  const answered = (tree: unknown): AiCompletion => ({
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_PAGE_SECTION_TOOL.name, input: { tree: JSON.stringify(tree) } }],
    usage: { inputTokens: 1_300, outputTokens: 400, cacheReadTokens: 9_000, cacheWriteTokens: 0 },
    estCostUsd: 0.01,
    stopReason: 'tool_use',
  })
  const CUT_TREE = { tree: JSON.stringify(fixture.answers[0]).slice(0, 180) }

  /** A provider that answers from a queue and keeps every request it was sent. */
  function provider(answers: AiCompletion[]): { fake: AiProvider; requests: AiProviderRequest[] } {
    const requests: AiProviderRequest[] = []
    const fake: AiProvider = {
      id: 'fake',
      label: 'Fake',
      apiKeyEnv: 'FAKE_AI_KEY',
      endpointHost: 'ai.test',
      readApiKey: () => 'key',
      models: () => [],
      complete: async (request) => {
        requests.push(request)
        const next = answers.shift()
        if (!next) throw new Error('no answer armed')
        return next
      },
      stream: async () => {
        throw new Error('the doctrine loop never streams')
      },
    }
    return { fake, requests }
  }

  const generate = (fake: AiProvider) =>
    runValidatedGeneration<AiPageSection>('page-section', {
      model: 'test-model',
      provider: fake,
      instructions: AI_JOB_PAGE_INSTRUCTIONS,
      inventory: fixture.inventory,
      messages: [{ role: 'user', content: 'Build section 1 of 4: "hero".' }],
      tool: AI_PAGE_SECTION_TOOL,
      maxTokens: CEILING,
      cutOff: { noun: 'section', smaller: SMALLER },
      thinking: 'off',
      check: aiPageSectionCheck({
        page: aiEmptyPage(),
        sectionIds,
        index: 0,
        context: aiPageCheckContext(fixture.inventory),
        uses: screen.sections[0].uses,
        inventory: fixture.inventory,
      }),
    })

  it('reads a call as cut off by its stop reason: the contract’s max_tokens, or a provider’s length', () => {
    expect([aiStoppedAtCeiling('max_tokens'), aiStoppedAtCeiling('length')]).toEqual([true, true])
    expect([aiStoppedAtCeiling('tool_use'), aiStoppedAtCeiling('end_turn'), aiStoppedAtCeiling(null)]).toEqual([false, false, false])
  })

  it('without a cut-off stop, reads the same truncated tree as a tree it cannot use, as it always has', () => {
    const check = aiPageSectionCheck({
      page: aiEmptyPage(),
      sectionIds,
      index: 0,
      context: aiPageCheckContext(fixture.inventory),
      uses: screen.sections[0].uses,
      inventory: fixture.inventory,
    })
    expect(check(CUT_TREE).violations.map((violation) => violation.code)).toEqual(['tree-invalid-input'])
    expect(check({}).violations.map((violation) => violation.code)).toEqual(['tree-invalid-input'])
  })

  it('asks a cut-off section for a smaller one, naming what shrinks it and not the shape its cut input fails, and keeps the re-ask that fits', async () => {
    const { fake, requests } = provider([cutOff(CUT_TREE), answered(fixture.answers[0])])
    const result = await generate(fake)
    expect(result).toMatchObject({ status: 'ok', attempts: 2, stopReason: 'tool_use', usage: { outputTokens: CEILING + 400 } })
    if (result.status !== 'ok') return
    expect(result.value.rootId).toBe(sectionIds[0])

    expect(requests.map((request) => request.maxTokens)).toEqual([CEILING, CEILING])
    expect(requests[1].system).toEqual(requests[0].system)
    expect(requests[1].messages.slice(1)).toEqual([
      { role: 'assistant', content: 'Submitted the page-section with submit_section.' },
      {
        role: 'user',
        content: [
          'Your page-section was not used: it ran past the size one answer may have, and was cut off before it was whole.',
          'Make it smaller: use fewer elements, at most 15; write shorter copy; and place a repeated item as an instance of a component the site has instead of drawing it again.',
          '',
          'Answer again with submit_section: the whole page-section, smaller than the one that was cut off.',
        ].join('\n'),
      },
    ])
  })

  it('ends a section cut off on both attempts as a cut-off refusal, not as tree-invalid-input', async () => {
    const { fake, requests } = provider([cutOff(CUT_TREE), cutOff({})])
    const result = await generate(fake)
    expect(requests).toHaveLength(2)
    expect(result).toMatchObject({ status: 'needs_input', attempts: 2, stopReason: 'max_tokens', usage: { outputTokens: 2 * CEILING } })
    if (result.status !== 'needs_input') return
    expect(result.violations.map((violation) => violation.code)).toEqual(['answer-cut-off'])
    expect(result.message).toBe('This section was too large to build in one pass. Try again, or describe it smaller.')
  })

  it('tells a workspace that keeps no reusable components to shrink the section by writing a repeated item once, not by placing instances (AGL-3053)', () => {
    const inline = aiPageSectionSmaller({ maxElements: 15, reusableComponents: false })
    expect(inline).toBe(
      'Make it smaller: use fewer elements, at most 15; write shorter copy; and write a repeated item once instead of drawing it again: ' +
        'put {{1}}, {{2}}… where its copies differ, and give its outermost node "repeat", one list of values a copy, in that order, as [["Title 1", "Text 1"], ["Title 2", "Text 2"]].',
    )
    expect(inline).not.toContain('instance')
    expect(SMALLER).toContain('instance of a component the site has')
    expect(SMALLER).not.toContain('"repeat"')
  })
})

/**
 * A repeated item written once (AGL-3053), through the REAL section check: a
 * workspace that keeps no reusable components writes an item once with its
 * copies' values, the check draws the copies before either validator reads
 * them, and every finding names a node the model wrote.
 */
describe('a repeated item written once (AGL-3053)', () => {
  const fixture = AI_FREE_PAGE_FIXTURE
  const screen = fixture.plan.screens[0]
  const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId('job-once', index))
  const FREE = aiPageCheckContext(fixture.inventory, { reusableComponents: false })
  const heroPage = () =>
    aiPageWithSection(
      aiEmptyPage(),
      aiPageSectionCheck({ page: aiEmptyPage(), sectionIds, index: 0, context: FREE, uses: [], inventory: fixture.inventory })({
        tree: JSON.stringify(fixture.answers[0]),
      }).value as AiPageSection,
      sectionIds,
    )
  const checkCards = (tree: unknown, context = FREE) =>
    aiPageSectionCheck({ page: heroPage(), sectionIds, index: 1, context, uses: [], inventory: fixture.inventory })({
      tree: JSON.stringify(tree),
    })
  /** The practice areas as the golden writes them once, with one node changed. */
  const cardsWith = (id: string, change: (node: Record<string, unknown>) => Record<string, unknown>) => {
    const answer = structuredClone(fixture.answers[1])
    answer.nodes[id] = change(answer.nodes[id] as unknown as Record<string, unknown>) as never
    return answer
  }
  type Stored = Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }>

  it('shows how to write one once only to a section whose plan line shows items, on a workspace that keeps no reusable components', () => {
    const job = { brief: fixture.brief, inputs: { pageType: fixture.pageType } }
    const plan = confirmed(fixture)
    const prompt = (index: number, reusableComponents?: boolean) =>
      aiPageSectionPrompt({ job, plan, screen, index, maxElements: 15, reusableComponents })
    expect(AI_PAGE_SECTION_INLINE_LINE).toBe(
      'This site keeps no saved forms or reusable components: write a repeated item once, and draw a form as a Form holding its Form Fields.',
    )
    expect(screen.sections.map((section) => section.items)).toEqual([0, 4, 0, 0])
    expect(screen.sections.map((_, index) => [prompt(index, false).includes(AI_PAGE_SECTION_INLINE_LINE), prompt(index, false).includes(AI_PAGE_SECTION_REPEAT_LINE)])).toEqual([
      [true, false],
      [true, true],
      [true, false],
      [true, false],
    ])
    // A workspace that places components is never shown either.
    expect(screen.sections.map((_, index) => /repeat|\{\{1\}\}/.test(prompt(index)))).toEqual([false, false, false, false])
    // The page instructions every workspace shares say only that a repeated item is written once.
    expect(AI_JOB_PAGE_INSTRUCTIONS[0].text).toContain('a repeated item is written once, and a form is a Form (form) with no formId')
    expect(AI_JOB_PAGE_INSTRUCTIONS[0].text).not.toMatch(/written out each time|\{\{1\}\}|"repeat"/)
  })

  it('keeps the cards written once as the cards written out: the same elements, the same copy, a card each', () => {
    const once = checkCards(fixture.answers[1])
    const full = checkCards(fixture.writtenOut[1])
    expect([once.violations, full.violations]).toEqual([[], []])
    const cards = (nodes: Stored) =>
      Object.values(nodes)
        .filter((node) => node.componentId === 'muiCard')
        .map((card) => (nodes[card.nodes?.[0] as string].nodes ?? []).map((id) => nodes[id].props?.['children']))
    const onceNodes = once.value?.nodes as unknown as Stored
    const fullNodes = full.value?.nodes as unknown as Stored
    expect(cards(onceNodes)).toEqual(cards(fullNodes))
    expect(cards(onceNodes)).toEqual(
      (fixture.answers[1].nodes['b5'].repeat ?? []).map(([title, summary]) => [title, summary]),
    )
    expect(Object.keys(onceNodes)).toHaveLength(Object.keys(fullNodes).length)
    expect(JSON.stringify(onceNodes)).not.toMatch(/\{\{|"repeat"/)
  })

  it('refuses an item written once where the workspace keeps reusable components, telling the model to place instances (rule 1)', () => {
    const result = checkCards(fixture.answers[1], aiPageCheckContext(fixture.inventory))
    expect(result.value).toBeNull()
    expect(result.violations).toEqual([
      expect.objectContaining({ rule: 1, code: 'repeat-not-inline', nodeIds: ['b5'], detail: expect.stringContaining('reusableInstance') }),
    ])
    expect(Object.keys(result.offending ?? {})).toEqual(['b5'])
  })

  it('refuses a copy that leaves a placeholder without its value, quoting the item as the model wrote it', () => {
    const result = checkCards(
      cardsWith('b5', (node) => ({ ...node, repeat: [['Estate planning', 'Wills.'], ['Real estate'], ['Business formation', 'Contracts.']] })),
    )
    expect(result.value).toBeNull()
    expect(result.violations).toEqual([
      {
        rule: null,
        code: 'repeat-placeholder-without-value',
        message: 'The answer could not be used as a section.',
        detail: 'The second copy of "b5" gives 1 value, and the item uses {{1}} and {{2}}: give every copy one value for each placeholder, in order.',
        nodeIds: ['b5', 'b2'],
      },
    ])
    expect(Object.keys(result.offending ?? {})).toEqual(['b5', 'b2'])
    expect(aiReaskMessage('page-section', 'submit_section', result.violations, result.offending)).toContain(
      '- The answer could not be used as a section. The second copy of "b5" gives 1 value, and the item uses {{1}} and {{2}}: give every copy one value for each placeholder, in order. (nodes b5, b2)',
    )
  })

  it('names the node the model wrote for a rule every copy breaks, once', () => {
    // An h4 under the section's h2 skips a level, on every card the item draws.
    const result = checkCards(cardsWith('b1', (node) => ({ ...node, props: { variant: 'h4', children: '{{1}}', component: 'h4' } })))
    expect(result.value).not.toBeNull()
    expect(result.violations.map(({ rule, code, nodeIds }) => ({ rule, code, nodeIds }))).toEqual([
      { rule: 11, code: 'skipped-heading', nodeIds: ['b1'] },
    ])
    expect(Object.keys(result.offending ?? {})).toEqual(['b1'])
  })

  it('names the node the model wrote when the palette validator refuses the item, never a copy', () => {
    // A Typography cannot hold an element; every copy lists one, and the first copy is the one the model wrote.
    const answer = structuredClone(fixture.answers[1])
    answer.nodes['b2'] = { ...answer.nodes['b2'], nodes: ['b2x'] }
    answer.nodes['b2x'] = { componentId: 'muiTypography', props: { variant: 'caption', children: '{{1}}' } }
    const result = checkCards(answer)
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'tree-lineage',
        detail: 'Typography (b2) cannot hold other elements, but lists b2x',
      }),
    ])
  })
})
