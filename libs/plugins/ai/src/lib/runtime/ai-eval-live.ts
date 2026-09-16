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

import { createAiJobPlanStep } from '../jobs/ai-job-plan-step'
import { runAiJobTextStep } from '../jobs/ai-job-text-step'
import { aiJobThemeCheck, aiJobThemeGeneration, aiJobThemeMode } from '../jobs/ai-job-theme-step'
import type { AiJob } from '../model/ai-jobs.types'
import { aiDefaultModelFor, type AiStepKind } from '../providers/catalog'
import type { AiProvider, AiSystemBlock, AiTool } from '../providers/contract'
import { aiModelForStep, resolveAiProvider } from '../providers/routing'
import { aiSiteInventoryBlock, runValidatedGeneration } from './ai-doctrine'
import {
  AI_EVAL_TREE_OUTPUT,
  type AiEvalCandidate,
  type AiEvalCase,
  type AiEvalKind,
  type AiEvalRubric,
} from './ai-eval'

/**
 * THE EVAL HARNESS, LIVE (AGL-2937): recording new answers from the model.
 *
 * Offline scoring reads fixtures and costs nothing. A live run asks the
 * provider for real answers to the golden briefs, grades each with a
 * stronger model, and hands back recordings the offline harness then scores
 * like any fixture. It spends real money, so it runs only when
 * `AI_EVAL_LIVE=1` names it, and it is never part of CI or a deployment.
 *
 * A recording is only worth having if it measures what production sends. So
 * each recorder answers a brief through the door that answers that kind in
 * production — the plan step's runner, the text step's runner, the theme
 * step's own generation call — with the case's site handed in where the door
 * would read one. Nothing here writes a prompt of its own for a kind.
 *
 * A kind whose door is a request route rather than a job step (the copy
 * assistant's section, element and blog modes, the chat door) has no
 * recorder, and neither does a planned kind's document until its generator
 * lands: its brief records the plan alone. A door that gains a recorder
 * registers it with `registerAiEvalRecorder`.
 */

/** The environment variable a live run must be named by. */
export const AI_EVAL_LIVE_ENV = 'AI_EVAL_LIVE'

export const AI_EVAL_LIVE_REFUSAL =
  `A live eval run asks the AI provider for real answers and spends real money. It runs only when ${AI_EVAL_LIVE_ENV}=1 is set, from a machine that holds a provider key, and never in CI or on a deployment.`

export class AiEvalLiveRefusedError extends Error {
  constructor() {
    super(AI_EVAL_LIVE_REFUSAL)
    this.name = 'AiEvalLiveRefusedError'
  }
}

/** Whether the environment names a live run. */
export function aiEvalLiveAllowed(env: Record<string, string | undefined>): boolean {
  return env[AI_EVAL_LIVE_ENV] === '1'
}

export interface AiEvalLiveOptions {
  env: Record<string, string | undefined>
  /** A provider chosen ahead of the registered ones; specs use it. */
  provider?: AiProvider
  /** The model every recorder asks, in place of the routing table's answer. */
  model?: string
  /** The grader's model; the provider's deepest tier when absent. */
  graderModel?: string
  now?: Date
}

/** An answer to one brief, before it is graded. */
export type AiEvalRecordedAnswer = Omit<AiEvalCandidate, 'rubric'>

export type AiEvalRecorder = (
  evalCase: AiEvalCase,
  options: AiEvalLiveOptions,
) => Promise<AiEvalRecordedAnswer>

const recorders = new Map<AiEvalKind, AiEvalRecorder>()

/** Idempotent per kind; last registration wins. */
export function registerAiEvalRecorder(kind: AiEvalKind, recorder: AiEvalRecorder): void {
  recorders.set(kind, recorder)
}

export function aiEvalRecorderFor(kind: AiEvalKind): AiEvalRecorder | null {
  return recorders.get(kind) ?? null
}

const EVAL_ORG = 'eval-org'

/** A job for a golden brief, in the shape a step runner reads. */
function evalJob(evalCase: AiEvalCase, kind: AiJob['kind']): AiJob {
  const now = new Date(0)
  return {
    $id: `eval-${evalCase.id}`,
    orgId: EVAL_ORG,
    hostId: evalCase.inventory?.hostId ?? null,
    kind,
    status: 'running',
    brief: evalCase.brief,
    inputs: {},
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'eval',
    createdAt: now as unknown as AiJob['createdAt'],
    updatedAt: now as unknown as AiJob['updatedAt'],
    expiresAt: now as unknown as AiJob['expiresAt'],
  }
}

/**
 * The model a step runner is handed: the one the run names, else the routing
 * table's. A runner reaches its provider through the runtime's registry.
 */
function modelFor(options: AiEvalLiveOptions): (step: AiStepKind) => string | undefined {
  return (step) => options.model ?? aiModelForStep(step)
}

/** Runs the doctrine's call with the provider a live run chose, when it chose one. */
function withProvider<T extends object>(input: T, options: AiEvalLiveOptions): T {
  return options.provider ? { ...input, provider: options.provider } : input
}

/** A planned kind's brief, recorded through the plan step: the plan alone. */
const recordPlan: AiEvalRecorder = async (evalCase, options) => {
  const kind = evalCase.kind as AiJob['kind']
  const runner = createAiJobPlanStep({
    readInventory: async () => {
      if (!evalCase.inventory) throw new Error(`${evalCase.id} has no inventory to plan from`)
      return evalCase.inventory
    },
    // No plan reuse in a recording (AGL-2937): the point of a live run is to
    // measure what the model answers for this brief, and a reused plan would
    // record someone else's answer as this case's. There is no workspace to
    // reuse from here either — a recorder runs off a fixture, not a job.
    findPlansByKey: null,
  })
  const outcome = await runner({
    job: evalJob(evalCase, kind),
    stepIndex: 0,
    now: options.now ?? new Date(),
    firestore: {} as FirebaseFirestore.Firestore,
    modelFor: modelFor(options),
  })
  return {
    source: 'recorded',
    scope: 'plan',
    step: 'job.plan',
    model: outcome.model,
    effort: outcome.effort ?? null,
    plan: outcome.plan ? { reuse: outcome.plan.reuse, create: outcome.plan.create, screens: outcome.plan.screens } : null,
    answer: null,
    usage: outcome.usage,
    note: outcome.review?.reason === 'doctrine' ? `needs review: ${outcome.review.message}` : undefined,
  }
}

/** A text brief, recorded through the text step. */
const recordText: AiEvalRecorder = async (evalCase, options) => {
  const outcome = await runAiJobTextStep({
    job: evalJob(evalCase, 'text'),
    stepIndex: 0,
    now: options.now ?? new Date(),
    firestore: {} as FirebaseFirestore.Firestore,
    modelFor: modelFor(options),
  })
  return {
    source: 'recorded',
    scope: 'full',
    step: 'job.text',
    model: outcome.model,
    effort: outcome.effort ?? null,
    plan: null,
    answer: outcome.outputs[0]?.text ?? null,
    usage: outcome.usage,
  }
}

/**
 * A theme brief, recorded through the theme step's own generation call. The
 * tool's raw input is kept, because that is what the harness scores; the
 * site's theme comes from the case rather than a host document.
 */
const recordTheme: AiEvalRecorder = async (evalCase, options) => {
  const model = options.model ?? aiModelForStep('job.theme')
  let raw: Record<string, unknown> | null = null
  const generation = aiJobThemeGeneration({
    brief: evalCase.brief,
    mode: aiJobThemeMode(undefined),
    theme: evalCase.siteTheme,
    source: evalCase.themeSource ?? 'default',
    brand: [],
    model,
  })
  const result = await runValidatedGeneration(
    'theme',
    withProvider(
      {
        ...generation,
        check: (answer: Record<string, unknown>) => {
          raw = answer
          return aiJobThemeCheck(answer)
        },
      },
      options,
    ),
  )
  return {
    source: 'recorded',
    scope: 'full',
    step: 'job.theme',
    model: result.model,
    effort: result.effort,
    plan: null,
    answer: result.status === 'refused' ? null : raw,
    usage: result.usage,
  }
}

for (const kind of Object.keys(AI_EVAL_TREE_OUTPUT) as AiEvalKind[]) {
  // A section rewrite is the copy assistant's, a request route: no plan step.
  if (kind !== 'section' && kind !== 'email') registerAiEvalRecorder(kind, recordPlan)
}
registerAiEvalRecorder('text', recordText)
registerAiEvalRecorder('theme', recordTheme)

// ── The grader ────────────────────────────────────────────────────────────

export const AI_EVAL_RUBRIC_TOOL: AiTool = {
  name: 'grade_output',
  description: 'Grade the output against the brief it was built from.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['structure', 'copy', 'reuse', 'notes'],
    properties: {
      structure: {
        type: 'integer',
        description: 'From 1 (fails) to 5 (excellent): organized the way the brief needs, with nothing missing or extra.',
      },
      copy: {
        type: 'integer',
        description: 'From 1 to 5: the words fit the brief, the site and its audience, with no filler.',
      },
      reuse: {
        anyOf: [{ type: 'integer' }, { type: 'null' }],
        description: 'From 1 to 5: reuses what the site inventory lists before creating, and creates only what nothing listed can do. Null when the output places nothing.',
      },
      notes: { type: 'string', description: 'One or two sentences on the lowest grade.' },
    },
  },
}

export const AI_EVAL_GRADER_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text:
      'You grade an output an AI produced for a website builder, against the brief it was built from and the site it was built for. ' +
      'Grade three things from 1 to 5: structure, copy and reuse, as the grade_output tool describes them. ' +
      'A 3 is usable as it is; a 5 is what a careful professional would have made. Judge only what you are shown, and answer through grade_output.',
  },
]

/**
 * What a build plan is, for the grader that grades one (AGL-3022).
 *
 * A plan is the proposal a member confirms, not the document the generation
 * step writes afterwards, and `AI_BUILD_PLAN_TOOL` gives it nowhere to put a
 * node tree, a heading order, a landmark or a line of body copy. Graded
 * against a finished page it loses marks for every one of those, on structure
 * and on copy alike, and the grade then measures the schema rather than the
 * answer. So the grader is told the shape it is reading, and that the only
 * words a plan writes are the ones `aiPlanCopy` collects.
 */
export const AI_EVAL_PLAN_GRADER_NOTE =
  'A build plan is not the finished output: it is the proposal a member confirms before anything is generated. ' +
  'It holds only what it reuses by inventory id, what it creates and why, and its screens — each with a title, ' +
  'slug, layout, template, nav flag, search title and description, and sections named with what they place and ' +
  'how many items they hold. A plan has no node tree, no heading order, no landmarks, no theme tokens, no field ' +
  'labels or validation, and no body copy; all of those belong to the generation step that runs once the plan is ' +
  'confirmed. Grade structure on whether the plan proposes the right screens, sections, fields and creations for ' +
  'the brief, and copy on the only words a plan writes: screen titles, search titles and descriptions, and the ' +
  'names and rationales of what it creates. Do not mark a plan down for anything a plan cannot hold.'

/** The grader's user turn: the brief, its site, and the answer — copy as written, anything else as JSON. */
export function aiEvalGraderPrompt(evalCase: AiEvalCase, answer: AiEvalRecordedAnswer): string {
  const output = answer.scope === 'plan' ? answer.plan : answer.answer
  return [
    `Output kind: ${evalCase.kind}${answer.scope === 'plan' ? ' (its build plan)' : ''}`,
    ...(answer.scope === 'plan' ? [AI_EVAL_PLAN_GRADER_NOTE] : []),
    `Brief: ${evalCase.brief}`,
    aiSiteInventoryBlock(evalCase.inventory),
    `Output:\n${typeof output === 'string' ? output : JSON.stringify(output)}`,
  ].join('\n\n')
}

/** A grade tool call read as a rubric; `null` when a grade is missing. */
export function readAiEvalGrade(
  answer: Record<string, unknown>,
  grader: string,
): AiEvalRubric | null {
  const grade = (value: unknown): number | null => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null
  }
  const structure = grade(answer['structure'])
  const copy = grade(answer['copy'])
  if (structure === null || copy === null) return null
  return {
    structure,
    copy,
    reuse: answer['reuse'] === null ? null : grade(answer['reuse']),
    grader,
    ...(typeof answer['notes'] === 'string' && answer['notes'] ? { notes: answer['notes'] } : {}),
  }
}

/** Grade one recorded answer with a stronger model, through the doctrine's loop. */
export async function gradeAiEvalCandidate(
  evalCase: AiEvalCase,
  answer: AiEvalRecordedAnswer,
  options: AiEvalLiveOptions,
): Promise<AiEvalRubric> {
  const providerId = (options.provider ?? resolveAiProvider())?.id
  const model = options.graderModel ?? (providerId ? aiDefaultModelFor(providerId, 'deep') : undefined)
  if (!model) throw new Error('no grader model: the provider serves no deep tier and none was named')
  const result = await runValidatedGeneration(
    'eval-grade',
    withProvider(
      {
        model,
        instructions: AI_EVAL_GRADER_INSTRUCTIONS,
        messages: [{ role: 'user' as const, content: aiEvalGraderPrompt(evalCase, answer) }],
        tool: AI_EVAL_RUBRIC_TOOL,
        maxTokens: 2_000,
        thinking: 'adaptive' as const,
        check: (raw: Record<string, unknown>) => {
          const rubric = readAiEvalGrade(raw, model)
          return rubric
            ? { value: rubric, violations: [] }
            : {
                value: null,
                violations: [{ rule: null, code: 'grade-missing', message: 'Every grade is a whole number from 1 to 5.' }],
              }
        },
      },
      options,
    ),
  )
  if (result.status !== 'ok') {
    return { structure: 1, copy: 1, reuse: null, grader: model, notes: `the grader returned ${result.status}` }
  }
  return result.value
}

export interface AiEvalLiveReport {
  recorded: Array<{ caseId: string; kind: AiEvalKind; candidate: AiEvalCandidate }>
  skipped: Array<{ caseId: string; kind: AiEvalKind; why: string }>
}

/**
 * Record and grade an answer for every brief a recorder covers. Refused
 * before anything else unless `AI_EVAL_LIVE=1` names the run.
 */
export async function recordAiEvalLive(
  cases: readonly AiEvalCase[],
  options: AiEvalLiveOptions,
): Promise<AiEvalLiveReport> {
  if (!aiEvalLiveAllowed(options.env)) throw new AiEvalLiveRefusedError()
  const report: AiEvalLiveReport = { recorded: [], skipped: [] }
  for (const evalCase of cases) {
    const recorder = aiEvalRecorderFor(evalCase.kind)
    if (!recorder) {
      report.skipped.push({
        caseId: evalCase.id,
        kind: evalCase.kind,
        why: 'no recorder: the door that answers this kind is a request route, not a job step',
      })
      continue
    }
    const answer = await recorder(evalCase, options)
    const rubric = await gradeAiEvalCandidate(evalCase, answer, options)
    report.recorded.push({ caseId: evalCase.id, kind: evalCase.kind, candidate: { ...answer, rubric } })
  }
  return report
}
