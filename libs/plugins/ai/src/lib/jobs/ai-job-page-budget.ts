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
import { aiJobStepBudget } from './ai-job-budget'

/**
 * The time a page pass needs (AGL-2907, AGL-3036), declared apart from the
 * page step: the site scaffold builds its pages through that step, and reads
 * the time a page needs without loading the step it hands them to.
 */

/** The most one section's answer may run to on any model; slower tiers get less. */
export const AI_JOB_PAGE_SECTION_MAX_TOKENS = 2_000

/**
 * The ceiling a section's answer asks on the tier the page step is served
 * from (AGL-2907): fifteen elements at `AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT`
 * (AGL-3042), the size every golden section and a two-person introduction fit
 * (`ai-job-page-evals.spec.ts`) and a Free page's credits are counted at
 * (`ai-job-free-page.spec.ts`). A faster tier asks more in the same time, up
 * to `AI_JOB_PAGE_SECTION_MAX_TOKENS`, and a slower one less.
 *
 * A Free page fits its wall at this ceiling with little to spare, so the
 * ceiling does not move to make a section fit: past 1,073 tokens, the Free
 * page that builds its layout first leaves no more of the wall than its
 * largest pass spends, which is the room a re-asked section needs
 * (`ai-job-free-page.spec.ts`). A section that runs past it is asked for
 * smaller instead (AGL-3042).
 */
export const AI_JOB_PAGE_SECTION_TOKENS = 1_050

/**
 * A section pass's time (AGL-3036): its two inventory-lookup rounds, its
 * answer and its re-ask at `AI_JOB_PAGE_SECTION_TOKENS` on the served tier,
 * with the step's reads and writes, at the rates `ai-job-budget.ts` assumes.
 */
export const AI_JOB_PAGE_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.page'],
  maxTokens: AI_JOB_PAGE_SECTION_TOKENS,
  cap: AI_JOB_PAGE_SECTION_MAX_TOKENS,
})

/**
 * The least time one section pass needs before it starts. Registered with the
 * step, so neither the beat nor an inline door starts a pass that its budget
 * would cut off. A spec holds it inside the beat's own budget.
 */
export const AI_JOB_PAGE_STEP_MINIMUM_MS = AI_JOB_PAGE_STEP_BUDGET.minimumMs

/** The ceiling a section's answer asks on this model: the most whose worst case fits a pass. */
export function aiJobPageSectionMaxTokens(model: string): number {
  return AI_JOB_PAGE_STEP_BUDGET.maxTokens(model)
}

