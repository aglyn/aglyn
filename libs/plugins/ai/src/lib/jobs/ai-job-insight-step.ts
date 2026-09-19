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

import type { ResolvedPluginFigureReader } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  AI_INSIGHT_ASK_SURFACES,
  AI_INSIGHT_DIGEST_DAYS,
  AI_INSIGHT_DIGEST_READERS,
  AI_INSIGHT_QUESTION_MAX_CHARS,
  AI_INSIGHTS_COLLECTION,
  aiInsightDays,
  aiInsightOutput,
  aiInsightSurface,
  aiInsightSurfaceNeedsSite,
  type AiInsightRecord,
  type AiInsightSurface,
  type AiInsightTable,
} from '../model/ai-insight'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  runAiRequest,
  type AiMessage,
  type AiResult,
  type AiSystemBlock,
  type AiUsage,
} from '../runtime/ai-runtime'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { checkAiInsightAnswer, type AiInsightCheck } from '../runtime/ai-insight-check'
import {
  AI_INSIGHT_ANSWER_TOOL_NAME,
  AI_INSIGHT_READ_TOOL_NAME,
  aiInsightAnswerTool,
  aiInsightReadTool,
  parseAiInsightAnswer,
  parseAiInsightReads,
  type AiInsightReadRequest,
} from '../tools/ai-insight-tool'
import { aiDatasetCatalog } from '../insights/ai-figure-readers'
import {
  aiInsightDatasetCatalog,
  aiInsightReaderCatalog,
  aiInsightReaderDays,
  aiInsightReaders,
  aiInsightTableText,
  readAiInsightTables,
} from '../insights/ai-insight-readers'
import { assistExchangeExpiry } from '../usage/assist-usage'
import { registerAiJobAdmission, type AiJobAdmissionContext, type AiJobAdmissionRefusal } from './ai-job-admission'
import { AI_INSIGHT_READ_MAX_TOKENS, AI_JOB_INSIGHT_STEP_BUDGET, AI_JOB_INSIGHT_STEP_MINIMUM_MS } from './ai-job-insight-budget'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `insight` step (AGL-2915): a question about a site's figures, answered
 * from tables code read, with every insight traced to the rows it cites.
 *
 * ## Two exchanges, and the model never writes a query
 *
 * 1. **The reads.** The model is shown the question and the readers this job
 *    may read — each an id, what it answers, its windows and parameters — and
 *    answers `read_figures` with a choice among them. It names nothing else: no
 *    collection, no field path, no filter. A choice that names no reader this
 *    job may read is dropped, and a job left with none reads the surface's
 *    defaults. A weekly digest makes no read call: code reads the digest's
 *    readers.
 * 2. **The answer.** Code reads the tables through the owners' readers, and the
 *    model is shown them and answers `submit_insights`. The trace
 *    (`runtime/ai-insight-check.ts`) keeps each insight whose every number is
 *    in a row it cites and leaves out the rest. An answer that is not a call,
 *    or whose every insight was left out, is asked for once more with the
 *    reasons; what the second answer keeps is the answer.
 *
 * Both calls share one allowance of output, twice the routing ceiling, which
 * is what the step's least time is planned against.
 *
 * ## What reaches the model
 *
 * The question, the names and descriptions of the readers, the tables, and
 * for a datasets question the names of the datasets the member may see with
 * their fields' names and types. A table holds counts, sums and rates labeled
 * by a page path, a referring site, a form's, a service's, a product's or a
 * campaign's name, or the values of a dataset field with at most sixty
 * different values that at least three records share. No
 * record, visitor, contact, order, booking, submission or recipient is read
 * into a prompt, and every text cell is masked of email addresses and phone
 * numbers on its way into a table.
 *
 * ## What it writes
 *
 * The answer, at `orgs/{orgId}/aiInsights/{jobId}` under the job's own
 * expiry, and an output that names it and says how many insights it holds.
 * Nothing else: no draft, no setting, no message.
 */

type Firestore = FirebaseFirestore.Firestore

export const AI_INSIGHT_NO_SURFACE_COPY = 'This question does not say which page it was asked from.'
export const AI_INSIGHT_NO_SITE_COPY = 'Open the site whose numbers you are asking about.'
export const AI_INSIGHT_NO_READERS_COPY =
  'There are no figures to answer from here yet: the features this page reports on are not on for this workspace.'
export const AI_INSIGHT_NO_TABLES_COPY = 'The figures could not be read. Try again in a moment.'
export const AI_INSIGHT_UNREADABLE_COPY = 'The AI did not answer with insights. Try asking in different words.'

/** The digest's question: what a week's insights cover, in the order a person reads them. */
export const AI_INSIGHT_DIGEST_QUESTION =
  'What changed on this site this week? Write the week’s insights: the change in traffic, the most viewed page, the form that turned the most views into submissions, a campaign that did better than the rest, and any day that stood out — only those the tables support.'

/** The rules both calls are sent: static, byte-identical for every workspace. */
export const AI_INSIGHT_RULES = [
  'You answer a workspace owner’s questions about their own figures: page views, orders, bookings, forms, campaigns, A/B tests and datasets. You never see a record, and you never write a query: code reads figures through fixed readers and gives you their tables.',
  '',
  `When you are given a question and a list of readers, call ${AI_INSIGHT_READ_TOOL_NAME} once with the readers whose tables answer it, most useful first, and the window each should cover. Choose only readers from the list, with their parameters' values taken from what the list and the question give you.`,
  '',
  `When you are given tables, call ${AI_INSIGHT_ANSWER_TOOL_NAME} once. Each table has a handle (t1, t2, …) and numbered rows. Rules for the insights:`,
  '- Say what matters most to the question first. Leave out what the tables do not support.',
  '- Every insight cites the table and the rows its figures come from.',
  '- Every number you write appears in a row you cite, as the table shows it or rounded. Never add, subtract, average or otherwise compute a figure yourself. The only other numbers you may write are the length of a table’s window, a date in it, and how many rows you cite.',
  '- Say a figure rose or fell only when a change you quote shows it.',
  '- Name nobody, and write no email address or phone number.',
  '- Plain sentences: no markdown, no headings, no lists.',
  '- When the tables cannot answer part of the question, say so in gap in one sentence with no numbers; otherwise gap is null.',
  '- Write in the language of the question.',
].join('\n')

/** The system blocks both calls send: the rules and the platform's acceptable-use rules. */
export const AI_JOB_INSIGHT_SYSTEM: AiSystemBlock[] = [
  { text: `${AI_INSIGHT_RULES}\n\n${AI_ACCEPTABLE_USE_BLOCK}`, cacheBreakpoint: true },
]

const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** What the step's calls have spent so far, in the outcome's shape. */
class InsightSpend {
  usage: AiUsage = { ...ZERO_USAGE }
  estCostUsd = 0
  stopReason: string | null = null

  constructor(readonly model: string) {}

  add(result: AiResult): void {
    this.usage = {
      inputTokens: this.usage.inputTokens + result.usage.inputTokens,
      outputTokens: this.usage.outputTokens + result.usage.outputTokens,
      cacheReadTokens: this.usage.cacheReadTokens + result.usage.cacheReadTokens,
      cacheWriteTokens: this.usage.cacheWriteTokens + result.usage.cacheWriteTokens,
    }
    this.estCostUsd = Math.round((this.estCostUsd + result.estCostUsd) * 1_000_000) / 1_000_000
    this.stopReason = result.stopReason
  }

  outcome(): Pick<AiJobStepOutcome, 'usage' | 'estCostUsd' | 'model' | 'stopReason' | 'effort'> {
    return { usage: this.usage, estCostUsd: this.estCostUsd, model: this.model, stopReason: this.stopReason, effort: null }
  }
}

/** The read call's user turn: the question, the window asked for, the readers and, for datasets, the datasets. */
export function aiInsightReadPrompt(input: {
  question: string
  days: number
  readers: readonly ResolvedPluginFigureReader[]
  datasets: string | null
}): string {
  return [
    `Question: ${input.question}`,
    `The window picked on the page: ${input.days} days. Use it unless the question names another window a reader lists.`,
    'Readers you may read here:',
    aiInsightReaderCatalog(input.readers),
    ...(input.datasets === null ? [] : ['', 'Datasets you may read, with their fields:', input.datasets]),
  ].join('\n')
}

/** The answer call's user turn: the question and every table. */
export function aiInsightAnswerPrompt(question: string, tables: readonly AiInsightTable[]): string {
  return [`Question: ${question}`, '', 'Tables:', '', tables.map(aiInsightTableText).join('\n\n')].join('\n')
}

/** What a re-ask tells the model: why nothing it wrote could be kept. */
export function aiInsightReaskMessage(check: AiInsightCheck | null): string {
  const reasons = check?.findings.length
    ? `None of those insights could be kept: ${[...new Set(check.findings)].slice(0, 8).join('; ')}.`
    : `That answer did not come through ${AI_INSIGHT_ANSWER_TOOL_NAME}.`
  return `${reasons} Answer again with ${AI_INSIGHT_ANSWER_TOOL_NAME}: cite the rows each insight's figures are in, and write every number as a row you cite shows it.`
}

/** The reads a surface falls back to when the model named none it may read: the digest's own readers. */
function defaultReads(readers: readonly ResolvedPluginFigureReader[], days: number): AiInsightReadRequest[] {
  const ids = readers.map(({ reader }) => reader.id)
  const preferred = AI_INSIGHT_DIGEST_READERS.filter((id) => ids.includes(id))
  const chosen = preferred.length ? preferred : ids
  return chosen.map((id) => ({
    reader: id,
    days: aiInsightReaderDays(readers.find(({ reader }) => reader.id === id)?.reader.windows ?? [], days),
    params: {},
  }))
}

async function readHost(
  firestore: Firestore,
  orgId: string,
  hostId: string | null,
): Promise<{ host: Record<string, unknown> | null; ok: boolean }> {
  if (!hostId) return { host: null, ok: true }
  const snapshot = await firestore.collection('hosts').doc(hostId).get()
  const host = snapshot.exists ? ((snapshot.data() ?? {}) as Record<string, unknown>) : null
  return { host, ok: Boolean(host) && host?.['orgId'] === orgId }
}

export const runAiJobInsightStep: AiJobStepRunner = async (context: AiJobStepContext) => {
  const { job, firestore, signal, now } = context
  const model = context.modelFor?.('job.insight') ?? aiModelForStep('job.insight')
  const spend = new InsightSpend(model)
  const stop = (failure: string): AiJobStepOutcome => ({ outputs: [], ...spend.outcome(), failure })

  const surface = aiInsightSurface(job.inputs)
  if (!surface) return stop(AI_INSIGHT_NO_SURFACE_COPY)
  const hostId = job.hostId ?? null
  if (aiInsightSurfaceNeedsSite(surface) && !hostId) return stop(AI_INSIGHT_NO_SITE_COPY)
  // The door checks the caller belongs to the org; that the site does is
  // checked here, before anything about it is read.
  const site = await readHost(firestore, job.orgId, hostId)
  if (!site.ok) return stop(AI_INSIGHT_NO_SITE_COPY)
  const readers = await aiInsightReaders({
    orgId: job.orgId,
    hostId,
    org: context.org ?? null,
    host: site.host,
    surface,
  })
  if (!readers.length) return stop(AI_INSIGHT_NO_READERS_COPY)

  const digest = surface === 'digest'
  const days = digest ? AI_INSIGHT_DIGEST_DAYS : aiInsightDays(job.inputs?.['days'])
  const question = digest ? AI_INSIGHT_DIGEST_QUESTION : job.brief.slice(0, AI_INSIGHT_QUESTION_MAX_CHARS)
  const maxTokens = AI_JOB_INSIGHT_STEP_BUDGET.maxTokens(model)
  const allowance = AI_GENERATION_MAX_ATTEMPTS * maxTokens
  const left = () => allowance - spend.usage.outputTokens
  const ask = (messages: AiMessage[], tool: 'read' | 'answer', ceiling: number) =>
    runAiRequest({
      model,
      system: AI_JOB_INSIGHT_SYSTEM,
      messages,
      tools: [tool === 'read' ? aiInsightReadTool() : aiInsightAnswerTool()],
      maxTokens: Math.max(1, Math.min(ceiling, left())),
      ...(AI_ROUTING_TABLE['job.insight'].thinking ? { thinking: AI_ROUTING_TABLE['job.insight'].thinking } : {}),
      stream: false,
      ...(signal ? { signal } : {}),
    })

  // 1. The reads.
  const base = { orgId: job.orgId, hostId, uid: digest ? null : job.createdBy, now }
  let requests: AiInsightReadRequest[]
  if (digest) {
    requests = defaultReads(readers, days)
  } else {
    const datasets =
      surface === 'datasets'
        ? aiInsightDatasetCatalog(await aiDatasetCatalog(firestore, { orgId: job.orgId, hostId, uid: job.createdBy }))
        : null
    const result = await ask(
      [{ role: 'user', content: aiInsightReadPrompt({ question, days, readers, datasets }) }],
      'read',
      AI_INSIGHT_READ_MAX_TOKENS,
    )
    spend.add(result)
    if (result.kind === 'refusal') return { outputs: [], ...spend.outcome(), refused: true }
    requests = parseAiInsightReads(result.toolUse.find((use) => use.name === AI_INSIGHT_READ_TOOL_NAME)?.input)
  }
  const maxTables = digest ? AI_INSIGHT_DIGEST_READERS.length : undefined
  let read = await readAiInsightTables(readers, requests, base, maxTables)
  if (!read.tables.length && !digest) read = await readAiInsightTables(readers, defaultReads(readers, days), base)
  if (read.refusals.length) console.warn('ai insight reads refused', { jobId: job.$id, refusals: read.refusals })
  if (!read.tables.length) return stop(AI_INSIGHT_NO_TABLES_COPY)
  const { tables } = read

  // 2. The answer, and at most one re-ask.
  let messages: AiMessage[] = [{ role: 'user', content: aiInsightAnswerPrompt(question, tables) }]
  let checked: AiInsightCheck | null = null
  for (let attempt = 0; attempt < AI_GENERATION_MAX_ATTEMPTS && left() > 0; attempt += 1) {
    const result = await ask(messages, 'answer', maxTokens)
    spend.add(result)
    if (result.kind === 'refusal') return { outputs: [], ...spend.outcome(), refused: true }
    const answer = parseAiInsightAnswer(result.toolUse.find((use) => use.name === AI_INSIGHT_ANSWER_TOOL_NAME)?.input)
    const check = answer ? checkAiInsightAnswer(answer, tables) : null
    if (check) checked = check
    if (check && (check.kept.length || !answer?.insights.length)) break
    messages = [
      ...messages,
      { role: 'assistant', content: `Answered with ${AI_INSIGHT_ANSWER_TOOL_NAME}.` },
      { role: 'user', content: aiInsightReaskMessage(check) },
    ]
  }
  if (!checked) return stop(AI_INSIGHT_UNREADABLE_COPY)

  const record: AiInsightRecord = {
    jobId: job.$id,
    orgId: job.orgId,
    hostId,
    surface,
    createdBy: job.createdBy,
    question: digest ? str(job.brief) || 'Weekly insights' : question,
    days,
    insights: checked.kept,
    gap: checked.gap,
    tables,
    left: checked.left.length,
    week: digest ? str(job.inputs?.['week']) || null : null,
    createdAtMs: now.getTime(),
  }
  if (checked.left.length) {
    console.info('ai insight left out untraced insights', { jobId: job.$id, findings: checked.findings })
  }
  // Keyed by the job, so a step run again replaces its own answer.
  await firestore
    .collection('orgs')
    .doc(job.orgId)
    .collection(AI_INSIGHTS_COLLECTION)
    .doc(job.$id)
    .set({ ...(JSON.parse(JSON.stringify(record)) as AiInsightRecord), expiresAt: job.expiresAt ?? assistExchangeExpiry(now) })
  return {
    outputs: [aiInsightOutput(job, record, str(site.host?.['subdomain']) || null)],
    ...spend.outcome(),
  }
}

/**
 * Whether a question may be asked here: a surface a person asks from, a site
 * of the job's own org where the surface needs one, and at least one reader
 * the workspace may read. A digest is made by the weekly sweep and never at a
 * door.
 */
export async function aiInsightAdmissionRefusal(
  context: AiJobAdmissionContext,
): Promise<AiJobAdmissionRefusal | null> {
  const surface: AiInsightSurface | null = aiInsightSurface(context.inputs)
  if (!surface || !AI_INSIGHT_ASK_SURFACES.includes(surface)) {
    return { status: 400, error: 'Ask about your numbers from a site’s Analytics, Data or CRM Reports page.' }
  }
  if (aiInsightSurfaceNeedsSite(surface) && !context.hostId) {
    return { status: 400, error: AI_INSIGHT_NO_SITE_COPY }
  }
  const site = await readHost(context.firestore, context.orgId, context.hostId)
  if (!site.ok) return { status: 404, error: 'Unknown site' }
  const readers = await aiInsightReaders({
    orgId: context.orgId,
    hostId: context.hostId,
    org: context.org,
    host: site.host,
    surface,
  })
  return readers.length ? null : { status: 403, error: AI_INSIGHT_NO_READERS_COPY }
}

/**
 * The insight kind's registrations, called by the console surface
 * (`registerAiJobKinds` in `server.ts`), never made by importing this module
 * (AGL-3025).
 */
export function registerAiInsightJob(): void {
  registerAiJobStep('insight', runAiJobInsightStep, { minimumMs: AI_JOB_INSIGHT_STEP_MINIMUM_MS })
  registerAiJobAdmission('insight', aiInsightAdmissionRefusal)
}
