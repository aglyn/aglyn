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

import type { AiBuildPlan, AiBuildPlanCreate, AiBuildPlanCreateKind } from './ai-build-plan'
import type { AiJobKind } from './ai-jobs.types'

/**
 * What a job that builds ONE record builds of the rest of its plan
 * (AGL-3143 §15): a template, a layout, a component, a form or an email
 * design.
 *
 * Each of those steps builds the first creation of its own kind and nothing
 * else, so a plan that also created something left it unbuilt and the job
 * still reported `Done`. Measured live on 2026-10-01 (job `2xD9Y7NayF`): a
 * template plan the member confirmed read "Creates the component
 * related-article-card", and no such component was ever made.
 *
 * Such a job now builds the other creations the way a page job does
 * (AGL-3031): each before its own record, one a pass, by the step that builds
 * that kind, and then its own record against what was built. It builds only
 * what its own record can PLACE — a component instance or a saved form, on
 * the trees that admit one — because a creation nothing places is the same
 * broken promise one step later. A form's tree and an email's place neither,
 * so those two build only their own. The plan step is told this list before it
 * answers, and the plan rules refuse a creation outside it with the one
 * re-ask every rule gets.
 *
 * Model only: this module imports nothing at runtime, so the plan step, the
 * doors, the estimate and the proposal read one list.
 */
export const AI_JOB_CREATE_KINDS: Readonly<Partial<Record<AiJobKind, readonly AiBuildPlanCreateKind[]>>> = {
  template: ['template', 'form', 'component'],
  layout: ['layout', 'form', 'component'],
  component: ['component', 'form'],
  form: ['form'],
  email: ['email'],
}

/** A job of each of those kinds as a refusal names it: "a template job". */
export const AI_JOB_CREATE_NOUNS: Readonly<Partial<Record<AiJobKind, string>>> = {
  template: 'a template job',
  layout: 'a layout job',
  component: 'a component job',
  form: 'a form job',
  email: 'an email job',
}

/**
 * The creations a job of `kind` builds before its own record: every creation
 * the plan names that the kind builds, less the one the kind's step builds
 * itself — the first of the kind's own — in plan order. Empty for a kind that
 * builds only its own record.
 */
export function aiJobOtherCreations(
  kind: AiJobKind,
  plan: Pick<AiBuildPlan, 'create'>,
): Array<{ creation: AiBuildPlanCreate; index: number }> {
  const creates = AI_JOB_CREATE_KINDS[kind]
  if (!creates) return []
  const own = plan.create.findIndex((entry) => entry.kind === kind)
  return plan.create.flatMap((creation, index) =>
    index !== own && creates.includes(creation.kind) ? [{ creation, index }] : [],
  )
}
