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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import type { AiBuildPlan, AiBuildPlanCreateKind } from '../model/ai-build-plan'
import type { AiJob, AiJobDraftSlot, AiJobKind } from '../model/ai-jobs.types'

/**
 * The ids a job's drafts are written under (AGL-3079).
 *
 * A draft a job writes is the resource a member would otherwise have made in
 * the console, so it is named the way the console names one: by
 * `createResourceUid()`. Each id is minted ONCE and recorded on the job before
 * the draft is written. That record is what lets a step run again safely: a
 * run cut off after its write reads the same id, finds the draft, and reports
 * it rather than writing a second.
 *
 * Where an id is recorded follows what decides the draft exists:
 *
 *  - A draft the job's KIND always writes — a layout job's layout, a page
 *    job's screen, a campaign's design and campaign — is minted when the job
 *    is created, on the step that writes it (`AiJobStep.draftIds`).
 *  - A draft the PLAN decides — what a page job's plan creates, a scaffold's
 *    layout, form and pages — is minted when the plan is kept, on the plan's
 *    own entry (`AiBuildPlanCreate.id`, `AiBuildPlanScreen.id`). Those are
 *    built one unit a pass by the step that owns their kind, under a job named
 *    by the entry's id (`aiSiteUnitJob`).
 *
 * A job whose step records no id names its draft by the job's own id, which
 * is the id every draft of such a job was written under.
 */

/** The drafts each kind's step writes of its own, whatever its plan says. */
export const AI_JOB_DRAFT_SLOTS: Readonly<Partial<Record<AiJobKind, readonly AiJobDraftSlot[]>>> = {
  page: ['screen'],
  layout: ['layout'],
  template: ['template'],
  form: ['form'],
  component: ['component'],
  email: ['email'],
  campaign: ['email', 'campaign'],
  workflow: ['workflow'],
  // The welcome email a scaffold builds; its pages and creations are its plan's.
  site: ['email'],
}

/** Fresh ids for the drafts a job of this kind writes of its own; `null` for a kind that writes none. */
export function aiMintJobDraftIds(kind: AiJobKind): Partial<Record<AiJobDraftSlot, string>> | null {
  const slots = AI_JOB_DRAFT_SLOTS[kind]
  if (!slots?.length) return null
  return Object.fromEntries(slots.map((slot) => [slot, createResourceUid()]))
}

/** The id recorded on the job's steps for its draft of `slot`; `null` where none is. */
export function aiRecordedJobDraftId(job: Pick<AiJob, 'steps'>, slot: AiJobDraftSlot): string | null {
  for (const step of job.steps ?? []) {
    const id = step.draftIds?.[slot]
    if (typeof id === 'string' && id) return id
  }
  return null
}

/**
 * The id the job writes its draft of `slot` under, and finds it by when the
 * step runs again: the id recorded on its step, else the job's own id — which
 * names a unit's job by its plan entry's id, and a job whose step records none.
 */
export function aiJobDraftId(job: Pick<AiJob, '$id' | 'steps'>, slot: AiJobDraftSlot): string {
  return aiRecordedJobDraftId(job, slot) ?? job.$id
}

/** The creations a job writes as documents: a theme change is a proposal, and no job writes a dataset. */
const DRAFT_CREATION_KINDS: ReadonlySet<AiBuildPlanCreateKind> = new Set<AiBuildPlanCreateKind>([
  'component',
  'form',
  'layout',
  'template',
  'email',
])

/** The kinds whose step builds what their plan names, one unit a draft, and whether that includes its screens. */
const UNIT_PLAN_KINDS: Readonly<Partial<Record<AiJobKind, { screens: boolean }>>> = {
  // A page job's own screen is its kind's draft; its plan's creations are units.
  page: { screens: false },
  site: { screens: true },
}

/**
 * The plan as a job of `kind` keeps it: for a kind that builds what its plan
 * names, a fresh id on every creation it writes as a document and, for a
 * scaffold, on every screen. An id the plan already carried is replaced —
 * a plan reused from another job names that job's drafts — so the drafts
 * this job builds are its own. Any other kind's plan is kept as it is.
 */
export function aiPlanWithDraftIds<T extends AiBuildPlan>(kind: AiJobKind, plan: T): T {
  const units = UNIT_PLAN_KINDS[kind]
  if (!units) return plan
  return {
    ...plan,
    create: plan.create.map((entry) =>
      DRAFT_CREATION_KINDS.has(entry.kind) ? { ...entry, id: createResourceUid() } : entry,
    ),
    screens: units.screens ? plan.screens.map((screen) => ({ ...screen, id: createResourceUid() })) : plan.screens,
  }
}
