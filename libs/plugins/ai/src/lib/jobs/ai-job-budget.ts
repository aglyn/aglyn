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
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-doctrine'

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
 * its worst case — every attempt answered at its ceiling — fits inside that.
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

/** The tier a model is planned at: its catalog tier, else the slowest. */
export function aiJobBudgetTier(model: string): AiCatalogEntry['tier'] {
  return aiCatalogEntry(model)?.tier ?? 'deep'
}

export interface AiGenerationTimeInput {
  /** The model the step resolved: its tier decides the assumed rate. */
  model: string
  /** Answers one generation may make: the first, and its re-ask. */
  attempts?: number
}

/** The longest one generation can take at the assumed rates, with every attempt at its ceiling. */
export function aiGenerationWorstCaseMs(input: AiGenerationTimeInput & { maxTokens: number }): number {
  const attempts = input.attempts ?? AI_GENERATION_MAX_ATTEMPTS
  const rate = AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND[aiJobBudgetTier(input.model)]
  const answerMs = Math.ceil((input.maxTokens / rate) * 1_000)
  return attempts * (AI_JOB_ASSUMED_FIRST_TOKEN_MS + answerMs) + AI_JOB_STEP_OVERHEAD_MS
}

/**
 * The largest answer ceiling whose worst case fits `budgetMs` on this model,
 * and never more than `cap`. Zero when not even an empty answer fits.
 */
export function aiGenerationMaxTokensWithin(
  input: AiGenerationTimeInput & { budgetMs: number; cap: number },
): number {
  const attempts = input.attempts ?? AI_GENERATION_MAX_ATTEMPTS
  const rate = AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND[aiJobBudgetTier(input.model)]
  const perAnswerMs = (input.budgetMs - AI_JOB_STEP_OVERHEAD_MS) / attempts - AI_JOB_ASSUMED_FIRST_TOKEN_MS
  if (perAnswerMs <= 0) return 0
  return Math.min(input.cap, Math.floor((perAnswerMs / 1_000) * rate))
}
