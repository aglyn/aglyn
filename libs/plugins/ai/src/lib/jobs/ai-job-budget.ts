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

import { aiCatalogEntry, type AiCatalogEntry } from '../providers/catalog'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { AI_INVENTORY_LOOKUP_MAX_ROUNDS } from '../tools/ai-inventory-lookup-tool'

/**
 * How long a generation takes, planned from what one answer costs in time
 * (AGL-2907), so a step that generates can say how much time it needs before
 * it starts.
 *
 * The job machine gives a step what is left of its caller's budget as an
 * abort signal: the beat's sweep, or an inline door. A provider call that
 * signal cuts off is still generated and billed upstream, while the meter
 * records nothing. So a generation step registers the least time it needs
 * (`registerAiJobStep(kind, runner, { minimumMs })`), and sizes its answer so
 * its worst case — every model call it may make answered at its ceiling —
 * fits inside that.
 *
 * ── Every model call, not only the answers (AGL-3036) ────────────────────
 *
 * A generation offered the site inventory may spend up to
 * `AI_INVENTORY_LOOKUP_MAX_ROUNDS` model calls looking records up before it
 * answers, each asked at the answer's ceiling. The doctrine's loop holds the
 * whole generation — lookups, answer and re-ask — to one allowance of output,
 * `AI_GENERATION_MAX_ATTEMPTS` times the ceiling, and asks each call for no
 * more than is left of it. So the worst case is every call's wait for a first
 * token, plus that allowance at the assumed rate, plus the step's own reads
 * and writes: a lookup round adds a wait, and the output it spends is output
 * no answer can.
 *
 * ── Declared assumptions, not measurements ───────────────────────────────
 *
 * No spec can time a provider, and no recorded run has measured one, so the
 * two rates below are assumptions the budget is planned against, named as
 * such here and in `docs/AI_JOBS.md`. They err slow: a real answer that
 * outruns them only leaves time unused. A measured run replaces them.
 */

/**
 * ASSUMED: the slowest answer rate, in output tokens a second, that a step
 * plans for on each catalog tier. An unknown model is planned at the slowest.
 */
export const AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND: Readonly<
  Record<AiCatalogEntry['tier'], number>
> = {
  fast: 100,
  balanced: 60,
  deep: 40,
}

/**
 * ASSUMED: how long a provider takes to start answering — reading a prompt
 * whose static part is cached.
 */
export const AI_JOB_ASSUMED_FIRST_TOKEN_MS = 3_000

/** The step's own reads and writes around its generation: the site read and the draft transaction. */
export const AI_JOB_STEP_OVERHEAD_MS = 3_000

/**
 * How long an inline door — the console route that creates a job, and the one
 * that resumes it — waits for the step it runs before handing the job to the
 * beat. Inside the route's 60 s `maxDuration` with room for the ladder and the
 * writes on either side; a step still running at the bound is aborted and
 * re-queued, and the answer says `queued`. A step whose least time is more
 * than this is never started there at all.
 */
export const AI_JOB_INLINE_BUDGET_MS = 25_000

/**
 * Wall clock one beat may spend running steps before it yields (AGL-3026).
 *
 * Bounded by the beat route's 300 s function ceiling, not by the beat's
 * interval: what is left of it above this is the route's own work around the
 * sweep — loading the plugin surfaces on a cold start, the lockdown read and
 * the beat's mark, and the last step's record after its provider call. The
 * slowest step is fitted to this budget (`AI_JOB_STEP_MAX_MINIMUM_MS`), never
 * the budget to the step. The beat fires every minute whatever this is, and
 * overlapping beats are kept apart by the lease.
 */
export const AI_JOB_SWEEP_BUDGET_MS = 280_000

/**
 * ASSUMED: what a sweep spends before it can start its first step — the two
 * queue queries, on a function whose Firestore channel may still be cold.
 */
export const AI_JOB_SWEEP_QUEUE_READ_MS = 4_000

/**
 * The most time a step may register as its least (AGL-3036): what a beat can
 * give the first step it starts. A step that needed more could never start,
 * so a generation whose worst case at its routing ceiling needs more asks for
 * less than that ceiling, as much as fits this.
 */
export const AI_JOB_STEP_MAX_MINIMUM_MS = AI_JOB_SWEEP_BUDGET_MS - AI_JOB_SWEEP_QUEUE_READ_MS

/** The tier a model is planned at: its catalog tier, else the slowest. */
export function aiJobBudgetTier(model: string): AiCatalogEntry['tier'] {
  return aiCatalogEntry(model)?.tier ?? 'deep'
}

/** How long an answer of `tokens` output takes on a tier at the assumed rate. */
export function aiJobAssumedAnswerMs(tokens: number, tier: AiCatalogEntry['tier']): number {
  return Math.ceil((tokens * 1_000) / AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND[tier])
}

/** The shape of one generation, as the worst case counts it. */
export interface AiGenerationShape {
  /** Answers one generation may make: the first, and its re-ask. */
  attempts?: number
  /**
   * Inventory-lookup rounds it may spend before it answers (AGL-3036):
   * `AI_INVENTORY_LOOKUP_MAX_ROUNDS` unless it says otherwise. A generation
   * that carries no site inventory is offered no lookup and passes 0.
   */
  lookups?: number
  /** Time the step spends on reads of its own, beyond `AI_JOB_STEP_OVERHEAD_MS`. */
  ownReadsMs?: number
}

export interface AiGenerationTimeInput extends AiGenerationShape {
  /** The model the step resolved: its tier decides the assumed rate. */
  model: string
}

interface Shape {
  attempts: number
  lookups: number
  ownReadsMs: number
}

function shapeOf(input: AiGenerationShape): Shape {
  return {
    attempts: input.attempts ?? AI_GENERATION_MAX_ATTEMPTS,
    lookups: input.lookups ?? AI_INVENTORY_LOOKUP_MAX_ROUNDS,
    ownReadsMs: input.ownReadsMs ?? 0,
  }
}

/** Everything a generation's worst case holds but its output: a first-token wait a call, and the step's own time. */
function fixedMs(shape: Shape): number {
  return (
    (shape.attempts + shape.lookups) * AI_JOB_ASSUMED_FIRST_TOKEN_MS +
    AI_JOB_STEP_OVERHEAD_MS +
    shape.ownReadsMs
  )
}

function worstCaseMs(shape: Shape, tier: AiCatalogEntry['tier'], maxTokens: number): number {
  return fixedMs(shape) + shape.attempts * aiJobAssumedAnswerMs(maxTokens, tier)
}

function maxTokensWithin(shape: Shape, tier: AiCatalogEntry['tier'], budgetMs: number, cap: number): number {
  const perAnswerMs = Math.floor((budgetMs - fixedMs(shape)) / shape.attempts)
  if (perAnswerMs <= 0) return 0
  return Math.min(cap, Math.floor((perAnswerMs * AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND[tier]) / 1_000))
}

/**
 * The longest one generation can take at the assumed rates: every model call
 * it may make — its lookup rounds, its answer and its re-ask — each waiting
 * for its first token, and the allowance they share answered in full.
 */
export function aiGenerationWorstCaseMs(input: AiGenerationTimeInput & { maxTokens: number }): number {
  return worstCaseMs(shapeOf(input), aiJobBudgetTier(input.model), input.maxTokens)
}

/**
 * The same worst case for any model of a tier: what a step registers as its
 * least time from the tier its step kind is served from, before a job has
 * resolved a model.
 */
export function aiGenerationWorstCaseOnTierMs(
  input: AiGenerationShape & { tier: AiCatalogEntry['tier']; maxTokens: number },
): number {
  return worstCaseMs(shapeOf(input), input.tier, input.maxTokens)
}

/**
 * The largest answer ceiling whose worst case fits `budgetMs` on this model,
 * and never more than `cap`. Zero when not even an empty answer fits.
 */
export function aiGenerationMaxTokensWithin(
  input: AiGenerationTimeInput & { budgetMs: number; cap: number },
): number {
  return maxTokensWithin(shapeOf(input), aiJobBudgetTier(input.model), input.budgetMs, input.cap)
}

/** A generation step's time budget: the least time it registers, and the ceiling it asks on each model. */
export interface AiJobStepBudget {
  /**
   * The step's worst case on the tier its step kind is served from, at the
   * largest ceiling that tier may ask — never more than
   * `AI_JOB_STEP_MAX_MINIMUM_MS`.
   */
  minimumMs: number
  /** The ceiling one answer asks on this model: the most whose worst case fits `minimumMs`. */
  maxTokens(model: string): number
}

/**
 * The budget of a step that generates once a run (AGL-3035, AGL-3036), from
 * the routing table's ceiling on the tier the step kind is served from.
 *
 * Where that worst case fits what a beat can give a step, it is the minimum,
 * and the served tier asks the whole ceiling. Where it does not, the served
 * tier asks the largest ceiling that fits, and the minimum is that ceiling's
 * worst case. A slower tier asks less, so its worst case fits the same
 * minimum; a faster one asks up to `cap` — the ceiling unless the step names a
 * higher one — that the minimum still holds.
 */
export function aiJobStepBudget(
  input: AiGenerationShape & { tier: AiCatalogEntry['tier']; maxTokens: number; cap?: number },
): AiJobStepBudget {
  const shape = shapeOf(input)
  const cap = Math.max(input.maxTokens, input.cap ?? input.maxTokens)
  const served = Math.min(
    input.maxTokens,
    maxTokensWithin(shape, input.tier, AI_JOB_STEP_MAX_MINIMUM_MS, input.maxTokens),
  )
  const minimumMs = worstCaseMs(shape, input.tier, served)
  return {
    minimumMs,
    maxTokens: (model) => maxTokensWithin(shape, aiJobBudgetTier(model), minimumMs, cap),
  }
}
