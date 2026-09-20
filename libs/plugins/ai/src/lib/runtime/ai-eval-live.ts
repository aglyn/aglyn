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

import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import { LAYOUT_SLOT_COMPONENT_ID } from '@aglyn/aglyn/app-utils/compose-layout-nodes'
import { stampDocumentLandmark } from '@aglyn/aglyn/app-utils/document-landmark'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { createAiJobComponentStep } from '../jobs/ai-job-component-step'
import { aiJobDraftId, aiMintJobDraftIds } from '../jobs/ai-job-draft-ids'
import { createAiJobFormStep } from '../jobs/ai-job-form-step'
import { createAiJobLayoutStep } from '../jobs/ai-job-layout-step'
import { aiPageJobUnits, createAiJobPageStep } from '../jobs/ai-job-page-step'
import { AI_JOB_PLAN_SCOPES, createAiJobPlanStep } from '../jobs/ai-job-plan-step'
import { createAiJobProductsStep } from '../jobs/ai-job-products-step'
import { aiSitePendingUnits } from '../jobs/ai-job-site-step'
import type { AiJobStepOutcome } from '../jobs/ai-job-text-step'
import { runAiJobTextStep } from '../jobs/ai-job-text-step'
import { aiJobThemeCheck, aiJobThemeGeneration, aiJobThemeMode } from '../jobs/ai-job-theme-step'
import {
  aiJobWorkflowDraftGeneration,
  aiJobWorkflowExplainGeneration,
  aiJobWorkflowModel,
} from '../jobs/ai-job-workflow-step'
import { readAiProductImage, type AiProductImageSeams } from '../jobs/ai-product-image'
import { emptyAiAutomationRecords, type AiAutomationRecords } from '../model/ai-automation-draft'
import { aiActionOutline, aiActionRecordKinds, aiRunOutline } from '../model/ai-automation-outline'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, aiPlanCapabilityLines } from '../model/ai-plan-capabilities'
import { aiProductsJobInputs, aiProductsProposalOf, type AiProductsProposal } from '../model/ai-products'
import { aiDefaultModelFor, type AiStepKind } from '../providers/catalog'
import type { AiImagePart, AiProvider, AiSystemBlock, AiTool, AiUsage } from '../providers/contract'
import { aiModelForStep, resolveAiProvider } from '../providers/routing'
import { aiSiteInventoryBlock, runValidatedGeneration, type AiCustomGenerationInput } from './ai-doctrine'
import {
  AI_EVAL_AUTOMATION_CAPABILITIES,
  AI_EVAL_SITE_ID,
  AI_EVAL_TREE_OUTPUT,
  type AiEvalCandidate,
  type AiEvalCase,
  type AiEvalKind,
  type AiEvalRecordedScreen,
  type AiEvalRecordedStep,
  type AiEvalRubric,
} from './ai-eval'
import { aiEvalMemoryFirestore, aiEvalMemoryInventory } from './ai-eval-memory-firestore'
import { aiCategoriesPrompt, aiProductCopyPrompt } from './ai-products-generation'
import { aiModelReadsImages } from './ai-runtime'

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
 * production — the plan step's runner, the text step's runner, the products
 * step's runner, the theme and workflow steps' own generation calls — with
 * the case's site handed in where the door would read one. Nothing here
 * writes a prompt of its own for a kind.
 *
 * A kind with no recorder is skipped before any request, saying where
 * production answers it (`AI_EVAL_UNRECORDED_DOORS`): a request route no job
 * runs (the copy assistant's section, element and blog modes, the chat door),
 * or a job step no recorder drives yet. A planned kind's document records the
 * plan alone until its generator is recorded. A door that gains a recorder
 * registers it with `registerAiEvalRecorder`.
 *
 * An automation brief is recorded through the workflow step's own generation
 * call (AGL-3074) — a draft from the workspace's reach and the site's records,
 * an explanation from the outline of the saved automation — because the
 * step's runner keeps the tool's input nowhere: it writes the draft it makes
 * of it, or the text it reads out of it, and the harness scores the input. A
 * product brief is recorded through the products step's runner, against the
 * case's store in memory, its photo read from the case's fixtures through the
 * step's own resize-and-strip path, and its answer read back off the proposal
 * the runner makes.
 *
 * A page brief is recorded END TO END (AGL-3030): the plan step's runner,
 * the plan confirmed as a member confirms it, and every pass of the page
 * step's runner against a site kept in memory — the layout, forms and
 * components its plan creates built first by their own steps (AGL-3031) —
 * each exchange's spend kept as the machine meters it. That is what proves
 * what one page costs, on the workspace the case describes. Beside the page's
 * tree it keeps the draft's screen — its address, its listing and the layout
 * it renders inside — which the page's grader is shown with the plan
 * (AGL-3073).
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

/**
 * The variable a live run names the briefs it records by: case ids, comma
 * separated. Unset records every brief a recorder covers.
 */
export const AI_EVAL_CASES_ENV = 'AI_EVAL_CASES'

/** The briefs a run records: the ones `AI_EVAL_CASES` names, else every one. */
export function aiEvalCasesNamed<T extends { id: string }>(
  cases: readonly T[],
  env: Record<string, string | undefined>,
): T[] {
  const named = (env[AI_EVAL_CASES_ENV] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (!named.length) return [...cases]
  const unknown = named.filter((id) => !cases.some((evalCase) => evalCase.id === id))
  if (unknown.length) throw new Error(`${AI_EVAL_CASES_ENV} names no golden brief: ${unknown.join(', ')}`)
  return cases.filter((evalCase) => named.includes(evalCase.id))
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
  /**
   * Reads a file a case's `media` names, by its path under
   * `tools/ai-eval/fixtures` (AGL-3074). A run that records a case naming
   * media is refused without one, before any request.
   */
  readFixture?: (file: string) => Promise<Buffer>
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

/** A job for a golden brief, in the shape a step runner reads: its drafts named as a created job's are. */
function evalJob(evalCase: AiEvalCase, kind: AiJob['kind']): AiJob {
  const now = new Date(0)
  const draftIds = aiMintJobDraftIds(kind)
  return {
    $id: `eval-${evalCase.id}`,
    orgId: EVAL_ORG,
    hostId: evalCase.inventory?.hostId ?? null,
    kind,
    status: 'running',
    brief: evalCase.brief,
    inputs: {},
    steps: draftIds ? [{ name: 'generate', status: 'running', creditsSpent: 0, draftIds }] : [],
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

/** The case's site, as a reader the step runners are handed. */
function inventoryOf(evalCase: AiEvalCase) {
  return async () => {
    if (!evalCase.inventory) throw new Error(`${evalCase.id} has no inventory to build from`)
    return evalCase.inventory
  }
}

/**
 * The plan step's runner for a brief, on the case's site and the case's
 * workspace. No plan reuse in a recording (AGL-2937): the point of a live run
 * is to measure what the model answers for this brief, and a reused plan
 * would record someone else's answer as this case's. No admission either: a
 * recording writes to no workspace a door would count against.
 */
function evalPlanStep(evalCase: AiEvalCase) {
  return createAiJobPlanStep({
    readInventory: inventoryOf(evalCase),
    findPlansByKey: null,
    readCapabilities: async () => evalCase.capabilities ?? null,
    admissionRefusal: async () => null,
  })
}

/** A plan outcome's plan, as a candidate records it. */
function planOf(outcome: AiJobStepOutcome): AiEvalRecordedAnswer['plan'] {
  return outcome.plan
    ? { reuse: outcome.plan.reuse, create: outcome.plan.create, screens: outcome.plan.screens }
    : null
}

/** A planned kind's brief, recorded through the plan step: the plan alone. */
const recordPlan: AiEvalRecorder = async (evalCase, options) => {
  const kind = evalCase.kind as AiJob['kind']
  const outcome = await evalPlanStep(evalCase)({
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
    plan: planOf(outcome),
    answer: null,
    usage: outcome.usage,
    note: outcome.review?.reason === 'doctrine' ? `needs review: ${outcome.review.message}` : undefined,
  }
}

/** The most passes a recorded page may take: the plan limit's sections and the listing, with room. */
const AI_EVAL_PAGE_MAX_PASSES = 64

/** One exchange's spend, as the machine meters a step. */
function recordedStep(
  step: AiStepKind,
  outcome: Pick<AiJobStepOutcome, 'model' | 'usage' | 'estCostUsd'>,
): AiEvalRecordedStep {
  return {
    step,
    model: outcome.model,
    usage: outcome.usage,
    estCostUsd: outcome.estCostUsd,
    credits: assistCreditsFromUsd(outcome.estCostUsd),
  }
}

/** Several exchanges' tokens, added. */
function totalUsage(steps: readonly AiEvalRecordedStep[]): AiUsage {
  return steps.reduce<AiUsage>(
    (sum, step) => ({
      inputTokens: sum.inputTokens + step.usage.inputTokens,
      outputTokens: sum.outputTokens + step.usage.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + step.usage.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + step.usage.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  )
}

/**
 * The workspace a case describes, as the org document the page step reads:
 * a workspace that keeps no reusable components is the Free plan's shape,
 * and any other is a plan that keeps them.
 */
function evalOrgDocument(evalCase: AiEvalCase): Record<string, unknown> {
  return evalCase.capabilities?.reusableComponents === false
    ? { plan: 'free' }
    : { plan: 'business', billingStatus: 'active' }
}

/**
 * A page brief, recorded end to end (AGL-3030): the plan, confirmed, then the
 * page step's passes until it reports the draft or stops for a person. What
 * it answers is the page as the draft holds it, and what it spent is every
 * exchange, each metered as the machine meters a step. A plan that stops for
 * review records the plan alone, as a plan answer.
 */
const recordPage: AiEvalRecorder = async (evalCase, options) => {
  const now = options.now ?? new Date()
  const job = evalJob(evalCase, 'page')
  const hostId = job.hostId as string
  const org = evalOrgDocument(evalCase)
  // The page step names the site in the listing request by its host
  // document, so the site is named only as the case names it (AGL-3077).
  const site = aiEvalMemoryFirestore({
    [`orgs/${EVAL_ORG}`]: org,
    [`hosts/${hostId}`]: {
      ...(evalCase.siteName ? { displayName: evalCase.siteName } : {}),
      screens: Object.fromEntries((evalCase.inventory?.screens ?? []).map((row) => [row.id, row.slug])),
    },
  })
  const context = { stepIndex: 0, now, firestore: site.firestore, modelFor: modelFor(options), org }
  const planned = await evalPlanStep(evalCase)({ ...context, job })
  const steps: AiEvalRecordedStep[] = [recordedStep('job.plan', planned)]
  const planOnly = (note?: string): AiEvalRecordedAnswer => ({
    source: 'recorded',
    scope: 'plan',
    step: 'job.plan',
    model: planned.model,
    effort: planned.effort ?? null,
    plan: planOf(planned),
    answer: null,
    usage: planned.usage,
    ...(note ? { note } : {}),
  })
  if (!planned.plan || planned.review?.reason !== 'plan') {
    return planOnly(
      planned.failure
        ? `refused before confirm: ${planned.failure}`
        : planned.review
          ? `needs review: ${planned.review.message}`
          : undefined,
    )
  }

  const confirmed: AiJob = {
    ...job,
    plan: {
      ...planned.plan,
      status: 'confirmed',
      confirmedAt: now as unknown as AiJobPlan['confirmedAt'],
      confirmedBy: 'eval',
    },
  }
  // The site as the steps read it: the case's rows, and what the job has
  // built there so far. A case's site holds no documents to copy, so a plan
  // that starts from a copy is built from its brief, as a step builds one
  // whose source is gone.
  const readers = {
    readInventory: async () => {
      if (!evalCase.inventory) throw new Error(`${evalCase.id} has no inventory to build from`)
      return aiEvalMemoryInventory(evalCase.inventory, site.docs)
    },
    duplicate: async () => ({ ok: false as const, status: 404, error: 'A recording copies nothing' }),
  }
  const creations = {
    layout: createAiJobLayoutStep(readers),
    form: createAiJobFormStep(readers),
    component: createAiJobComponentStep(readers),
  } as const
  const generate = createAiJobPageStep({
    ...readers,
    runnerFor: (kind) => (kind in creations ? creations[kind as keyof typeof creations] : null),
  })
  const units = aiPageJobUnits(confirmed.plan as AiJobPlan)
  let outputs: AiJobOutput[] = []
  let stopped: string | undefined
  for (let pass = 0; pass < AI_EVAL_PAGE_MAX_PASSES; pass += 1) {
    const [unit] = aiSitePendingUnits(units, outputs)
    const outcome = await generate({ ...context, stepIndex: 1, job: { ...confirmed, outputs } })
    // A creation's pass is its own step's; the pass that reports the draft
    // asks for the listing, on the SEO step's model.
    const kind: AiStepKind = unit
      ? (`job.${unit.jobKind}` as AiStepKind)
      : outcome.outputs.some((output) => output.resource === 'screen')
        ? 'job.seo'
        : 'job.page'
    steps.push(recordedStep(kind, outcome))
    outputs = [...outputs, ...outcome.outputs]
    if (outcome.refused || outcome.failure || outcome.review) {
      stopped = outcome.refused ? 'refused' : (outcome.failure ?? outcome.review?.message)
      break
    }
    if (!outcome.continue) break
  }

  const screenPath = `hosts/${hostId}/screens/${aiJobDraftId(confirmed, 'screen')}`
  const nodes = storedTree(site.docs, screenPath)
  const built = outputs.some((output) => output.resource === 'screen')
  const screen = built && nodes ? recordedScreen(evalCase, site.docs, screenPath, outputs) : undefined
  return {
    source: 'recorded',
    scope: built && nodes ? 'full' : 'plan',
    step: 'job.page',
    model: steps.find((entry) => entry.step === 'job.page')?.model ?? planned.model,
    effort: null,
    plan: planOf(planned),
    answer: built && nodes ? { tree: { rootId: CANVAS_ROOT_ELEMENT_ID, nodes } } : null,
    usage: totalUsage(steps),
    steps,
    ...(screen ? { screen } : {}),
    ...(stopped ? { note: `stopped: ${stopped}` } : {}),
  }
}

/** A string a stored document holds, trimmed; `null` for none. */
function storedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The node map a versioned draft's first version holds, decoded; `null` when there is none. */
function storedTree(docs: ReadonlyMap<string, Record<string, unknown>>, draftPath: string): Record<string, unknown> | null {
  const draft = docs.get(draftPath)
  const version = draft ? docs.get(`${draftPath}/versions/${String(draft['versionId'])}`) : undefined
  return version ? decodeStoredNodes<Record<string, unknown>>(version['nodes']) : null
}

/**
 * The draft screen a page job wrote, as its grader reads it beside the tree
 * (AGL-3073): the address and listing the draft holds, whether its output
 * proposes a navigation entry, and the layout its version renders inside —
 * one this job built, with its tree, or one the case's site lists by name.
 */
function recordedScreen(
  evalCase: AiEvalCase,
  docs: ReadonlyMap<string, Record<string, unknown>>,
  screenPath: string,
  outputs: readonly AiJobOutput[],
): AiEvalRecordedScreen | undefined {
  const screen = docs.get(screenPath)
  const version = screen ? docs.get(`${screenPath}/versions/${String(screen['versionId'])}`) : undefined
  if (!screen || !version) return undefined
  const seo = (screen['seo'] ?? {}) as Record<string, unknown>
  const layoutId = storedText(version['layoutId'])
  const layoutPath = `${screenPath.split('/').slice(0, 2).join('/')}/layouts/${layoutId}`
  const built = layoutId ? docs.get(layoutPath) : undefined
  const listed = layoutId ? evalCase.inventory?.layouts.find((row) => row.id === layoutId) : undefined
  const nodes = built ? storedTree(docs, layoutPath) : null
  return {
    slug: String(screen['slug'] ?? ''),
    seoTitle: storedText(seo['title']),
    seoDescription: storedText(seo['description']),
    nav: outputs.some((output) => output.resource === 'screen' && output.proposal?.['navigation'] != null),
    layout:
      layoutId && (built || listed)
        ? {
            id: layoutId,
            name: storedText(built?.['displayName']) ?? listed?.name ?? layoutId,
            built: Boolean(built),
            tree: nodes ? { rootId: CANVAS_ROOT_ELEMENT_ID, nodes } : null,
          }
        : null,
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

/**
 * The workflow step's generation for an automation brief (AGL-3074), from
 * the case as the step's runner builds it from a site: a draft from what the
 * workspace can run and the site's forms and datasets; or, for a brief about
 * a saved action, an explanation from the action's outline, told whether the
 * records its steps name exist as the runner reads only those, with a failed
 * run's outline where the case gives one.
 */
export function aiEvalWorkflowGeneration(evalCase: AiEvalCase, model: string): AiCustomGenerationInput<unknown> {
  const records = evalCase.automationRecords ?? emptyAiAutomationRecords()
  const automation = evalCase.automation
  if (!automation) {
    return aiJobWorkflowDraftGeneration({
      brief: evalCase.brief,
      capabilities: evalCase.automationCapabilities ?? AI_EVAL_AUTOMATION_CAPABILITIES,
      records,
      model,
    }) as AiCustomGenerationInput<unknown>
  }
  const named = aiActionRecordKinds(automation.action)
  const read = Object.fromEntries(
    Object.entries(records).map(([kind, rows]) => [kind, named.includes(kind as keyof AiAutomationRecords) ? rows : []]),
  ) as unknown as AiAutomationRecords
  return aiJobWorkflowExplainGeneration({
    brief: evalCase.brief,
    mode: automation.run ? 'diagnose' : 'explain',
    outline: aiActionOutline(automation.action, read),
    run: automation.run ? aiRunOutline(automation.run) : null,
    model,
  }) as AiCustomGenerationInput<unknown>
}

/**
 * An automation brief, recorded through the workflow step's own generation
 * call (AGL-3074). The tool's raw input is kept, because that is what the
 * harness scores: the step's runner turns a draft into the action it writes,
 * and an explanation into the text it reports, and keeps the input nowhere.
 */
const recordWorkflow: AiEvalRecorder = async (evalCase, options) => {
  const generation = aiEvalWorkflowGeneration(evalCase, options.model ?? aiJobWorkflowModel())
  let raw: Record<string, unknown> | null = null
  const result = await runValidatedGeneration(
    'workflow',
    withProvider(
      {
        ...generation,
        check: (answer: Record<string, unknown>) => {
          raw = answer
          return generation.check(answer)
        },
      },
      options,
    ),
  )
  return {
    source: 'recorded',
    scope: 'full',
    step: 'job.workflow',
    model: result.model,
    effort: result.effort,
    plan: null,
    answer: result.status === 'refused' ? null : raw,
    usage: result.usage,
    steps: [recordedStep('job.workflow', result)],
    ...(result.status === 'needs_input'
      ? {
          note: `needs review: ${result.message}`,
          // An automation draft is the largest thing anything here asks for,
          // so it is the one that runs out of ceiling (AGL-3143). What the
          // provider wrote goes on the recording, where the run that paid for
          // it can still be read after it ends.
          ...(result.rawOutput ? { rawOutput: result.rawOutput } : {}),
        }
      : {}),
  }
}

/** The site a case's job runs on: its inventory's, or the harness's own. */
function aiEvalSiteId(evalCase: AiEvalCase): string {
  return evalCase.inventory?.hostId ?? AI_EVAL_SITE_ID
}

/** A products brief's job inputs, as the editor or a products card hands them over. */
function aiEvalProductsInputs(evalCase: AiEvalCase): Record<string, string> {
  if (evalCase.kind === 'catalog') return aiProductsJobInputs({ target: 'catalog' })
  if (evalCase.kind === 'categories') return aiProductsJobInputs({ target: 'categories' })
  if (!evalCase.product) throw new Error(`${evalCase.id} names no product to write copy for`)
  return aiProductsJobInputs({ target: 'product', product: evalCase.product.facts })
}

/** A picture's content type, from the extension of the fixture that holds it. */
function fixtureContentType(file: string): string {
  const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  return `image/${extension === 'jpg' ? 'jpeg' : extension}`
}

/**
 * The storage read of a case's media library (AGL-3074): the fixture the case
 * names for an asset of its own site's library, and nothing for any other. It
 * stands in for the download alone, so the products step's own path still
 * locates the photo, decodes it, turns it upright, resizes it and encodes the
 * JPEG the model is sent.
 */
function aiEvalMediaSeams(evalCase: AiEvalCase, options: AiEvalLiveOptions): AiProductImageSeams {
  return {
    readBytes: async (_firestore, location, hostId) => {
      const own = !location.scope.isOrg && location.scope.scopeId === hostId
      const file = own ? evalCase.media?.[location.mediaId] : undefined
      if (!file || !options.readFixture) return null
      return { buffer: await options.readFixture(file), contentType: fixtureContentType(file) }
    },
  }
}

/**
 * A product case's photo, as the products step sends it (AGL-3074): read
 * through `ai-product-image.ts` from the case's fixtures. `null` for a case
 * whose product has none, or whose photo cannot be read.
 */
export async function aiEvalCasePhoto(evalCase: AiEvalCase, options: AiEvalLiveOptions): Promise<AiImagePart | null> {
  const value = evalCase.product?.facts.imageUrl
  if (!value) return null
  const read = await readAiProductImage(
    {} as FirebaseFirestore.Firestore,
    { value, hostId: aiEvalSiteId(evalCase), orgId: EVAL_ORG },
    aiEvalMediaSeams(evalCase, options),
  )
  return read.status === 'read' ? read.image : null
}

/**
 * A products proposal read back as the tool input the harness scores
 * (AGL-3074): a product's copy as its check kept it, a catalog's products,
 * and categories with each discount in the tool's own terms — a percentage or
 * dollars, a minimum order in dollars, and an empty code for a discount that
 * applies on its own.
 */
export function aiEvalProductsAnswer(proposal: AiProductsProposal): Record<string, unknown> | null {
  if (proposal.kind === 'copy') return proposal.values ? { ...proposal.values } : null
  if (proposal.kind === 'catalog') return { products: proposal.products }
  return {
    categories: proposal.categories,
    discounts: proposal.discounts.map((discount) => ({
      name: discount.name,
      code: discount.code ?? '',
      kind: discount.kind,
      value:
        discount.kind === 'percent'
          ? (discount.valuePct ?? 0)
          : discount.kind === 'fixed'
            ? (discount.valueCents ?? 0) / 100
            : 0,
      minimumOrderUsd: (discount.minSubtotalCents ?? 0) / 100,
      why: discount.why,
    })),
  }
}

/**
 * A products brief — one product's copy, a store's first catalog, or its
 * categories and discounts — recorded through the products step's runner
 * (AGL-3074), against the case's store kept in memory: its name, its
 * categories, and the photo its media names. What it answers is read back off
 * the proposal the runner makes.
 */
const recordProducts: AiEvalRecorder = async (evalCase, options) => {
  const hostId = aiEvalSiteId(evalCase)
  const categories =
    evalCase.kind === 'product'
      ? (evalCase.product?.categories ?? [])
      : (evalCase.existingCategoryNames ?? []).map((name, index) => ({ id: `category-${index + 1}`, name }))
  const store = aiEvalMemoryFirestore({
    [`hosts/${hostId}`]: { orgId: EVAL_ORG, ...(evalCase.siteName ? { displayName: evalCase.siteName } : {}) },
    ...Object.fromEntries(
      categories.map((category) => [`hosts/${hostId}/productCategories/${category.id}`, { name: category.name }]),
    ),
  })
  const outcome = await createAiJobProductsStep({ image: aiEvalMediaSeams(evalCase, options) })({
    job: { ...evalJob(evalCase, 'products'), hostId, inputs: aiEvalProductsInputs(evalCase) },
    stepIndex: 0,
    now: options.now ?? new Date(),
    firestore: store.firestore,
    modelFor: modelFor(options),
  })
  const proposal = aiProductsProposalOf(outcome.outputs[0])
  const stopped = outcome.refused ? 'refused' : outcome.failure
  return {
    source: 'recorded',
    scope: 'full',
    step: 'job.products',
    model: outcome.model,
    effort: outcome.effort ?? null,
    plan: null,
    answer: proposal ? aiEvalProductsAnswer(proposal) : null,
    usage: outcome.usage,
    steps: [recordedStep('job.products', outcome)],
    ...(proposal?.kind === 'copy' ? { photo: proposal.photo } : {}),
    ...(stopped ? { note: `stopped: ${stopped}` } : {}),
  }
}

/** Where production answers a kind no recorder covers. */
export type AiEvalUnrecordedDoor =
  /** A request route no job runs, by what it is and the module that answers it. */
  | { route: string; file: string }
  /** A job step no recorder drives yet, by its job kind and module. */
  | { step: AiJob['kind']; file: string }

/**
 * Every kind no recorder covers, and the door that answers it in production
 * (AGL-3074), so a skipped brief says why truthfully. Modules are named from
 * the plugin's `src/lib`.
 */
export const AI_EVAL_UNRECORDED_DOORS: Readonly<Partial<Record<AiEvalKind, AiEvalUnrecordedDoor>>> = {
  section: { route: 'the copy assistant’s section mode', file: 'server/ai-assist.ts' },
  element: { route: 'the copy assistant’s element mode', file: 'server/ai-assist.ts' },
  blog: { route: 'the copy assistant’s blog mode', file: 'server/ai-assist.ts' },
  chat: { route: 'the console assistant', file: 'server/assist-chat.ts' },
  email: { step: 'email', file: 'jobs/ai-job-email-step.ts' },
  seo: { step: 'seo', file: 'jobs/ai-job-seo-step.ts' },
  insight: { step: 'insight', file: 'jobs/ai-job-insight-step.ts' },
  crm: { step: 'crm', file: 'jobs/ai-job-crm-step.ts' },
  experiment: { step: 'experiment', file: 'jobs/ai-job-experiment-step.ts' },
}

/** Why a brief of this kind is skipped: where its door is, and that no recorder drives it. */
export function aiEvalSkipReason(kind: AiEvalKind): string {
  const door = AI_EVAL_UNRECORDED_DOORS[kind]
  if (!door) return 'no recorder: none is registered for this kind'
  return 'route' in door
    ? `no recorder: the door that answers this kind is a request route (${door.route}, ${door.file}), not a job step`
    : `no recorder yet: this kind is answered by the ${door.step} job step (${door.file}), which no recorder drives`
}

for (const kind of Object.keys(AI_EVAL_TREE_OUTPUT) as AiEvalKind[]) {
  // A section rewrite is the copy assistant's, a request route: no plan step.
  if (kind !== 'section' && kind !== 'email') registerAiEvalRecorder(kind, recordPlan)
}
registerAiEvalRecorder('page', recordPage)
registerAiEvalRecorder('text', recordText)
registerAiEvalRecorder('theme', recordTheme)
registerAiEvalRecorder('workflow', recordWorkflow)
for (const kind of ['product', 'catalog', 'categories'] as const) registerAiEvalRecorder(kind, recordProducts)

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
 *
 * Two facts it cannot read off the schema are stated as well. Only a page or
 * site job plans screens: the plan step tells a component, layout, template,
 * form or email job to plan none, so an empty `screens` on one of those is the
 * answer working, and a grader that does not know it marks the plan down for
 * doing what it was told. And a search is an element, never a form: a form
 * collects submissions, and a grader that does not know the platform has
 * search elements rewards a plan for creating a form to search with.
 */
export const AI_EVAL_PLAN_GRADER_NOTE =
  'A build plan is not the finished output: it is the proposal a member confirms before anything is generated. ' +
  'It holds only what it reuses by inventory id, what it creates and why, and its screens — each with a title, ' +
  'slug, layout, template, nav flag, search title and description, and sections named with what they place and ' +
  'how many items they hold. Only a page or site job plans screens: the plan of a component, layout, template, ' +
  'form or email job has an empty screens list by design, and is never marked down for it. ' +
  'A plan has no node tree, no heading order, no landmarks, no theme tokens, no field ' +
  'labels or validation, and no body copy; all of those belong to the generation step that runs once the plan is ' +
  'confirmed. Grade structure on whether the plan proposes the right screens, sections, fields and creations for ' +
  'the brief. A search box is a Search Box element, or a Collection Search element over a collection\'s entries, ' +
  'and never a new form, because a form collects submissions: a plan that creates a form to search with has ' +
  'proposed the wrong creation. Grade copy on the only words a plan writes: screen titles, search titles and ' +
  'descriptions, and the names and rationales of what it creates. Do not mark a plan down for anything a plan ' +
  'cannot hold.'

/**
 * What the grader of a case with capabilities is told beside them (AGL-3040).
 *
 * A case that describes its workspace had its plan told what that workspace
 * may create, and a workspace that keeps no reusable components or saved
 * forms builds the only way it can: a list's repeated items drawn in one
 * section, the form carried by the page. A grader told none of that grades
 * the doctrine whole, and marks reuse down for exactly the build the workspace
 * required, as it marked down the first live recording of the Free brief.
 */
export const AI_EVAL_CAPABILITIES_GRADER_NOTE =
  'Grade reuse against what this workspace may create, as listed above: never mark an output down for not creating what the workspace may not make.'

/**
 * Beside that, where the workspace keeps no reusable components or saved
 * forms, which the capability lines have already said.
 */
export const AI_EVAL_INLINE_GRADER_NOTE =
  "On this workspace, a list's repeated items drawn in one section and a form drawn on the page, as a Form element holding its Form Fields, are the correct build and never a missed reuse."

/**
 * What a section's `uses` can hold on such a workspace (AGL-3143).
 *
 * A section's `uses` names what the section PLACES, and the only things it
 * can name are an inventory id and a `new:<name>` creation. A workspace that
 * keeps no reusable components or saved forms has neither to name, and the
 * capability lines above have already refused the job the creations — so
 * every inline section leaves `uses` empty because it is the only answer it
 * can give. A grader that does not know it reads the empty list as a section
 * that places nothing and marks the plan down for being correct, which drags
 * the floors down for a reason that has nothing to do with the answer.
 */
export const AI_EVAL_INLINE_USES_GRADER_NOTE =
  "A section's `uses` names what it places, and can name only an inventory id or a creation. This workspace has neither to place and may create neither, so an empty `uses` on a section drawn inline is the only answer there is: never mark a plan or a section down for it."

/**
 * The workspace a case describes, as its grader reads it: the capability
 * lines the plan step was sent, narrowed to what the job builds the way the
 * step narrows them, and the notes on grading against them. `null` for a
 * case that describes no workspace, whose output is held to the doctrine
 * whole.
 */
export function aiEvalGraderCapabilities(evalCase: AiEvalCase): string | null {
  if (!evalCase.capabilities) return null
  const scope = AI_JOB_PLAN_SCOPES[evalCase.kind as AiJob['kind']] ?? null
  const capabilities = aiPlanCapabilitiesForJob(evalCase.capabilities, scope)
  return [
    ...aiPlanCapabilityLines(capabilities),
    AI_EVAL_CAPABILITIES_GRADER_NOTE,
    ...(capabilities.reusableComponents
      ? []
      : [AI_EVAL_INLINE_GRADER_NOTE, AI_EVAL_INLINE_USES_GRADER_NOTE]),
  ].join('\n')
}

/**
 * What the grader of a built page is told beside it (AGL-3073).
 *
 * A page's tree holds only what the page adds. The site's header, navigation
 * and footer are its layout's; the one main landmark is placed when the page
 * is composed (`stampDocumentLandmark`), on the layout's slot where the page
 * renders, or on the page's root when it renders inside none; and its address
 * and listing are fields of its screen. A grader shown the tree alone marks a
 * page down for a layout, a landmark and a listing the page has.
 */
export const AI_EVAL_PAGE_GRADER_NOTE =
  'A page is built inside its layout and published as a screen, so its tree holds only what the page adds: ' +
  "the site's header, navigation and footer are the layout's; the page's one main landmark is placed when it is " +
  "published, on the layout's slot where the page renders, or on the page's root when it has no layout; and its " +
  'address, search title and description are fields of its screen. Grade the page as built with all of them, as ' +
  'listed above, and never mark it down for a layout, a landmark, an address or a listing its tree does not repeat.'

/** The most elements a layout's outline lists; the rest are counted. */
export const AI_EVAL_LAYOUT_OUTLINE_MAX_LINES = 40

/** The most characters of an element's own text an outline quotes. */
const AI_EVAL_OUTLINE_TEXT_MAX_CHARS = 48

type Loose = Record<string, unknown>

const isLoose = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const looseList = (value: unknown): Loose[] => (Array.isArray(value) ? value.filter(isLoose) : [])

const looseText = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** An element of an outline: what it renders as, its component, and its own text, quoted short. */
function outlineLine(node: Loose): string {
  const props = isLoose(node['props']) ? node['props'] : {}
  const element = looseText(props['component']) || looseText(props['element'])
  const text = looseText(props['children'])
  const quoted = text
    ? ` "${text.length > AI_EVAL_OUTLINE_TEXT_MAX_CHARS ? `${text.slice(0, AI_EVAL_OUTLINE_TEXT_MAX_CHARS)}…` : text}"`
    : ''
  const slot = node['componentId'] === LAYOUT_SLOT_COMPONENT_ID ? ' ← the page renders here' : ''
  return `${element ? `${element} · ` : ''}${String(node['componentId'] ?? '?')}${quoted}${slot}`
}

/**
 * A layout as its page's grader reads it (AGL-3073): an element a line,
 * indented by depth, named by the element it renders as and its component,
 * with its own text quoted short. The main landmark is placed where a
 * published page places it, by the function that places it there.
 */
export function aiEvalLayoutOutline(tree: { rootId: string; nodes: Record<string, unknown> }): string {
  const nodes = stampDocumentLandmark(tree.nodes as never) as Record<string, unknown>
  const lines: string[] = []
  const seen = new Set<string>()
  let unlisted = 0
  const visit = (id: string, depth: number): void => {
    const node = nodes[id]
    if (!isLoose(node) || seen.has(id)) return
    seen.add(id)
    if (lines.length < AI_EVAL_LAYOUT_OUTLINE_MAX_LINES) lines.push(`${'  '.repeat(depth)}${outlineLine(node)}`)
    else unlisted += 1
    for (const child of Array.isArray(node['nodes']) ? node['nodes'] : []) {
      if (typeof child === 'string') visit(child, depth + 1)
    }
  }
  visit(tree.rootId, 0)
  return [...lines, ...(unlisted ? [`… and ${unlisted} more elements`] : [])].join('\n')
}

/**
 * The plan a built answer came from, as its grader reads it (AGL-3073): what
 * it reuses and creates, and each screen's sections in order, with what each
 * places and how many items it shows. `null` for an answer with no plan.
 */
export function aiEvalPlanOutline(plan: unknown): string | null {
  if (!isLoose(plan)) return null
  const lines = ['The plan it was built from, as the member confirmed it:']
  for (const entry of looseList(plan['reuse'])) {
    lines.push(`- reuses the ${looseText(entry['kind'])} ${looseText(entry['id'])}: ${looseText(entry['purpose'])}`)
  }
  for (const entry of looseList(plan['create'])) {
    const fields = Array.isArray(entry['fields']) ? entry['fields'].map(looseText).filter(Boolean) : []
    lines.push(
      `- creates the ${looseText(entry['kind'])} "${looseText(entry['name'])}": ${looseText(entry['why'])}${
        fields.length ? ` Holds: ${fields.join('; ')}.` : ''
      }`,
    )
  }
  for (const screen of looseList(plan['screens'])) {
    lines.push(`- the screen "${looseText(screen['title'])}", its sections in order:`)
    looseList(screen['sections']).forEach((section, index) => {
      const uses = Array.isArray(section['uses']) ? section['uses'].map(looseText).filter(Boolean) : []
      const items = Number(section['items'])
      lines.push(
        `  ${index + 1}. ${looseText(section['name'])}${uses.length ? `, placing ${uses.join(', ')}` : ''}${
          items > 0 ? `, ${items} ${items === 1 ? 'item' : 'items'}` : ''
        }`,
      )
    })
  }
  return lines.length > 1 ? lines.join('\n') : null
}

/** A screen's address as a visitor reads it. */
function addressOf(slug: string): string {
  return slug.startsWith('/') ? slug : `/${slug}`
}

/** A listing value quoted, or said to be missing. */
function listingValue(value: string | null | undefined): string {
  return value ? `"${value}"` : 'none'
}

/**
 * A built page's screen and layout, as its grader reads them (AGL-3073). A
 * recording that kept the draft's screen gives its stored address and listing
 * and the layout it renders inside, outlined from its tree. One made before
 * that was kept gives its plan's screen instead, which is what the page step
 * builds from, and says so.
 */
export function aiEvalBuiltPage(answer: AiEvalRecordedAnswer): string | null {
  const recorded = answer.screen
  const plan = isLoose(answer.plan) ? answer.plan : null
  const planned = looseList(plan?.['screens'])[0]
  if (!recorded && !planned) return null
  if (recorded) {
    const layout = recorded.layout
    return [
      'The page as built:',
      `- address: ${addressOf(recorded.slug)}`,
      `- search title: ${listingValue(recorded.seoTitle)}`,
      `- search description: ${listingValue(recorded.seoDescription)}`,
      `- navigation: ${recorded.nav ? 'an entry for the page is proposed' : 'no entry is proposed'}`,
      !layout
        ? "- layout: none, so the page's root is its main landmark"
        : layout.tree
          ? `- layout: "${layout.name}", ${layout.built ? 'built by this job before the page' : 'which the site already had'}. Its outline:\n${aiEvalLayoutOutline(layout.tree)
              .split('\n')
              .map((line) => `  ${line}`)
              .join('\n')}`
          : `- layout: "${layout.name}", which the site already has; the page renders in its slot`,
    ].join('\n')
  }
  const reference = looseText(planned['layout'])
  const created = reference.startsWith('new:')
    ? looseList(plan?.['create']).find(
        (entry) => entry['kind'] === 'layout' && looseText(entry['name']) === reference.slice('new:'.length),
      )
    : undefined
  const builtByJob = (answer.steps ?? []).some((step) => step.step === 'job.layout')
  // What the layout holds is on the plan's own line above; it is not repeated.
  const layout = !reference
    ? "- layout: none, so the page's root is its main landmark"
    : created
      ? `- layout: "${looseText(created['name'])}", which the plan creates${
          builtByJob ? ' and this job built before the page' : ''
        }. A layout this job builds holds one Layout Slot, where the page renders, and the slot is the page's main landmark; the recording kept no tree of it`
      : `- layout: ${reference}, which the site already has; the page renders in its slot`
  return [
    "The page as its plan built it (the recording kept no record of the draft's screen):",
    `- address: ${addressOf(looseText(planned['slug']))}`,
    `- search title, as planned: ${listingValue(looseText(planned['seoTitle']))}`,
    `- search description, as planned: ${listingValue(looseText(planned['seoDescription']))}`,
    `- navigation: ${planned['nav'] === true ? 'an entry for the page is proposed' : 'no entry is proposed'}`,
    layout,
  ].join('\n')
}

/** Keys a stored node keeps for the store: its own id, its parent, its node type and its plugin. */
function graderNode(id: string, node: unknown): unknown {
  if (!isLoose(node)) return node
  const kept: Loose = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parentId' || key === 'pluginId') continue
    if (key === '$id' && value === id) continue
    if (key === 'type' && value === 'node') continue
    kept[key] = value
  }
  return kept
}

/**
 * An answer's output as its grader reads it: copy as written, and anything
 * else as JSON, a tree's nodes without the keys the store keeps for itself
 * (AGL-3073). Those are about a third of a recorded page, and a grade reads
 * none of them: a node's id is its key and its parent is the node that lists
 * it.
 */
export function aiEvalGraderOutput(output: unknown): string {
  if (typeof output === 'string') return output
  const tree = isLoose(output) && isLoose(output['tree']) ? output['tree'] : null
  if (!isLoose(output) || !tree || !isLoose(tree['nodes'])) return JSON.stringify(output)
  const nodes = Object.fromEntries(Object.entries(tree['nodes']).map(([id, node]) => [id, graderNode(id, node)]))
  return JSON.stringify({ ...output, tree: { ...tree, nodes } })
}

/**
 * What the grader of an answer written from more than its brief is shown of
 * the request (AGL-3074): the user turn the kind's step sends, built from the
 * case by the step's own prompt builder — a product and the categories it may
 * go in, the categories a store already has, or what an automation draft or
 * explanation was asked from. A grader that is not shown them grades copy
 * against a product it never saw, and an explanation against an automation it
 * never read. `null` for a kind whose request is its brief and its site.
 */
export function aiEvalGraderRequest(evalCase: AiEvalCase, answer: AiEvalRecordedAnswer): string | null {
  if (evalCase.kind === 'product') {
    return evalCase.product
      ? aiProductCopyPrompt({
          store: evalCase.siteName ?? '',
          product: evalCase.product.facts,
          categories: evalCase.product.categories,
          photo: answer.photo === 'read',
        })
      : null
  }
  if (evalCase.kind === 'categories') {
    return aiCategoriesPrompt({
      store: evalCase.siteName ?? '',
      brief: evalCase.brief,
      existingCategoryNames: evalCase.existingCategoryNames ?? [],
    })
  }
  if (evalCase.kind === 'workflow') {
    const [turn] = aiEvalWorkflowGeneration(evalCase, answer.model ?? aiJobWorkflowModel()).messages
    return typeof turn?.content === 'string' ? turn.content : null
  }
  return null
}

/** What the grader of product copy written with its photo in view is told beside the photo (AGL-3074). */
export const AI_EVAL_PHOTO_GRADER_NOTE =
  "The product's photo is attached, as the job sent it. Copy may state what the photo plainly shows and is never marked down for it; it is marked down for what neither the photo nor the product's words show."

/** What the grader is told when the photo the copy was written with cannot be shown to it. */
export const AI_EVAL_PHOTO_UNSHOWN_GRADER_NOTE =
  "The copy was written with the product's photo in view, and this grader is not shown it: never mark copy down for a detail only the photo could show."

/**
 * The grader's user turn: the brief, its site, the workspace where the case
 * describes one, the request beyond the brief, the plan a built answer came
 * from, the screen and layout a built page was built as, and the answer.
 * `shown.photo` says the product's photo rides beside this turn.
 */
export function aiEvalGraderPrompt(
  evalCase: AiEvalCase,
  answer: AiEvalRecordedAnswer,
  shown: { photo?: boolean } = {},
): string {
  const planScope = answer.scope === 'plan'
  const output = planScope ? answer.plan : answer.answer
  const workspace = aiEvalGraderCapabilities(evalCase)
  const request = planScope ? null : aiEvalGraderRequest(evalCase, answer)
  const plan = planScope ? null : aiEvalPlanOutline(answer.plan)
  const page = !planScope && evalCase.kind === 'page' ? aiEvalBuiltPage(answer) : null
  return [
    `Output kind: ${evalCase.kind}${planScope ? ' (its build plan)' : ''}`,
    ...(planScope ? [AI_EVAL_PLAN_GRADER_NOTE] : []),
    `Brief: ${evalCase.brief}`,
    aiSiteInventoryBlock(evalCase.inventory),
    ...(workspace ? [workspace] : []),
    ...(request ? [`The request the answer was written from:\n${request}`] : []),
    ...(answer.photo === 'read' ? [shown.photo ? AI_EVAL_PHOTO_GRADER_NOTE : AI_EVAL_PHOTO_UNSHOWN_GRADER_NOTE] : []),
    ...(plan ? [plan] : []),
    ...(page ? [page, AI_EVAL_PAGE_GRADER_NOTE] : []),
    `Output:\n${aiEvalGraderOutput(output)}`,
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
  const provider = options.provider ?? resolveAiProvider()
  const model = options.graderModel ?? (provider ? aiDefaultModelFor(provider.id, 'deep') : undefined)
  if (!model) throw new Error('no grader model: the provider serves no deep tier and none was named')
  // Copy written with the product's photo in view is graded with the same
  // picture, where the grader's model reads one (AGL-3074).
  const photo =
    answer.photo === 'read' && provider && aiModelReadsImages(provider, model)
      ? await aiEvalCasePhoto(evalCase, options)
      : null
  const prompt = aiEvalGraderPrompt(evalCase, answer, { photo: Boolean(photo) })
  const result = await runValidatedGeneration(
    'eval-grade',
    withProvider(
      {
        model,
        instructions: AI_EVAL_GRADER_INSTRUCTIONS,
        messages: [
          { role: 'user' as const, content: photo ? [photo, { type: 'text' as const, text: prompt }] : prompt },
        ],
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

/** Which half of a case's run threw: asking for the answer, or grading it. */
export type AiEvalLiveStep = 'record' | 'grade'

/** A brief whose run threw, as the report keeps it. */
export interface AiEvalLiveFailure {
  caseId: string
  kind: AiEvalKind
  step: AiEvalLiveStep
  /** What was thrown, as a sentence. */
  error: string
  /** The provider's request id, when the throw carried one — the vendor log's join key. */
  requestId: string | null
}

export interface AiEvalLiveReport {
  recorded: Array<{ caseId: string; kind: AiEvalKind; candidate: AiEvalCandidate }>
  skipped: Array<{ caseId: string; kind: AiEvalKind; why: string }>
  /** The briefs whose run threw; empty when every brief a recorder covers came back. */
  failed: AiEvalLiveFailure[]
}

/** The vendor's request id off a thrown `UpstreamServiceError`, when it carried one. */
function requestIdOfThrown(error: unknown): string | null {
  const id = (error as { requestId?: unknown } | null)?.requestId
  return typeof id === 'string' && id ? id : null
}

function messageOfThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * Record and grade an answer for every brief a recorder covers. Refused
 * before anything else unless `AI_EVAL_LIVE=1` names the run, and before any
 * request when a brief it would record names media the run cannot read.
 *
 * ONE BRIEF'S FAILURE IS NOT THE RUN'S (AGL-3143). A run is owner-approved
 * spend, and a provider that refuses one brief — a tool it will not compile,
 * a rate limit — used to end the whole run with the answers already paid for
 * still in memory and never written. Each brief is run on its own instead:
 * one that throws is kept as a failure naming what was thrown, the vendor's
 * request id and which half of its run threw, and the briefs behind it are
 * still recorded. The caller writes what came back and decides what a
 * non-empty `failed` means for its exit status.
 *
 * A brief whose GRADE threw is in both halves: recorded, with its grade
 * marked missing, and failed, naming what the grader threw.
 */
export async function recordAiEvalLive(
  cases: readonly AiEvalCase[],
  options: AiEvalLiveOptions,
): Promise<AiEvalLiveReport> {
  if (!aiEvalLiveAllowed(options.env)) throw new AiEvalLiveRefusedError()
  const unreadable = cases.filter((evalCase) => evalCase.media && aiEvalRecorderFor(evalCase.kind) && !options.readFixture)
  if (unreadable.length) {
    throw new Error(
      `${unreadable.map((evalCase) => evalCase.id).join(', ')} name media, and this run was given no readFixture to read them with`,
    )
  }
  const report: AiEvalLiveReport = { recorded: [], skipped: [], failed: [] }
  for (const evalCase of cases) {
    const recorder = aiEvalRecorderFor(evalCase.kind)
    if (!recorder) {
      report.skipped.push({ caseId: evalCase.id, kind: evalCase.kind, why: aiEvalSkipReason(evalCase.kind) })
      continue
    }
    const failure = (step: AiEvalLiveStep, error: unknown): void => {
      report.failed.push({
        caseId: evalCase.id,
        kind: evalCase.kind,
        step,
        error: messageOfThrown(error),
        requestId: requestIdOfThrown(error),
      })
    }
    let answer: AiEvalRecordedAnswer
    try {
      answer = await recorder(evalCase, options)
    } catch (error) {
      failure('record', error)
      continue
    }
    // A GRADER THAT THROWS DOES NOT TAKE THE ANSWER WITH IT (AGL-3143). The
    // brief is already paid for by here, and grading is a second request that
    // can fail on its own — a rate limit, a tool the provider will not
    // compile. The answer is recorded with its grade marked missing, and the
    // throw is still reported, so the run exits non-zero without the next
    // one having to buy this answer again.
    try {
      const rubric = await gradeAiEvalCandidate(evalCase, answer, options)
      report.recorded.push({ caseId: evalCase.id, kind: evalCase.kind, candidate: { ...answer, rubric } })
    } catch (error) {
      report.recorded.push({ caseId: evalCase.id, kind: evalCase.kind, candidate: { ...answer, rubric: null } })
      failure('grade', error)
    }
  }
  return report
}
