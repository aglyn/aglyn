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

import {
  AI_EXPERIMENT_FIGURE_READER,
  AI_EXPERIMENT_MAX_VARIANTS,
  AI_EXPERIMENT_MIN_VARIANTS,
  AI_EXPERIMENT_SUBJECT_MAX_CHARS,
  aiExperimentNextStep,
  aiExperimentTarget,
  aiExperimentTask,
  aiExperimentVerdictNamesWinner,
  checkAiExperimentExplanation,
  checkAiExperimentVariants,
  readAiExperimentArms,
  readAiExperimentResult,
  type AiExperimentArm,
  type AiExperimentExplanation,
  type AiExperimentReading,
  type AiExperimentTarget,
  type AiExperimentVariantsProposal,
} from '../model/ai-experiment'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  runAiRequest,
  type AiMessage,
  type AiSystemBlock,
} from '../runtime/ai-runtime'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { aiInsightReaders, readAiInsightTables } from '../insights/ai-insight-readers'
import {
  registerAiJobAdmission,
  type AiJobAdmissionContext,
  type AiJobAdmissionRefusal,
} from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'
import {
  AI_EXPERIMENT_EXPLAIN_TOOL_NAME,
  AI_EXPERIMENT_VARIANTS_TOOL_NAME,
  aiExperimentExplainTool,
  aiExperimentVariantsTool,
  parseAiExperimentExplanation,
  parseAiExperimentVariants,
} from '../tools/ai-experiment-tool'

/**
 * The `experiment` step (AGL-2914): A/B tests by AI.
 *
 * A/B testing already exists — the marketing plugin models the experiment,
 * buckets visitors, counts exposures and conversions and compares the arms.
 * This step is the AI layer over it, and it does two things:
 *
 * 1. **Variants.** From the copy under test, it proposes between two and four
 *    variants of it. It proposes COPY and nothing else: no weight, no traffic
 *    split, no goal, no schedule and no winner. A person puts them into the
 *    A/B testing card, which is the only thing that creates or starts a test.
 * 2. **The result.** Code reads the test's figures through the reader
 *    marketing registers for them, decides what they support, and only then
 *    asks the model for the words. The verdict is never the model's, and an
 *    answer that claims more than the verdict is cut back to it.
 *
 * ## Nothing here writes a test
 *
 * Both answers are proposals, like a theme's or a listing's. The experiment
 * document, its variants' screen versions and its traffic are marketing's and
 * the besigner's, and a job that could write them could start an experiment on
 * live visitors without anyone deciding to.
 *
 * ## What reaches the model
 *
 * For variants: the brief, what the test varies, and the copy under test as
 * the surface handed it over. For a result: the test's name, its arms' counts
 * and rates as the results reader published them, and the verdict code
 * reached. No visitor, no session and no assignment is read, because the
 * reader publishes none — it answers in aggregates, which is the whole reason
 * a figure reader is what this reads.
 */

/** The reader whose figures a result is explained from, and the plugin that owns it. */
export const AI_EXPERIMENT_READER_ID = AI_EXPERIMENT_FIGURE_READER

/** The window a result is read over: a test's figures are totals since it started. */
export const AI_EXPERIMENT_READ_DAYS = 0

export const AI_EXPERIMENT_NO_TASK_COPY =
  'Start this from the A/B testing card, which says whether you want variants or an explanation.'
export const AI_EXPERIMENT_NO_TARGET_COPY =
  'Say whether the test varies a screen, a section or an email.'
export const AI_EXPERIMENT_NO_SITE_COPY = 'Open the site whose test this is.'
export const AI_EXPERIMENT_NO_READER_COPY =
  'A/B testing is not available on this workspace, so there is no test to work on.'
export const AI_EXPERIMENT_NO_SUBJECT_COPY =
  'Give the copy the test varies, so there is something to write variants of.'
export const AI_EXPERIMENT_NO_TEST_COPY =
  'Name the test to explain, as A/B testing lists it.'
export const AI_EXPERIMENT_NO_FIGURES_COPY =
  'That test’s figures could not be read. Try again in a moment.'
export const AI_EXPERIMENT_UNREADABLE_RESULT_COPY =
  'That test has no first variant and something to compare against it yet, so there is nothing to explain.'
export const AI_EXPERIMENT_NO_VARIANTS_COPY =
  'The AI did not write variants that could be used. Try the brief in different words.'
export const AI_EXPERIMENT_NO_EXPLANATION_COPY =
  'The AI did not explain the result in words that match its figures. Try again.'

/** The step's answer ceiling, from the routing table. */
export const AI_JOB_EXPERIMENT_MAX_TOKENS = AI_ROUTING_TABLE['job.experiment'].maxTokens

/**
 * The step's time: at most one re-ask at the routing ceiling, plus the one
 * figure read an explanation makes. Variants read nothing.
 */
export const AI_JOB_EXPERIMENT_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.experiment'],
  maxTokens: AI_JOB_EXPERIMENT_MAX_TOKENS,
  attempts: AI_GENERATION_MAX_ATTEMPTS,
  lookups: 1,
})

export const AI_JOB_EXPERIMENT_STEP_MINIMUM_MS = AI_JOB_EXPERIMENT_STEP_BUDGET.minimumMs

/** The rules both tasks are sent: static, byte-identical for every workspace. */
export const AI_EXPERIMENT_RULES = [
  'You work on A/B tests for a website builder. A test shows visitors one of several variants of the same thing and counts which converts best. You never start, stop or change a test: you write variants for a person to put into the A/B testing card, and you put a result someone else measured into plain words.',
  '',
  `When you are given copy under test, call ${AI_EXPERIMENT_VARIANTS_TOOL_NAME} once:`,
  `- Answer with between ${AI_EXPERIMENT_MIN_VARIANTS} and ${AI_EXPERIMENT_MAX_VARIANTS} variants. The first is the copy as it stands, unchanged, so the test has something to measure against.`,
  '- Each later variant changes ONE idea — the promise, the specificity, the length, the call to action — so a result says which idea won.',
  '- No two variants say the same thing in different words.',
  '- Write plain text: no HTML, no markdown, no emoji, no fences.',
  '- Never invent a fact, a price, a name, a statistic or a guarantee the copy under test did not give you.',
  '- Write in the language of the copy under test.',
  '',
  `When you are given a result, call ${AI_EXPERIMENT_EXPLAIN_TOOL_NAME} once:`,
  '- The request states the verdict. It was decided from the counts before you were asked, and it is not yours to revise.',
  '- Where the verdict names no winner, write nothing that says or implies one: no variant is ahead, none is better, nothing is significant, and you recommend nothing. Say what the figures show and why they do not settle it.',
  '- Where the verdict names a winner, name that variant and no other.',
  '- Every number you write appears in the figures you were given, as they show it or rounded. Never compute one.',
  '- Plain sentences: no markdown, no headings, no lists.',
  '- Write in the language of the brief.',
].join('\n')

export const AI_JOB_EXPERIMENT_SYSTEM: AiSystemBlock[] = [
  { text: `${AI_EXPERIMENT_RULES}\n\n${AI_ACCEPTABLE_USE_BLOCK}`, cacheBreakpoint: true },
]

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** What the test varies, in the words the prompt names it by. */
const TARGET_NOUN: Record<AiExperimentTarget, string> = {
  screen: 'a page',
  section: 'one section of a page',
  email: 'an email',
}

/** The user turn for variants: the brief, what varies, and the copy as it stands. */
export function aiExperimentVariantsPrompt(input: {
  brief: string
  target: AiExperimentTarget
  subject: string
  goal: string
}): string {
  return [
    `Brief: ${input.brief}`,
    `The test varies ${TARGET_NOUN[input.target]}.`,
    ...(input.goal ? [`It is trying to move: ${input.goal}`] : []),
    '',
    'The copy under test, as it stands:',
    input.subject,
  ].join('\n')
}

/** One arm as the explanation prompt shows it. */
function armText(arm: AiExperimentArm, index: number): string {
  const rate = arm.rate === null ? 'no rate' : `${arm.rate}%`
  const against =
    index === 0
      ? 'the first variant, which the others are compared against'
      : [
          arm.lift === null ? 'lift not measurable' : `lift ${arm.lift}%`,
          arm.confidence === null
            ? 'confidence not measurable'
            : `confidence ${arm.confidence}%`,
        ].join(', ')
  return `- ${arm.id}: shown ${arm.exposures}, converted ${arm.conversions}, rate ${rate} (${against})`
}

/** What the verdict tells the model it may say. */
export function aiExperimentVerdictText(reading: AiExperimentReading): string {
  if (reading.verdict === 'winner') {
    return `VERDICT: ${reading.winnerId} is ahead of the first variant by more than chance explains, at the ${reading.threshold}% confidence this test is called at. Name ${reading.winnerId} and no other variant.`
  }
  if (reading.verdict === 'control') {
    return `VERDICT: every other variant is behind the first one, ${reading.winnerId}, by more than chance explains. Name ${reading.winnerId} and no other variant.`
  }
  return [
    `VERDICT: THERE IS NO WINNER — ${reading.reasons.join('; ')}.`,
    'Say what the figures show and why they do not settle it. Name no winner, say no variant is ahead, better, winning or significant, and recommend no variant.',
    `Leave winner and next empty; what to do next is already decided: ${aiExperimentNextStep(reading.verdict)}`,
  ].join('\n')
}

/** The user turn for an explanation: the test, its arms, and the verdict. */
export function aiExperimentExplainPrompt(input: {
  brief: string
  reading: AiExperimentReading
}): string {
  return [
    ...(input.brief ? [`Brief: ${input.brief}`] : []),
    `Test: ${input.reading.test}`,
    'Figures, totals since the test started:',
    ...input.reading.arms.map(armText),
    '',
    aiExperimentVerdictText(input.reading),
  ].join('\n')
}

/** The proposal an answer becomes, as the job's output carries it. */
function experimentOutput(
  job: Pick<AiJob, '$id' | 'hostId' | 'inputs'>,
  label: string,
  proposal: Record<string, unknown>,
): AiJobOutput {
  return {
    resource: 'experiment',
    // The test the surface named, so a person opens the one they asked about;
    // a variants job for a test that does not exist yet names the job itself.
    id: str(job.inputs?.['experimentId']) || job.$id,
    versionId: null,
    hostId: job.hostId ?? null,
    hostSubdomain: str(job.inputs?.['hostSubdomain']) || null,
    label,
    proposal,
  }
}

/**
 * The A/B test results for this job's site, or `null` when the workspace has
 * no such reader. The insight path's own resolver is what decides whether a
 * reader may be read here — the plan's entitlement, the owning plugin's
 * release flag, and whether that plugin runs on this workspace and this site
 * — so this asks it rather than restating any of it.
 */
async function readExperimentFigures(
  context: Pick<AiJobStepContext, 'firestore' | 'org' | 'now'>,
  place: { orgId: string; hostId: string | null; uid: string | null },
): Promise<{ table: Parameters<typeof readAiExperimentArms>[0]; refusals: string[] } | null> {
  if (!place.hostId) return null
  const snapshot = await context.firestore.collection('hosts').doc(place.hostId).get()
  const host = snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null
  if (!host || host['orgId'] !== place.orgId) return null
  const readers = await aiInsightReaders({
    orgId: place.orgId,
    hostId: place.hostId,
    org: context.org ?? null,
    host,
    surface: 'analytics',
  })
  const experiments = readers.filter(({ reader }) => reader.id === AI_EXPERIMENT_READER_ID)
  if (!experiments.length) return null
  const read = await readAiInsightTables(
    experiments,
    [{ reader: AI_EXPERIMENT_READER_ID, days: AI_EXPERIMENT_READ_DAYS, params: {} }],
    { orgId: place.orgId, hostId: place.hostId, uid: place.uid, now: context.now },
    1,
  )
  return { table: read.tables[0] ?? null, refusals: read.refusals }
}

export const runAiJobExperimentStep: AiJobStepRunner = async (
  context: AiJobStepContext,
) => {
  const { job, signal } = context
  const model = context.modelFor?.('job.experiment') ?? aiModelForStep('job.experiment')
  const maxTokens = AI_JOB_EXPERIMENT_STEP_BUDGET.maxTokens(model)
  const task = aiExperimentTask(job.inputs)
  const spent = (result: { usage: unknown; estCostUsd: number; stopReason: string | null }) => ({
    usage: result.usage as AiJobStepOutcome['usage'],
    estCostUsd: result.estCostUsd,
    model,
    stopReason: result.stopReason,
    effort: null,
  })
  const stop = (failure: string): AiJobStepOutcome => ({
    outputs: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0,
    model,
    stopReason: null,
    failure,
  })

  if (!task) return stop(AI_EXPERIMENT_NO_TASK_COPY)
  if (!job.hostId) return stop(AI_EXPERIMENT_NO_SITE_COPY)

  const ask = (messages: AiMessage[], tool: ReturnType<typeof aiExperimentExplainTool>) =>
    runAiRequest({
      model,
      system: AI_JOB_EXPERIMENT_SYSTEM,
      messages,
      tools: [tool],
      maxTokens,
      ...(AI_ROUTING_TABLE['job.experiment'].thinking
        ? { thinking: AI_ROUTING_TABLE['job.experiment'].thinking }
        : {}),
      stream: false,
      ...(signal ? { signal } : {}),
    })

  if (task === 'variants') {
    const target = aiExperimentTarget(job.inputs)
    if (!target) return stop(AI_EXPERIMENT_NO_TARGET_COPY)
    const subject = str(job.inputs?.['subject']).slice(0, AI_EXPERIMENT_SUBJECT_MAX_CHARS)
    if (!subject) return stop(AI_EXPERIMENT_NO_SUBJECT_COPY)
    const tool = aiExperimentVariantsTool(target)
    let messages: AiMessage[] = [
      {
        role: 'user',
        content: aiExperimentVariantsPrompt({
          brief: job.brief,
          target,
          subject,
          goal: str(job.inputs?.['goal']),
        }),
      },
    ]
    let last: AiJobStepOutcome | null = null
    for (let attempt = 0; attempt < AI_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      const result = await ask(messages, tool)
      if (result.kind === 'refusal') {
        return { outputs: [], ...spent(result), refused: true }
      }
      const parsed = parseAiExperimentVariants(
        result.toolUse.find((use) => use.name === AI_EXPERIMENT_VARIANTS_TOOL_NAME)?.input,
      )
      const checked = checkAiExperimentVariants(parsed, target)
      last = { outputs: [], ...spent(result), failure: AI_EXPERIMENT_NO_VARIANTS_COPY }
      if (checked) {
        if (checked.findings.length) {
          console.info('ai experiment variants dropped', {
            jobId: job.$id,
            findings: checked.findings,
          })
        }
        return {
          outputs: [variantsOutput(job, target, checked.proposal)],
          ...spent(result),
        }
      }
      messages = [
        ...messages,
        { role: 'assistant', content: `Answered with ${AI_EXPERIMENT_VARIANTS_TOOL_NAME}.` },
        {
          role: 'user',
          content:
            `Those variants could not be used. Answer again with ${AI_EXPERIMENT_VARIANTS_TOOL_NAME}: ` +
            `at least ${AI_EXPERIMENT_MIN_VARIANTS} variants, each with copy of its own, none repeating ` +
            'another, and plain text throughout.',
        },
      ]
    }
    return last ?? stop(AI_EXPERIMENT_NO_VARIANTS_COPY)
  }

  const test = str(job.inputs?.['test'])
  if (!test) return stop(AI_EXPERIMENT_NO_TEST_COPY)
  const figures = await readExperimentFigures(context, {
    orgId: job.orgId,
    hostId: job.hostId,
    uid: job.createdBy,
  })
  if (!figures) return stop(AI_EXPERIMENT_NO_READER_COPY)
  if (!figures.table) {
    if (figures.refusals.length) {
      console.warn('ai experiment figures refused', { jobId: job.$id, refusals: figures.refusals })
    }
    return stop(AI_EXPERIMENT_NO_FIGURES_COPY)
  }
  const reading = readAiExperimentResult(test, readAiExperimentArms(figures.table, test))
  // Nothing to explain, and nothing spent finding that out: the verdict was
  // reached from the figures alone.
  if (reading.verdict === 'unreadable') return stop(AI_EXPERIMENT_UNREADABLE_RESULT_COPY)

  const result = await ask(
    [{ role: 'user', content: aiExperimentExplainPrompt({ brief: job.brief, reading }) }],
    aiExperimentExplainTool(),
  )
  if (result.kind === 'refusal') return { outputs: [], ...spent(result), refused: true }
  const explained = checkAiExperimentExplanation(
    parseAiExperimentExplanation(
      result.toolUse.find((use) => use.name === AI_EXPERIMENT_EXPLAIN_TOOL_NAME)?.input,
    ),
    reading,
  )
  if (!explained) {
    return { outputs: [], ...spent(result), failure: AI_EXPERIMENT_NO_EXPLANATION_COPY }
  }
  if (explained.findings.length) {
    console.info('ai experiment explanation cut back to its reading', {
      jobId: job.$id,
      verdict: reading.verdict,
      findings: explained.findings,
    })
  }
  return { outputs: [explanationOutput(job, reading, explained)], ...spent(result) }
}

/** A variants answer as the job's output. */
function variantsOutput(
  job: Pick<AiJob, '$id' | 'hostId' | 'inputs'>,
  target: AiExperimentTarget,
  proposal: AiExperimentVariantsProposal,
): AiJobOutput {
  return {
    ...experimentOutput(job, `${proposal.variants.length} variants to test`, {
      task: 'variants',
      target,
      goal: proposal.goal,
      variants: proposal.variants,
    }),
    note: 'Put these into A/B testing to start the test; nothing has been changed on the site.',
  }
}

/** An explanation as the job's output, carrying the verdict code reached. */
function explanationOutput(
  job: Pick<AiJob, '$id' | 'hostId' | 'inputs'>,
  reading: AiExperimentReading,
  explained: AiExperimentExplanation,
): AiJobOutput {
  return experimentOutput(job, explained.test || 'A/B test result', {
    task: 'explain',
    verdict: explained.verdict,
    headline: explained.headline,
    points: explained.points,
    // Only ever the reading's arm: an explanation carries no winner the
    // figures did not support, whatever the answer said.
    winnerId: aiExperimentVerdictNamesWinner(reading.verdict) ? explained.winnerId : null,
    next: explained.next,
    threshold: reading.threshold,
    arms: reading.arms,
  })
}

/**
 * Whether an experiment job may run here: a site of the job's own org, a task
 * the step runs, and A/B testing available on it — which is the results
 * reader being one this workspace may read, asked of the owning plugin rather
 * than restated.
 */
export async function aiExperimentAdmissionRefusal(
  context: AiJobAdmissionContext,
): Promise<AiJobAdmissionRefusal | null> {
  if (!aiExperimentTask(context.inputs)) {
    return { status: 400, error: AI_EXPERIMENT_NO_TASK_COPY }
  }
  if (!context.hostId) return { status: 400, error: AI_EXPERIMENT_NO_SITE_COPY }
  const snapshot = await context.firestore.collection('hosts').doc(context.hostId).get()
  const host = snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null
  if (!host || host['orgId'] !== context.orgId) {
    return { status: 404, error: 'Unknown site' }
  }
  const readers = await aiInsightReaders({
    orgId: context.orgId,
    hostId: context.hostId,
    org: context.org,
    host,
    surface: 'analytics',
  })
  return readers.some(({ reader }) => reader.id === AI_EXPERIMENT_READER_ID)
    ? null
    : { status: 403, error: AI_EXPERIMENT_NO_READER_COPY }
}

/**
 * The experiment kind's registrations, called by the console surface
 * (`registerAiJobKinds` in `server.ts`), never made by importing this module
 * (AGL-3025).
 */
export function registerAiExperimentJob(): void {
  registerAiJobStep('experiment', runAiJobExperimentStep, {
    minimumMs: AI_JOB_EXPERIMENT_STEP_MINIMUM_MS,
  })
  registerAiJobAdmission('experiment', aiExperimentAdmissionRefusal)
}
