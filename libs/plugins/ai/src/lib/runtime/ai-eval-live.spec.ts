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
import { crmActionRecipe } from '@aglyn/aglyn/app-utils/actions'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { AI_PAGE_SECTION_INLINE_LINE, AI_PAGE_SECTION_TOOL } from '../jobs/ai-job-page-sections'
import { AI_JOB_PLAN_INSTRUCTIONS, AI_JOB_PLAN_SCOPES } from '../jobs/ai-job-plan-step'
import { createAiJobProductsStep } from '../jobs/ai-job-products-step'
import { createAiJobWorkflowStep } from '../jobs/ai-job-workflow-step'
import { loadAiMediaSharp } from '../jobs/ai-media-asset'
import { AI_PRODUCT_IMAGE_MAX_EDGE_PX, encodeAiProductImage } from '../jobs/ai-product-image'
import { AI_FREE_PAGE_BUILT_RECORDING } from '../jobs/fixtures/ai-free-page-built-recording'
import { AI_FREE_PAGE_RECORDED_PLAN } from '../jobs/fixtures/ai-free-page-recording'
import { AI_FREE_PAGE_FIXTURE } from '../jobs/fixtures/ai-page-briefs'
import type { AiAutomationRecords } from '../model/ai-automation-draft'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import { AI_JOB_KINDS, type AiJob } from '../model/ai-jobs.types'
import {
  aiPlanCapabilitiesForJob,
  aiPlanCapabilityLines,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import { aiAutomationCapabilities } from '../model/ai-workflow-job'
import { aiProductsJobInputs } from '../model/ai-products'
import { AI_UPSTREAM_FAILURE_COPY, AiUpstreamError } from '../providers/contract'
import {
  AI_CATALOG_TOOL_NAME,
  AI_CATEGORIES_TOOL_NAME,
  AI_PRODUCT_COPY_TOOL_NAME,
} from '../tools/ai-products-tool'
import { AI_SEO_FIELDS_TOOL_NAME } from '../tools/ai-seo-tool'
import { AI_THEME_TOOL_NAME } from '../tools/ai-theme-tool'
import { AI_AUTOMATION_TOOL_NAME, AI_WORKFLOW_EXPLANATION_TOOL_NAME } from '../tools/ai-workflow-tool'
import { AI_DOCTRINE_RULES } from './ai-doctrine-validators'
import {
  AI_EVAL_KINDS,
  AI_EVAL_SITE_ID,
  readAiEvalCase,
  scoreAiEvalCandidate,
  type AiEvalCase,
} from './ai-eval'
import {
  AI_EVAL_CAPABILITIES_GRADER_NOTE,
  AI_EVAL_INLINE_GRADER_NOTE,
  AI_EVAL_INLINE_USES_GRADER_NOTE,
  AI_EVAL_LAYOUT_OUTLINE_MAX_LINES,
  AI_EVAL_PAGE_GRADER_NOTE,
  AI_EVAL_PHOTO_GRADER_NOTE,
  AI_EVAL_PHOTO_UNSHOWN_GRADER_NOTE,
  AI_EVAL_PLAN_GRADER_NOTE,
  AI_EVAL_RUBRIC_TOOL,
  AI_EVAL_UNRECORDED_DOORS,
  AiEvalLiveRefusedError,
  aiEvalCasesNamed,
  aiEvalGraderOutput,
  aiEvalGraderPrompt,
  aiEvalLayoutOutline,
  aiEvalPlanOutline,
  aiEvalRecorderFor,
  readAiEvalGrade,
  recordAiEvalLive,
} from './ai-eval-live'
import { aiEvalMemoryFirestore } from './ai-eval-memory-firestore'
import { AI_PALETTE } from './ai-palette.generated'
import { validateAiMessages } from './ai-runtime'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const fixture = (path: string): AiEvalCase =>
  readAiEvalCase(JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'ai-eval', 'cases', path), 'utf8')), path)

const page = fixture('page/roof-repair-service.json')
const layout = fixture('layout/bakery-site-layout.json')
const freePage = fixture('page/free-law-firm-about.json')
const text = fixture('text/bakery-tagline.json')
const theme = fixture('theme/warmer-accents.json')
const section = fixture('section/storm-leak-call-to-action.json')
const email = fixture('email/weekend-special.json')
const draft = fixture('workflow/form-newsletter-lead-welcome.json')
const explain = fixture('workflow/explain-welcome-new-lead.json')
const lampCopy = fixture('product/brass-desk-lamp-copy.json')
const mugCopy = fixture('product/stoneware-mug-photo-copy.json')
const catalog = fixture('catalog/asheville-candle-studio.json')
const categories = fixture('categories/trail-running-shop.json')

const FIXTURES_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'fixtures')
const readFixture = async (file: string) => readFileSync(join(FIXTURES_DIR, file))

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
  mockRunAiRequest.mockImplementation(async (request: { tools?: Array<{ name: string }>; messages?: unknown }) => {
    const tool = request.tools?.[0]?.name
    if (tool === AI_BUILD_PLAN_TOOL.name) return toolCall(tool, planned.candidates[0].plan)
    if (tool === AI_AUTOMATION_TOOL_NAME) return toolCall(tool, draft.candidates[0].answer)
    if (tool === AI_WORKFLOW_EXPLANATION_TOOL_NAME) return toolCall(tool, explain.candidates[0].answer)
    if (tool === AI_PRODUCT_COPY_TOOL_NAME) {
      const product = JSON.stringify(request.messages).includes('Product: Stoneware mug') ? mugCopy : lampCopy
      return toolCall(tool, product.candidates[0].answer)
    }
    if (tool === AI_CATALOG_TOOL_NAME) return toolCall(tool, catalog.candidates[0].answer)
    if (tool === AI_CATEGORIES_TOOL_NAME) return toolCall(tool, categories.candidates[0].answer)
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
  // An answer cut off at its ceiling says so; a suite that arms one on purpose is not a report of it.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
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

describe('the automation and products recorders (AGL-3074)', () => {
  /** What a request asks of its model, whoever sends it. */
  const asked = (request: Record<string, unknown>) => ({
    model: request['model'],
    system: request['system'],
    tools: request['tools'],
    messages: request['messages'],
    maxTokens: request['maxTokens'],
    thinking: request['thinking'],
    effort: request['effort'],
  })
  const requestsFor = (toolName: string) =>
    mockRunAiRequest.mock.calls.map((call) => call[0]).filter((request) => request.tools?.[0]?.name === toolName)

  /** A job the step's runner is handed, on the harness's own site. */
  const job = (kind: AiJob['kind'], evalCase: AiEvalCase, inputs: Record<string, string>): AiJob =>
    ({
      $id: 'job-runner',
      orgId: 'org-runner',
      hostId: AI_EVAL_SITE_ID,
      kind,
      status: 'running',
      brief: evalCase.brief,
      inputs,
      steps: [],
      outputs: [],
      creditsReserved: 0,
      creditsSpent: 0,
      createdBy: 'uid-runner',
    }) as unknown as AiJob

  /** The automation writer the workflows plugin registers, reduced to what a draft asks of it. */
  const writer: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: () => ({ ok: true, facts: {} }),
    read: async () => null,
    write: async (request) => ({ ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }),
  }

  const records = draft.automationRecords as AiAutomationRecords
  const siteDoc = { [`hosts/${AI_EVAL_SITE_ID}`]: { orgId: 'org-runner', subdomain: 'runner' } }

  it('keeps what the provider wrote on a draft its ceiling cut off, so a run can be read after it ends (AGL-3143)', async () => {
    // The shape the last live run could not diagnose: a whole ceiling spent
    // and a tool call that parsed to one step. The recording is the only
    // place those bytes outlive the run that paid for them.
    const runaway = `{"steps":[{"note":"${'y'.repeat(300)}`
    armReferenceAnswers()
    const answers = mockRunAiRequest.getMockImplementation() as (request: {
      tools?: Array<{ name: string }>
    }) => Promise<Record<string, unknown>>
    mockRunAiRequest.mockImplementation(async (request: { tools?: Array<{ name: string }> }) => {
      const answer = await answers(request)
      return request.tools?.[0]?.name === AI_AUTOMATION_TOOL_NAME
        ? { ...answer, toolUse: [{ name: AI_AUTOMATION_TOOL_NAME, input: {} }], stopReason: 'max_tokens', rawOutput: runaway }
        : answer
    })
    const [{ candidate }] = (await recordAiEvalLive([draft], LIVE)).recorded
    expect(candidate.note).toContain('needs review:')
    expect(candidate.rawOutput).toBe(runaway)
  })

  it('records an automation draft through the workflow step’s own generation, sending what the step’s runner sends for the same site', async () => {
    // A workspace whose plan runs the CRM and neither webhooks nor bookings,
    // as the case describes it.
    const org = { plan: 'pro', billingStatus: 'active', entitlements: { features: { bookings: false, webhooks: false } } } as const
    expect(aiAutomationCapabilities(org)).toEqual(draft.automationCapabilities)

    armReferenceAnswers()
    const [{ candidate }] = (await recordAiEvalLive([draft], LIVE)).recorded
    const [recorded] = requestsFor(AI_AUTOMATION_TOOL_NAME)

    mockRunAiRequest.mockClear()
    const outcome = await createAiJobWorkflowStep({ writerFor: () => writer, readRecords: async () => records })({
      job: job('workflow', draft, { mode: 'draft' }),
      stepIndex: 0,
      now: new Date(0),
      firestore: aiEvalMemoryFirestore(siteDoc).firestore,
      org,
      modelFor: () => LIVE.model,
    })
    expect(outcome.failure).toBeUndefined()
    const [sentByRunner] = requestsFor(AI_AUTOMATION_TOOL_NAME)
    expect(asked(recorded)).toEqual(asked(sentByRunner))
    expect(String(recorded.messages[0].content)).toContain('form-newsletter · Newsletter sign-up · email, firstName')

    // The tool's own input is what it keeps, scored like any answer, with its spend metered.
    expect(candidate).toMatchObject({ source: 'recorded', scope: 'full', step: 'job.workflow', answer: draft.candidates[0].answer })
    expect(candidate.steps).toEqual([
      { step: 'job.workflow', model: LIVE.model, usage: USAGE, estCostUsd: 0.004, credits: assistCreditsFromUsd(0.004) },
    ])
    expect(scoreAiEvalCandidate(draft, candidate).pass).toBe(true)
  })

  it('records an explanation of a saved automation from its outline, as the step’s runner explains the same action', async () => {
    // The case explains the recipe as the platform builds it.
    expect(explain.automation?.action).toEqual(crmActionRecipe('welcomeNewLead')?.build())

    armReferenceAnswers()
    const [{ candidate }] = (await recordAiEvalLive([explain], LIVE)).recorded
    const [recorded] = requestsFor(AI_WORKFLOW_EXPLANATION_TOOL_NAME)
    const [grade] = requestsFor(AI_EVAL_RUBRIC_TOOL.name)
    expect(String(recorded.messages[0].content)).toContain('Asked: what this automation does.')
    expect(String(recorded.messages[0].content)).toContain('Assign the contact an owner: by round robin.')

    mockRunAiRequest.mockClear()
    const action = explain.automation?.action
    await createAiJobWorkflowStep({
      readTarget: async () => ({ type: 'action', id: 'act-welcome', name: 'Welcome a new lead', action } as never),
      readRecords: async () => records,
    })({
      job: job('workflow', explain, { mode: 'explain', targetType: 'action', targetId: 'act-welcome' }),
      stepIndex: 0,
      now: new Date(0),
      firestore: aiEvalMemoryFirestore(siteDoc).firestore,
      org: {},
      modelFor: () => LIVE.model,
    })
    const [sentByRunner] = requestsFor(AI_WORKFLOW_EXPLANATION_TOOL_NAME)
    expect(asked(recorded)).toEqual(asked(sentByRunner))

    expect(candidate).toMatchObject({ step: 'job.workflow', answer: explain.candidates[0].answer })
    expect(scoreAiEvalCandidate(explain, candidate).pass).toBe(true)
    // The grader reads the automation it grades an explanation of.
    expect(String(grade.messages[0].content)).toContain(`The request the answer was written from:\n${String(recorded.messages[0].content)}`)
  })

  it('asks why a failed run failed where the case gives the run, with the run’s outline', async () => {
    const run = { result: 'failed', trigger: 'contactCreated', action: 'Ran 4 steps with errors: No teammates in the round robin' }
    armReferenceAnswers()
    await recordAiEvalLive([{ ...explain, automation: { ...explain.automation, run } as AiEvalCase['automation'] }], LIVE)
    const content = String(requestsFor(AI_WORKFLOW_EXPLANATION_TOOL_NAME)[0].messages[0].content)
    expect(content).toContain('Asked: why a run of this automation failed.')
    expect(content).toContain('- No teammates in the round robin')
  })

  it('records product copy through the products step’s runner, its photo sent through the step’s resize-and-strip path with the camera’s metadata gone', async () => {
    const sharp = (await loadAiMediaSharp()) as (input: Buffer) => { metadata: () => Promise<Record<string, any>> }
    const photo = await readFixture('product/stoneware-mug.jpg')
    // The committed photo carries what a camera leaves, and is larger than a request takes.
    const original = await sharp(photo).metadata()
    expect(photo.length).toBeLessThan(10_000)
    expect(Math.max(original['width'], original['height'])).toBeGreaterThan(AI_PRODUCT_IMAGE_MAX_EDGE_PX)
    for (const planted of ['Acme Camera', 'Field 2', 'Jane Potter']) {
      expect([planted, (original['exif'] as Buffer).toString('latin1').includes(planted)]).toEqual([planted, true])
    }

    armReferenceAnswers()
    const options = { ...LIVE, model: 'claude-sonnet-5', graderModel: 'claude-opus-5', readFixture }
    const [{ candidate }] = (await recordAiEvalLive([mugCopy], options)).recorded
    const [recorded] = requestsFor(AI_PRODUCT_COPY_TOOL_NAME)
    const [picture, words] = recorded.messages[0].content
    expect(picture).toMatchObject({ type: 'image', mediaType: 'image/jpeg' })
    const sent = Buffer.from(picture.data, 'base64')
    // Exactly the JPEG the step makes of the photo: upright, fitted, re-encoded.
    expect(sent.equals(await encodeAiProductImage(photo))).toBe(true)
    const shown = await sharp(sent).metadata()
    expect(shown).toMatchObject({ format: 'jpeg', width: AI_PRODUCT_IMAGE_MAX_EDGE_PX, height: 614 })
    expect([shown['exif'], shown['icc'], shown['xmp'], shown['iptc']]).toEqual([undefined, undefined, undefined, undefined])
    expect(sent.toString('latin1')).not.toMatch(/Acme Camera|Field 2|Jane Potter/)
    // A picture the runtime's own guard passes, for a model that reads one.
    expect(() => validateAiMessages(recorded.messages, () => true)).not.toThrow()
    expect(words.text).toContain('Store: Hollow Oak Pottery')
    expect(words.text).toContain('- cat-kitchen: Kitchen')
    expect(words.text).toContain('Photo: attached')

    // The request the products step sends for the same store and product.
    mockRunAiRequest.mockClear()
    const store = aiEvalMemoryFirestore({
      [`hosts/${AI_EVAL_SITE_ID}`]: { orgId: 'org-runner', displayName: 'Hollow Oak Pottery', subdomain: 'hollow-oak' },
      ...Object.fromEntries(
        (mugCopy.product?.categories ?? []).map((category) => [`hosts/${AI_EVAL_SITE_ID}/productCategories/${category.id}`, { name: category.name }]),
      ),
    })
    await createAiJobProductsStep({ image: { readBytes: async () => ({ buffer: photo, contentType: 'image/jpeg' }) } })({
      job: job('products', mugCopy, aiProductsJobInputs({ target: 'product', product: mugCopy.product?.facts as never })),
      stepIndex: 0,
      now: new Date(0),
      firestore: store.firestore,
      modelFor: () => 'claude-sonnet-5',
    })
    expect(asked(recorded)).toEqual(asked(requestsFor(AI_PRODUCT_COPY_TOOL_NAME)[0]))

    // The copy read back off the proposal, scored like any answer, with the photo it was written with.
    expect(candidate).toMatchObject({ step: 'job.products', photo: 'read', answer: mugCopy.candidates[0].answer })
    expect(candidate.steps?.map((step) => step.step)).toEqual(['job.products'])
    expect(scoreAiEvalCandidate(mugCopy, candidate).pass).toBe(true)
  })

  it('shows the grader the product and the same photo, and says so', async () => {
    armReferenceAnswers()
    await recordAiEvalLive([mugCopy], { ...LIVE, model: 'claude-sonnet-5', graderModel: 'claude-opus-5', readFixture })
    const [picture] = requestsFor(AI_PRODUCT_COPY_TOOL_NAME)[0].messages[0].content
    const [grade] = requestsFor(AI_EVAL_RUBRIC_TOOL.name)
    const [gradedPicture, gradedWords] = grade.messages[0].content
    expect(gradedPicture).toEqual(picture)
    expect(gradedWords.text).toContain('The request the answer was written from:\nStore: Hollow Oak Pottery\nProduct: Stoneware mug')
    expect(gradedWords.text).toContain(AI_EVAL_PHOTO_GRADER_NOTE)
    // A grader whose model reads no picture is told it was not shown one.
    mockRunAiRequest.mockClear()
    await recordAiEvalLive([mugCopy], { ...LIVE, model: 'claude-sonnet-5', readFixture })
    const [blind] = requestsFor(AI_EVAL_RUBRIC_TOOL.name)
    expect(typeof blind.messages[0].content).toBe('string')
    expect(blind.messages[0].content).toContain(AI_EVAL_PHOTO_UNSHOWN_GRADER_NOTE)
  })

  it('records copy with no photo on a model that reads none, and a catalog and categories off their proposals', async () => {
    armReferenceAnswers()
    const report = await recordAiEvalLive([lampCopy, catalog, categories], LIVE)
    expect(report.skipped).toEqual([])
    const [lamp, candles, running] = report.recorded.map((entry) => entry.candidate)
    expect(lamp).toMatchObject({ step: 'job.products', photo: 'none', answer: lampCopy.candidates[0].answer })
    expect(typeof requestsFor(AI_PRODUCT_COPY_TOOL_NAME)[0].messages[0].content).toBe('string')
    expect(candles).toMatchObject({ step: 'job.products', answer: catalog.candidates[0].answer })
    expect(candles.photo).toBeUndefined()
    // Each discount read back in the tool's own terms, as the reference answered it.
    expect(running).toMatchObject({ step: 'job.products', answer: categories.candidates[0].answer })
    expect(String(requestsFor(AI_CATEGORIES_TOOL_NAME)[0].messages[0].content)).toContain('Categories the store already has: Shoes')
    for (const [evalCase, candidate] of [
      [lampCopy, lamp],
      [catalog, candles],
      [categories, running],
    ] as const) {
      expect([evalCase.id, scoreAiEvalCandidate(evalCase, candidate).pass]).toEqual([evalCase.id, true])
    }
  })

  it('sends, for every products case, the request the products step sends for the store that case describes', async () => {
    const photo = await readFixture('product/stoneware-mug.jpg')
    for (const evalCase of [lampCopy, mugCopy, catalog, categories]) {
      mockRunAiRequest.mockReset()
      armReferenceAnswers()
      await recordAiEvalLive([evalCase], { ...LIVE, model: 'claude-sonnet-5', readFixture })
      const [recorded] = mockRunAiRequest.mock.calls.map((call) => call[0])

      // The store as its own documents hold it: its name, and the categories it keeps.
      mockRunAiRequest.mockReset()
      armReferenceAnswers()
      const kept = evalCase.product?.categories ?? (evalCase.existingCategoryNames ?? []).map((name) => ({ id: `kept-${name.length}`, name }))
      const store = aiEvalMemoryFirestore({
        [`hosts/${AI_EVAL_SITE_ID}`]: { orgId: 'org-runner', ...(evalCase.siteName ? { displayName: evalCase.siteName } : {}) },
        ...Object.fromEntries(kept.map((category) => [`hosts/${AI_EVAL_SITE_ID}/productCategories/${category.id}`, { name: category.name }])),
      })
      const inputs = evalCase.product
        ? aiProductsJobInputs({ target: 'product', product: evalCase.product.facts })
        : aiProductsJobInputs({ target: evalCase.kind === 'catalog' ? 'catalog' : 'categories' })
      await createAiJobProductsStep({ image: { readBytes: async () => ({ buffer: photo, contentType: 'image/jpeg' }) } })({
        job: job('products', evalCase, inputs),
        stepIndex: 0,
        now: new Date(0),
        firestore: store.firestore,
        modelFor: () => 'claude-sonnet-5',
      })
      const [sentByRunner] = mockRunAiRequest.mock.calls.map((call) => call[0])
      expect([evalCase.id, asked(recorded)]).toEqual([evalCase.id, asked(sentByRunner)])
    }
  })

  it('refuses, before any request, to record a case whose media the run cannot read', async () => {
    armReferenceAnswers()
    await expect(recordAiEvalLive([text, mugCopy], LIVE)).rejects.toThrow(`${mugCopy.id} name media`)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('reads a case’s saved automation and its media only in the shapes a recorder can use', () => {
    const raw = (path: string) => JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'ai-eval', 'cases', path), 'utf8'))
    const saved = raw('workflow/explain-welcome-new-lead.json')
    expect(() => readAiEvalCase({ ...saved, automation: { action: { ...saved.automation.action, name: '' } } }, 'x.json')).toThrow(
      'automation.action is not an action the Actions editor would save: Name the action',
    )
    expect(() => readAiEvalCase({ ...saved, automation: {} }, 'x.json')).toThrow('automation.action')
    const mug = raw('product/stoneware-mug-photo-copy.json')
    for (const file of ['../../../.env', '/etc/hosts.jpg', 'product/../../secret.jpg', 'product/stoneware-mug.svg', '']) {
      expect(() => readAiEvalCase({ ...mug, media: { 'mug-photo': file } }, 'x.json')).toThrow('media.mug-photo')
    }
    expect(readAiEvalCase(mug, 'x.json').media).toEqual({ 'mug-photo': 'product/stoneware-mug.jpg' })
  })

  it('knows where production answers every kind no recorder covers, and records workflow and product kinds now', () => {
    const LIB_ROOT = join(__dirname, '..')
    const CALLS_A_MODEL = /\b(?:runAiRequest|runValidatedGeneration)\s*(?:<[^<>()]*>)?\(/
    for (const kind of AI_EVAL_KINDS) {
      const door = AI_EVAL_UNRECORDED_DOORS[kind]
      // Exactly one of the two: a recorder, or a door that says why there is none.
      expect([kind, Boolean(aiEvalRecorderFor(kind)) !== Boolean(door)]).toEqual([kind, true])
      if (!door) continue
      expect([kind, CALLS_A_MODEL.test(readFileSync(join(LIB_ROOT, door.file), 'utf8'))]).toEqual([kind, true])
      if ('route' in door) expect([kind, door.file.startsWith('server/')]).toEqual([kind, true])
      else expect([kind, door.file.startsWith('jobs/'), AI_JOB_KINDS.includes(door.step)]).toEqual([kind, true, true])
    }
    for (const kind of ['workflow', 'product', 'catalog', 'categories'] as const) {
      expect([kind, aiEvalRecorderFor(kind) === null]).toEqual([kind, false])
    }
  })

  it('skips a request route and an unrecorded job step before any request, saying which each is', async () => {
    armReferenceAnswers()
    const report = await recordAiEvalLive([section, email], LIVE)
    expect(report.recorded).toEqual([])
    expect(report.skipped).toEqual([
      {
        caseId: section.id,
        kind: 'section',
        why: 'no recorder: the door that answers this kind is a request route (the copy assistant’s section mode, server/ai-assist.ts), not a job step',
      },
      {
        caseId: email.id,
        kind: 'email',
        why: 'no recorder yet: this kind is answered by the email job step (jobs/ai-job-email-step.ts), which no recorder drives',
      },
    ])
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('keeps the briefs a refused one sits between, and names what was thrown (AGL-3143)', async () => {
    armReferenceAnswers()
    const answers = mockRunAiRequest.getMockImplementation() as (request: {
      tools?: Array<{ name: string }>
    }) => Promise<unknown>
    // The provider refuses the middle brief's own tool, as it refused an
    // automation's before the model ran. The first brief is recorded before
    // the throw and the third is recorded after it.
    mockRunAiRequest.mockImplementation(async (request: { tools?: Array<{ name: string }> }) => {
      if (request.tools?.[0]?.name === AI_THEME_TOOL_NAME) {
        throw new AiUpstreamError(400, false, 'req_refused_theme')
      }
      return answers(request)
    })
    const report = await recordAiEvalLive([text, theme, categories], LIVE)
    expect(report.recorded.map((entry) => entry.caseId)).toEqual([text.id, categories.id])
    expect(report.failed).toEqual([
      {
        caseId: theme.id,
        kind: 'theme',
        step: 'record',
        error: `AiUpstreamError: ${AI_UPSTREAM_FAILURE_COPY}`,
        requestId: 'req_refused_theme',
      },
    ])
  })

  it('records a brief whose grade throws as a failure of its grading, not of its answer (AGL-3143)', async () => {
    armReferenceAnswers()
    const answers = mockRunAiRequest.getMockImplementation() as (request: {
      tools?: Array<{ name: string }>
    }) => Promise<unknown>
    mockRunAiRequest.mockImplementation(async (request: { tools?: Array<{ name: string }> }) => {
      if (request.tools?.[0]?.name === AI_EVAL_RUBRIC_TOOL.name) throw new Error('the grader is out of quota')
      return answers(request)
    })
    const report = await recordAiEvalLive([text], LIVE)
    // THE ANSWER SURVIVES ITS GRADER (AGL-3143). It was bought before the
    // grade was asked for, so a grader that throws costs its own request and
    // nothing else: the answer is recorded with no grade rather than with an
    // invented one, which would read as a bad answer and pull the kind's
    // floor down for something the model never did.
    expect(report.recorded).toHaveLength(1)
    expect(report.recorded[0].caseId).toBe(text.id)
    expect(report.recorded[0].candidate.answer).toEqual(String(text.candidates[0].answer))
    expect(report.recorded[0].candidate.rubric).toBeNull()
    expect(report.failed).toEqual([
      {
        caseId: text.id,
        kind: 'text',
        step: 'grade',
        error: 'Error: the grader is out of quota',
        requestId: null,
      },
    ])
  })

  it('scores an ungraded answer as passing nothing, rather than as a grade of one (AGL-3143)', () => {
    // The difference the record has to keep: a grade of 1/1 says the model
    // answered badly, and a missing grade says nobody looked. Both fail, and
    // only one of them is true.
    const ungraded = scoreAiEvalCandidate(text, {
      source: 'recorded',
      step: null,
      model: null,
      effort: null,
      plan: null,
      answer: text.candidates[0].answer,
      usage: null,
      rubric: null,
    })
    expect(ungraded.checks.rubric).toBe(false)
    expect(ungraded.pass).toBe(false)
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

  it('tells the grader that a section built inline can only leave its `uses` empty (AGL-3143)', () => {
    // `uses` names an inventory id or a creation, and a workspace that keeps
    // no reusable components and may create none has neither — so the grader
    // marked the Free brief's plan down for the only list it could write.
    const outline = aiEvalPlanOutline({
      screens: [{ title: 'About', sections: [{ name: 'contact form', uses: [], items: 0 }] }],
    })
    expect(outline).toContain('1. contact form')
    expect(outline).not.toContain('placing')
    for (const scope of ['plan', 'full'] as const) {
      const prompt = aiEvalGraderPrompt(freePage, {
        ...answer,
        scope,
        plan: { screens: [{ title: 'About', sections: [{ name: 'contact form', uses: [], items: 0 }] }] },
        answer: { tree: {} },
      })
      expect([scope, prompt.includes(AI_EVAL_INLINE_USES_GRADER_NOTE)]).toEqual([scope, true])
      // Read before the output it is graded against.
      expect(prompt.indexOf(AI_EVAL_INLINE_USES_GRADER_NOTE)).toBeLessThan(prompt.indexOf('Output:\n'))
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
    // A workspace that keeps components can place one, so the empty-`uses`
    // note would excuse a plan that should have named it.
    expect(paid).not.toContain(AI_EVAL_INLINE_USES_GRADER_NOTE)
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
