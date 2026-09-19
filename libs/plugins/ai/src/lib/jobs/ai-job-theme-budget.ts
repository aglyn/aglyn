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
 * The time a theme step needs (AGL-3035), kept apart from the step: the
 * machine registers the theme step as it loads and defers the step itself to
 * the first theme job, so what it registers must be readable without loading
 * the theme editor's catalog and the brand reads behind the step.
 */

/**
 * The wall clock brand colors may take: the site logo's colors and a linked
 * page's, read before the model is asked. A proposal without a page's colors
 * is better than no proposal, so the reads stop at this bound rather than
 * spend the step's time.
 */
export const AI_THEME_BRAND_BUDGET_MS = 8_000

/**
 * The theme step's time: its answer and its re-ask at the routing table's
 * `job.theme` ceiling on the tier the step is served from — a theme builds
 * from the theme, carries no site inventory and so makes no lookup — with the
 * brand reads and the step's own reads and writes.
 */
export const AI_JOB_THEME_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.theme'],
  maxTokens: AI_ROUTING_TABLE['job.theme'].maxTokens,
  lookups: 0,
  ownReadsMs: AI_THEME_BRAND_BUDGET_MS,
})

/** The least time one theme step needs before it starts. */
export const AI_JOB_THEME_STEP_MINIMUM_MS = AI_JOB_THEME_STEP_BUDGET.minimumMs
