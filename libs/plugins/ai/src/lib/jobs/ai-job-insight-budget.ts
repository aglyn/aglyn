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

import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE } from '../providers/routing'
import { aiJobStepBudget } from './ai-job-budget'

/**
 * The time an insight step needs (AGL-2915, AGL-3035), declared apart from the
 * step so the machine and the specs read it without loading the readers.
 */

/**
 * The read call's ceiling: a few reads, each a reader id, a window and its
 * parameters. It is spent from the same allowance as the answer, so it adds a
 * wait for a first token and no output of its own to the worst case.
 */
export const AI_INSIGHT_READ_MAX_TOKENS = 400

/**
 * ASSUMED: how long the readers take between the two calls — up to four
 * tables, the heaviest a store's two windows of up to 1,000 orders each, or a
 * dataset's first 2,000 records.
 */
export const AI_INSIGHT_READS_MS = 8_000

/**
 * The step's time: the read call and the answer with its one re-ask, sharing
 * one allowance of twice the routing table's ceiling, on the tier `job.insight`
 * is served from, after the readers read. A digest makes no read call and
 * fits the same time.
 */
export const AI_JOB_INSIGHT_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.insight'],
  maxTokens: AI_ROUTING_TABLE['job.insight'].maxTokens,
  attempts: 2,
  lookups: 1,
  ownReadsMs: AI_INSIGHT_READS_MS,
})

/** The least time one insight step needs before it starts. */
export const AI_JOB_INSIGHT_STEP_MINIMUM_MS = AI_JOB_INSIGHT_STEP_BUDGET.minimumMs
