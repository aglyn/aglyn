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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import { AI_THEME_TOOL_NAME } from '../tools/ai-theme-tool'
import { readAiEvalCase, scoreAiEvalCandidate, type AiEvalCase } from './ai-eval'
import {
  AI_EVAL_PLAN_GRADER_NOTE,
  AI_EVAL_RUBRIC_TOOL,
  AiEvalLiveRefusedError,
  aiEvalGraderPrompt,
  readAiEvalGrade,
  recordAiEvalLive,
} from './ai-eval-live'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const fixture = (path: string): AiEvalCase =>
  readAiEvalCase(JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'ai-eval', 'cases', path), 'utf8')), path)

const page = fixture('page/roof-repair-service.json')
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

/** The fake provider answers each door as the fixture's reference answer would. */
function armReferenceAnswers(grade: Record<string, unknown> = { structure: 4, copy: 4, reuse: 5, notes: 'Holds up.' }) {
  mockRunAiRequest.mockImplementation(async (request: { tools?: Array<{ name: string }> }) => {
    const tool = request.tools?.[0]?.name
    if (tool === AI_BUILD_PLAN_TOOL.name) return toolCall(tool, page.candidates[0].plan)
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
    const [{ candidate }] = (await recordAiEvalLive([page], LIVE)).recorded
    expect(candidate).toMatchObject({ scope: 'plan', step: 'job.plan', answer: null })
    expect(mockRunAiRequest.mock.calls[0][0].system[0].text).toContain('How to build on this platform.')
    const score = scoreAiEvalCandidate(page, candidate)
    expect(score.checks).toEqual({ readable: null, rules: null, budget: null, plan: true, rubric: true })
    expect(score.pass).toBe(true)
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
