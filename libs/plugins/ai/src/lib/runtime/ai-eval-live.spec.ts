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
 * The live eval run's recorders and grader (AGL-2937), driven with the
 * provider faked at the runtime's `runAiRequest` seam: no network and no
 * key. What is pinned is the refusal, that each recorder answers through its
 * production door, that the grader's grade becomes the rubric, and that a
 * recording scores in the offline harness like any answer.
 */

const mockRunAiRequest = jest.fn()

jest.mock('./ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('./ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

// The page step's draft writer loads the host index; a recording never asks it.
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import { AI_PAGE_SECTION_INLINE_LINE, AI_PAGE_SECTION_TOOL } from '../jobs/ai-job-page-sections'
import { AI_JOB_PLAN_INSTRUCTIONS, AI_JOB_PLAN_SCOPES } from '../jobs/ai-job-plan-step'
import { AI_FREE_PAGE_BUILT_RECORDING } from '../jobs/fixtures/ai-free-page-built-recording'
import { AI_FREE_PAGE_RECORDED_PLAN } from '../jobs/fixtures/ai-free-page-recording'
import { AI_FREE_PAGE_FIXTURE } from '../jobs/fixtures/ai-page-briefs'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import {
  aiPlanCapabilitiesForJob,
  aiPlanCapabilityLines,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import { AI_SEO_FIELDS_TOOL_NAME } from '../tools/ai-seo-tool'
import { AI_THEME_TOOL_NAME } from '../tools/ai-theme-tool'
import { AI_DOCTRINE_RULES } from './ai-doctrine-validators'
import { readAiEvalCase, scoreAiEvalCandidate, type AiEvalCase } from './ai-eval'
import {
  AI_EVAL_CAPABILITIES_GRADER_NOTE,
  AI_EVAL_INLINE_GRADER_NOTE,
  AI_EVAL_LAYOUT_OUTLINE_MAX_LINES,
  AI_EVAL_PAGE_GRADER_NOTE,
  AI_EVAL_PLAN_GRADER_NOTE,
  AI_EVAL_RUBRIC_TOOL,
  AiEvalLiveRefusedError,
  aiEvalCasesNamed,
  aiEvalGraderOutput,
  aiEvalGraderPrompt,
  aiEvalLayoutOutline,
  readAiEvalGrade,
  recordAiEvalLive,
} from './ai-eval-live'
import { AI_PALETTE } from './ai-palette.generated'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const fixture = (path: string): AiEvalCase =>
  readAiEvalCase(JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'ai-eval', 'cases', path), 'utf8')), path)

const page = fixture('page/roof-repair-service.json')
const layout = fixture('layout/bakery-site-layout.json')
const freePage = fixture('page/free-law-firm-about.json')
const text = fixture('text/bakery-tagline.json')
const theme = fixture('theme/warmer-accents.json')
const section = fixture('section/storm-leak-call-to-action.json')

const USAGE = { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 }
const LIVE = { env: { AI_EVAL_LIVE: '1' }, model: 'eval-model', graderModel: 'grader-model' }

const toolCall = (name: string, input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name, input }],
  usage: USAGE,
  estCostUsd: 0.004,
  stopReason: 'tool_use',
})

/** The one layout a Free site's page job creates: its name, a link home, the slot and a footer. */
const FREE_LAYOUT = {
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['header', 'slot', 'footer'] },
    header: { componentId: 'muiAppBar', props: { position: 'static', color: 'default' }, nodes: ['bar'] },
    bar: { componentId: 'muiToolbar', nodes: ['brand', 'home'] },
    brand: { componentId: 'muiTypography', props: { variant: 'h6', component: 'p', children: 'Brightwater Law' } },
    home: { componentId: 'muiScreenLink', props: { screenId: 'scr-home', children: 'Home' } },
    slot: { componentId: 'layoutSlot' },
    footer: { componentId: 'section', props: { element: 'footer' }, nodes: ['tagline'] },
    tagline: { componentId: 'muiTypography', props: { variant: 'body2', children: 'Brightwater Law, [city].' } },
  },
}

/** The fake provider answers each door as the fixture's reference answer would. */
function armReferenceAnswers(
  grade: Record<string, unknown> = { structure: 4, copy: 4, reuse: 5, notes: 'Holds up.' },
  planned: AiEvalCase = layout,
) {
  const sections = [...AI_FREE_PAGE_FIXTURE.answers]
  mockRunAiRequest.mockImplementation(async (request: { tools?: Array<{ name: string }> }) => {
    const tool = request.tools?.[0]?.name
    if (tool === AI_BUILD_PLAN_TOOL.name) return toolCall(tool, planned.candidates[0].plan)
    if (tool === 'submit_layout') return toolCall(tool, { tree: JSON.stringify(FREE_LAYOUT) })
    if (tool === AI_PAGE_SECTION_TOOL.name) return toolCall(tool, { tree: JSON.stringify(sections.shift()) })
    if (tool === AI_SEO_FIELDS_TOOL_NAME) return toolCall(tool, AI_FREE_PAGE_FIXTURE.seo)
    if (tool === AI_THEME_TOOL_NAME) return toolCall(tool, theme.candidates[0].answer)
    if (tool === AI_EVAL_RUBRIC_TOOL.name) return toolCall(tool, grade)
    return {
      kind: 'completion',
      text: String(text.candidates[0].answer),
      toolUse: [],
      usage: USAGE,
      estCostUsd: 0.002,
      stopReason: 'end_turn',
    }
  })
}

beforeEach(() => {
  mockRunAiRequest.mockReset()
})

describe('the live run', () => {
  it('is refused unless AI_EVAL_LIVE=1 names it, before any request', async () => {
    armReferenceAnswers()
    await expect(recordAiEvalLive([text], { env: {} })).rejects.toBeInstanceOf(AiEvalLiveRefusedError)
    await expect(recordAiEvalLive([text], { env: { AI_EVAL_LIVE: 'true' } })).rejects.toThrow('AI_EVAL_LIVE=1')
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('records a text brief through the text step, and grades it with the grader model', async () => {
    armReferenceAnswers()
    const report = await recordAiEvalLive([text], LIVE)
    expect(report.skipped).toEqual([])
    const [{ candidate }] = report.recorded
    expect(candidate).toMatchObject({
      source: 'recorded',
      scope: 'full',
      step: 'job.text',
      model: 'eval-model',
      answer: text.candidates[0].answer,
      usage: USAGE,
      rubric: { structure: 4, copy: 4, reuse: 5, grader: 'grader-model', notes: 'Holds up.' },
    })
    const [answerRequest, gradeRequest] = mockRunAiRequest.mock.calls.map((call) => call[0])
    // The text step's own request: no tool, the brief in the user turn.
    expect(answerRequest.tools).toBeUndefined()
    expect(answerRequest.messages[0].content).toContain(text.brief)
    // The grader: the rubric tool, on the grader's model, quoting the answer.
    expect(gradeRequest).toMatchObject({ model: 'grader-model', tools: [{ name: AI_EVAL_RUBRIC_TOOL.name }] })
    expect(gradeRequest.messages[0].content).toContain(String(text.candidates[0].answer))
    expect(scoreAiEvalCandidate(text, candidate).pass).toBe(true)
  })

  it('records a planned brief through the plan step, as a plan answer held to the expected shape', async () => {
    armReferenceAnswers()
    const [{ candidate }] = (await recordAiEvalLive([layout], LIVE)).recorded
    expect(candidate).toMatchObject({ scope: 'plan', step: 'job.plan', answer: null })
    expect(mockRunAiRequest.mock.calls[0][0].system[0].text).toContain('How to build on this platform.')
    const score = scoreAiEvalCandidate(layout, candidate)
    expect(score.checks).toEqual({ readable: null, rules: null, budget: null, plan: true, responsive: null, rubric: true })
    expect(score.pass).toBe(true)
  })

  it('records a page brief end to end — the plan, its creations, every section pass and the listing — each exchange metered as the machine meters a step (AGL-3030, AGL-3031)', async () => {
    armReferenceAnswers(undefined, freePage)
    const [{ candidate }] = (await recordAiEvalLive([freePage], LIVE)).recorded
    const sent = mockRunAiRequest.mock.calls.map((call) => call[0])
    // The plan was told what the Free workspace may create, and every section to build inline.
    expect(String(sent[0].messages[0].content)).toContain("- component: no, because this workspace's plan does not include reusable components")
    const passes = sent.filter((request) => request.tools?.[0]?.name === AI_PAGE_SECTION_TOOL.name)
    expect(passes).toHaveLength(AI_FREE_PAGE_FIXTURE.answers.length)
    for (const request of passes) expect(String(request.messages[0].content)).toContain(AI_PAGE_SECTION_INLINE_LINE)

    expect(candidate).toMatchObject({ source: 'recorded', scope: 'full', step: 'job.page', model: 'eval-model' })
    // The one layout the Free plan includes is built first, by the layout step.
    expect(candidate.steps?.map((step) => step.step)).toEqual([
      'job.plan',
      'job.layout',
      ...AI_FREE_PAGE_FIXTURE.answers.map(() => 'job.page'),
      'job.seo',
    ])
    for (const step of candidate.steps ?? []) {
      expect(step.credits).toBe(assistCreditsFromUsd(step.estCostUsd))
    }
    const plan = candidate.plan as { screens: Array<{ title: string }>; create: Array<{ name: string }> }
    expect(plan.screens.map((screen) => screen.title)).toEqual(['About Brightwater Law'])
    // The page it answers is the draft the step wrote, held to the Free workspace's doctrine.
    const score = scoreAiEvalCandidate(freePage, candidate)
    expect({ checks: score.checks, findings: score.findings }).toEqual({
      checks: { readable: true, rules: true, budget: true, plan: true, responsive: null, rubric: true },
      findings: [],
    })
    // Beside the tree, the screen as the draft stores it (AGL-3073): its
    // address, the listing the last pass wrote, the navigation it proposes,
    // and the layout it renders inside, which the job built first.
    expect(candidate.screen).toEqual({
      slug: 'about',
      seoTitle: AI_FREE_PAGE_FIXTURE.seo.title,
      seoDescription: AI_FREE_PAGE_FIXTURE.seo.description,
      nav: true,
      layout: {
        id: expect.any(String),
        name: plan.create[0].name,
        built: true,
        tree: { rootId: '_@_', nodes: expect.objectContaining({ '_@_': expect.anything() }) },
      },
    })
    // …and the grader reads all of it before the page.
    const graded = String(sent.find((request) => request.tools?.[0]?.name === AI_EVAL_RUBRIC_TOOL.name).messages[0].content)
    for (const line of [
      '- address: /about',
      `- search title: "${AI_FREE_PAGE_FIXTURE.seo.title}"`,
      `- search description: "${AI_FREE_PAGE_FIXTURE.seo.description}"`,
      '- navigation: an entry for the page is proposed',
      `- layout: "${plan.create[0].name}", built by this job before the page. Its outline:`,
      '  main · layoutSlot ← the page renders here',
      AI_EVAL_PAGE_GRADER_NOTE,
    ]) {
      expect([line, graded.indexOf(line) >= 0 && graded.indexOf(line) < graded.indexOf('Output:\n')]).toEqual([line, true])
    }
  })

  it('names the site in a recorded page’s listing request only as the case names it, never by the case’s id (AGL-3077)', async () => {
    const listingOf = async (evalCase: AiEvalCase): Promise<string> => {
      mockRunAiRequest.mockReset()
      armReferenceAnswers(undefined, freePage)
      // On the routing table's models, whose listing fits the last pass's time.
      await recordAiEvalLive([evalCase], { env: LIVE.env, graderModel: LIVE.graderModel })
      const listing = mockRunAiRequest.mock.calls
        .map((call) => call[0])
        .find((request) => request.tools?.[0]?.name === AI_SEO_FIELDS_TOOL_NAME)
      return String(listing.messages[0].content)
    }
    const untitled = await listingOf(freePage)
    expect(untitled).toContain('Site: untitled site\n')
    expect(untitled).not.toContain(freePage.id)
    expect(await listingOf({ ...freePage, siteName: 'Brightwater Law' })).toContain('Site: Brightwater Law\n')
    // A case that names its site names it with words.
    const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'ai-eval', 'cases', 'page', 'free-law-firm-about.json'), 'utf8'))
    expect(() => readAiEvalCase({ ...raw, siteName: ' ' }, 'free-law-firm-about.json')).toThrow('siteName')
    expect(readAiEvalCase({ ...raw, siteName: 'Brightwater Law' }, 'free-law-firm-about.json').siteName).toBe('Brightwater Law')
  })

  it('re-asks a page plan that places a creation it never declares, as the first live recording’s plan did, and records the page the re-ask plans (AGL-3040)', async () => {
    armReferenceAnswers(undefined, freePage)
    // The plan is answered first as it was live, then as the reference plan.
    mockRunAiRequest.mockImplementationOnce(async () => toolCall(AI_BUILD_PLAN_TOOL.name, AI_FREE_PAGE_RECORDED_PLAN))
    const [{ candidate }] = (await recordAiEvalLive([freePage], LIVE)).recorded
    const sent = mockRunAiRequest.mock.calls.map((call) => call[0])
    const plans = sent.filter((request) => request.tools?.[0]?.name === AI_BUILD_PLAN_TOOL.name)
    expect(plans).toHaveLength(2)
    // The one re-ask names both rules, and tells this Free workspace to draw its form.
    const reask = String(plans[1].messages.at(-1).content)
    expect(reask).toContain(`Rule 2 (${AI_DOCTRINE_RULES[2]}): A section places a layout.`)
    expect(reask).toContain(
      `Rule 7 (${AI_DOCTRINE_RULES[7]}): The "consultation request form" section places a creation named "consultation-form", but the plan never creates it, and this workspace's plan does not include saved forms. Draw the form on the page instead, as a Form element holding its Form Fields.`,
    )
    // The recording goes on to build the page, with both plan answers on its bill.
    expect(candidate).toMatchObject({ scope: 'full', plan: freePage.candidates[0].plan })
    expect(candidate.note).toBeUndefined()
    expect(candidate.steps?.[0]).toMatchObject({ step: 'job.plan', usage: { inputTokens: 2 * USAGE.inputTokens } })
    expect(candidate.steps?.filter((step) => step.step === 'job.page')).toHaveLength(AI_FREE_PAGE_FIXTURE.answers.length)
    // And its grader is told the workspace it was built for.
    const grade = sent.find((request) => request.tools?.[0]?.name === AI_EVAL_RUBRIC_TOOL.name)
    expect(String(grade.messages[0].content)).toContain(AI_EVAL_INLINE_GRADER_NOTE)
  })

  it('records only the briefs AI_EVAL_CASES names, and refuses a name no brief has', () => {
    expect(aiEvalCasesNamed([page, layout, freePage], {}).map((entry) => entry.id)).toEqual([page.id, layout.id, freePage.id])
    expect(
      aiEvalCasesNamed([page, layout, freePage], { AI_EVAL_CASES: ` ${freePage.id} ` }).map((entry) => entry.id),
    ).toEqual([freePage.id])
    expect(() => aiEvalCasesNamed([page], { AI_EVAL_CASES: 'page-nobody' })).toThrow('page-nobody')
  })

  it('records a theme brief through the theme step’s own call, keeping the tool input the harness scores', async () => {
    armReferenceAnswers()
    const [{ candidate }] = (await recordAiEvalLive([theme], LIVE)).recorded
    expect(candidate).toMatchObject({ step: 'job.theme', answer: theme.candidates[0].answer })
    expect(mockRunAiRequest.mock.calls[0][0].tools[0].name).toBe(AI_THEME_TOOL_NAME)
    expect(scoreAiEvalCandidate(theme, candidate).pass).toBe(true)
  })

  it('names the briefs no recorder covers instead of inventing an answer for them', async () => {
    armReferenceAnswers()
    const report = await recordAiEvalLive([section], LIVE)
    expect(report.recorded).toEqual([])
    expect(report.skipped).toEqual([expect.objectContaining({ caseId: section.id, kind: 'section' })])
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('gives a failing rubric when the grader never answers with whole grades', async () => {
    armReferenceAnswers({ structure: 9, copy: 'fine', reuse: null, notes: '' })
    const [{ candidate }] = (await recordAiEvalLive([text], LIVE)).recorded
    // One answer and one re-ask to the grader, then a rubric that cannot pass.
    expect(mockRunAiRequest.mock.calls.filter((call) => call[0].tools?.[0]?.name === AI_EVAL_RUBRIC_TOOL.name)).toHaveLength(2)
    expect(candidate.rubric).toMatchObject({ structure: 1, copy: 1, grader: 'grader-model' })
    expect(scoreAiEvalCandidate(text, candidate).pass).toBe(false)
  })
})

describe('aiEvalGraderPrompt', () => {
  const answer = { source: 'recorded', step: null, model: null, effort: null, usage: null } as const

  it('tells a plan’s grader what a plan can hold, so it grades the plan and not the page (AGL-3022)', () => {
    const prompt = aiEvalGraderPrompt(page, { ...answer, scope: 'plan', plan: { reuse: [] }, answer: null })
    expect(prompt).toContain(AI_EVAL_PLAN_GRADER_NOTE)
    expect(prompt).toContain('(its build plan)')
  })

  it('says nothing of plans to the grader of a whole answer', () => {
    const prompt = aiEvalGraderPrompt(text, { ...answer, scope: 'full', plan: null, answer: 'Fresh bread.' })
    expect(prompt).not.toContain(AI_EVAL_PLAN_GRADER_NOTE)
    expect(prompt).toContain('Fresh bread.')
  })

  it('tells the grader what the case’s workspace may create, as the plan step was told, and that building inline is right there (AGL-3040)', () => {
    // A grader told nothing of the workspace marked the Free brief's inline
    // repeats down for reuse, on a workspace that can keep no component.
    const told = aiPlanCapabilitiesForJob(freePage.capabilities as AiPlanCapabilities, AI_JOB_PLAN_SCOPES.page)
    for (const scope of ['plan', 'full'] as const) {
      const prompt = aiEvalGraderPrompt(freePage, { ...answer, scope, plan: { reuse: [] }, answer: { tree: {} } })
      for (const line of aiPlanCapabilityLines(told)) expect([scope, prompt.includes(line)]).toEqual([scope, true])
      expect(prompt).toContain("- form: no, because this workspace's plan does not include saved forms")
      expect(prompt).toContain('- template: no, because a page job does not build one')
      expect(prompt).toContain(AI_EVAL_CAPABILITIES_GRADER_NOTE)
      expect(prompt).toContain(AI_EVAL_INLINE_GRADER_NOTE)
      // Read before the output it is graded against.
      expect(prompt.indexOf(AI_EVAL_INLINE_GRADER_NOTE)).toBeLessThan(prompt.indexOf('Output:\n'))
    }
  })

  it('says nothing of a workspace for a case that describes none, and nothing of building inline where one keeps components', () => {
    const plan = { ...answer, scope: 'plan', plan: { reuse: [] }, answer: null } as const
    const none = aiEvalGraderPrompt(page, plan)
    expect(none).not.toContain('What this job may create')
    expect(none).not.toContain(AI_EVAL_CAPABILITIES_GRADER_NOTE)
    const paid = aiEvalGraderPrompt({ ...page, capabilities: aiUnrestrictedPlanCapabilities() }, plan)
    expect(paid).toContain(AI_EVAL_CAPABILITIES_GRADER_NOTE)
    expect(paid).not.toContain(AI_EVAL_INLINE_GRADER_NOTE)
  })

  it('excuses an empty screens list for exactly the kinds the plan step tells to plan none (AGL-3022)', () => {
    // A grader that does not know this marks a template plan down for
    // planning no screens, which is what the plan step told it to do.
    const kinds = 'a component, layout, template, form or email job'
    expect(AI_JOB_PLAN_INSTRUCTIONS.map((block) => block.text).join('\n')).toContain(
      `${kinds} plans no screens`,
    )
    expect(AI_EVAL_PLAN_GRADER_NOTE).toContain(`${kinds} has an empty screens list by design`)
  })

  it('tells a plan’s grader that a search is an element the palette has, never a new form (AGL-3022)', () => {
    // A grader that does not know the platform's search elements rewards a
    // plan for creating a form to search with.
    for (const id of ['searchBox', 'collectionSearch']) {
      expect([id, AI_EVAL_PLAN_GRADER_NOTE.includes(`${AI_PALETTE[id].displayName} element`)]).toEqual([
        id,
        true,
      ])
    }
    expect(AI_EVAL_PLAN_GRADER_NOTE).toContain('never a new form')
  })
})

describe('the grader of a built page (AGL-3073)', () => {
  const { rubric: recordedGrade, ...recorded } = AI_FREE_PAGE_BUILT_RECORDING.candidate
  const plannedScreen = (recorded.plan as { screens: Array<{ seoTitle: string; seoDescription: string }> }).screens[0]

  it('is shown the recorded About page’s plan, address, listing and layout, which its tree alone never showed it', () => {
    // The grade this recording carries marks the page down for all three.
    expect(recordedGrade.notes).toContain('no layout is declared or created')
    expect(recordedGrade.notes).toContain('there is no `main` landmark')
    expect(recordedGrade.notes).toContain('no slug, search title/description or nav entry')

    const prompt = aiEvalGraderPrompt(freePage, recorded)
    const beforeOutput = (line: string) => prompt.indexOf(line) >= 0 && prompt.indexOf(line) < prompt.indexOf('Output:\n')
    for (const line of [
      // The plan: the layout it creates, and every section in order.
      '- creates the layout "main-layout": Site has no layout yet; header, navigation and footer must live in a layout rather than on the page. Holds: header: logo + nav links (Home, About, Practice Areas, Contact); footer: firm name, address, phone, copyright.',
      '  1. hero',
      '  7. how we work with clients, 3 items',
      '  8. request a consultation form',
      // The page as its plan built it: a recording made before the draft's
      // screen was kept says so, and gives what the page step built from.
      "The page as its plan built it (the recording kept no record of the draft's screen):",
      '- address: /about',
      `- search title, as planned: "${plannedScreen.seoTitle}"`,
      `- search description, as planned: "${plannedScreen.seoDescription}"`,
      '- navigation: an entry for the page is proposed',
      // The layout: created by the plan, built by the job's layout pass, and
      // where the main landmark is.
      `- layout: "main-layout", which the plan creates and this job built before the page. A layout this job builds holds one Layout Slot, where the page renders, and the slot is the page's main landmark; the recording kept no tree of it`,
      AI_EVAL_PAGE_GRADER_NOTE,
    ]) {
      expect([line, beforeOutput(line)]).toEqual([line, true])
    }
    // The page's tree still follows, and whole.
    expect(prompt).toContain('"children":"About Brightwater Law","variant":"h1","component":"h1"')
  })

  it('says a layout it only planned was not built when no layout pass ran', () => {
    const unbuilt = { ...recorded, steps: recorded.steps?.filter((step) => step.step !== 'job.layout') }
    expect(aiEvalGraderPrompt(freePage, unbuilt)).toContain('- layout: "main-layout", which the plan creates. A layout')
  })

  it('outlines the layout a page renders inside, with the main landmark where the published page places it', () => {
    const layout = {
      rootId: '_@_',
      nodes: {
        '_@_': { componentId: 'div', nodes: ['header', 'slot', 'footer'] },
        header: { componentId: 'muiAppBar', props: { component: 'header' }, nodes: ['brand', 'home'] },
        brand: { componentId: 'muiTypography', props: { component: 'p', children: 'Brightwater Law' } },
        home: { componentId: 'muiScreenLink', props: { screenId: 'scr-home', children: 'Home' } },
        slot: { componentId: 'layoutSlot' },
        footer: { componentId: 'section', props: { element: 'footer', children: `Brightwater Law, ${'x'.repeat(60)}` } },
      },
    }
    expect(aiEvalLayoutOutline(layout)).toBe(
      [
        'div',
        '  header · muiAppBar',
        '    p · muiTypography "Brightwater Law"',
        '    muiScreenLink "Home"',
        '  main · layoutSlot ← the page renders here',
        `  footer · section "Brightwater Law, ${'x'.repeat(31)}…"`,
      ].join('\n'),
    )
    // A slot an author made something else leaves the landmark to the root.
    const chosen = { ...layout, nodes: { ...layout.nodes, slot: { componentId: 'layoutSlot', props: { component: 'section' } } } }
    expect(aiEvalLayoutOutline(chosen).split('\n').slice(0, 1)).toEqual(['main · div'])
    // A long layout lists its first elements and counts the rest.
    const long = {
      rootId: '_@_',
      nodes: {
        '_@_': { componentId: 'div', nodes: Array.from({ length: 50 }, (_, index) => `n${index}`) },
        ...Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`n${index}`, { componentId: 'muiDivider' }])),
      },
    }
    const lines = aiEvalLayoutOutline(long).split('\n')
    expect(lines).toHaveLength(AI_EVAL_LAYOUT_OUTLINE_MAX_LINES + 1)
    expect(lines.at(-1)).toBe(`… and ${51 - AI_EVAL_LAYOUT_OUTLINE_MAX_LINES} more elements`)
  })

  it('sends a page’s tree without the keys the store keeps for itself, and anything else as it was', () => {
    const sentText = aiEvalGraderOutput(recorded.answer)
    const output = JSON.parse(sentText) as { tree: { rootId: string; nodes: Record<string, Record<string, unknown>> } }
    const stored = (recorded.answer as { tree: { nodes: Record<string, Record<string, unknown>> } }).tree.nodes
    expect(Object.keys(output.tree.nodes)).toEqual(Object.keys(stored))
    const storeKeys = new Set(['$id', 'parentId', 'type', 'pluginId'])
    for (const [id, node] of Object.entries(output.tree.nodes)) {
      const kept = Object.fromEntries(Object.entries(stored[id]).filter(([key]) => !storeKeys.has(key)))
      expect([id, node]).toEqual([id, kept])
    }
    expect(sentText).not.toMatch(/"\$id"|"parentId"|"pluginId"|"type":"node"/)
    expect(sentText.length).toBeLessThan(JSON.stringify(recorded.answer).length * 0.75)
    // An id that is not the node's key, and a type that is not a node's, say something, and stay.
    expect(JSON.parse(aiEvalGraderOutput({ tree: { rootId: 'a', nodes: { a: { $id: 'b', type: 'text' } } } }))).toEqual({
      tree: { rootId: 'a', nodes: { a: { $id: 'b', type: 'text' } } },
    })
    expect(aiEvalGraderOutput('Fresh bread.')).toBe('Fresh bread.')
    expect(aiEvalGraderOutput({ reuse: [], parentId: 'kept' })).toBe('{"reuse":[],"parentId":"kept"}')
  })

  it('tells the grader of a page with no layout that its root is the landmark, and quotes a listing it lacks as none', () => {
    const screen = { slug: 'about', seoTitle: null, seoDescription: 'Who we are.', nav: false, layout: null }
    const prompt = aiEvalGraderPrompt(freePage, { ...recorded, screen })
    expect(prompt).toContain(
      [
        'The page as built:',
        '- address: /about',
        '- search title: none',
        '- search description: "Who we are."',
        '- navigation: no entry is proposed',
        "- layout: none, so the page's root is its main landmark",
      ].join('\n'),
    )
    expect(prompt).not.toContain('as planned')
  })
})

describe('readAiEvalGrade', () => {
  it('takes whole grades from 1 to 5 and a null reuse, and nothing else', () => {
    expect(readAiEvalGrade({ structure: 5, copy: 3, reuse: null, notes: '' }, 'g')).toEqual({
      structure: 5,
      copy: 3,
      reuse: null,
      grader: 'g',
    })
    expect(readAiEvalGrade({ structure: 0, copy: 3, reuse: 2 }, 'g')).toBeNull()
    expect(readAiEvalGrade({ structure: 4.5, copy: 3, reuse: 2 }, 'g')).toBeNull()
  })
})
