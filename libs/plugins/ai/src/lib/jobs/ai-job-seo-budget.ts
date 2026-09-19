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
import { aiGenerationMaxTokensWithin, aiJobStepBudget } from './ai-job-budget'

/**
 * The time an SEO step needs (AGL-3035), kept apart from the step: the machine
 * registers the SEO step as it loads and defers the step itself to the first
 * SEO job, so what it registers must be readable without loading the page
 * readers, the audit and the doctrine behind the step.
 */

/**
 * Output budgets. A batch's largest answer — every page with a title,
 * description, heading and image descriptions at their limits — and the site
 * proposal's are measured in `ai-job-seo-step.spec.ts`.
 */
export const AI_SEO_FIXES_MAX_TOKENS = 4_000
export const AI_SEO_SITE_MAX_TOKENS = 1_500

/**
 * ASSUMED: how long an audit reads the site before it asks anything — every
 * published page's version, up to 150 of them ten at a time, with the site's
 * screens and shared layouts. The first pass reads it and then runs a unit of
 * generated work, so the read is part of a pass's time.
 */
export const AI_SEO_AUDIT_READS_MS = 10_000

/**
 * The SEO step's time: whichever generation a run makes — a listing, an
 * audit's site-wide proposal or a batch of its fixes, the largest of whose
 * ceilings decides — answered and re-asked on the tier `job.seo` is served
 * from, after the audit's read of the site. Each is written from the pages'
 * own text with no site inventory, so no run makes a lookup round.
 */
export const AI_JOB_SEO_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.seo'],
  maxTokens: Math.max(AI_ROUTING_TABLE['job.seo'].maxTokens, AI_SEO_SITE_MAX_TOKENS, AI_SEO_FIXES_MAX_TOKENS),
  lookups: 0,
  ownReadsMs: AI_SEO_AUDIT_READS_MS,
})

/** The least time one SEO pass needs before it starts. */
export const AI_JOB_SEO_STEP_MINIMUM_MS = AI_JOB_SEO_STEP_BUDGET.minimumMs

/**
 * One SEO generation's ceiling on the model a job runs: the most of `cap`
 * whose worst case fits the least time the step registers, so a slower tier
 * asks a batch of fixes for less rather than outrun the pass.
 */
export function aiSeoGenerationMaxTokens(model: string, cap: number): number {
  return aiGenerationMaxTokensWithin({
    budgetMs: AI_JOB_SEO_STEP_MINIMUM_MS,
    model,
    cap,
    lookups: 0,
    ownReadsMs: AI_SEO_AUDIT_READS_MS,
  })
}
