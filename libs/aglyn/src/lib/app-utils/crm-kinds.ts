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

/**
 * The CRM's fixed vocabularies — lifecycle stages, task kinds, activity
 * kinds — and the guards that check a value against them.
 *
 * A leaf module with no imports, re-exported by `crm.ts`, so every existing
 * `crm` import keeps working. It is separate because the actions builder
 * validates an automation step against these lists, and the actions builder
 * ships with the element renderer to every published page: importing them
 * from `crm.ts` put the whole CRM record model — companies, deals, tasks,
 * the contact facet helpers it reads — in front of every visitor to check a
 * string against a four-item list.
 *
 * Only the lists, their types, their guards and the task horizon live here.
 * The on-screen labels stay in `crm.ts`, beside the records they describe.
 */

/**
 * Where a person sits in the relationship, as one of a fixed list.
 *
 * A fixed list rather than free text so that a report can count people per
 * stage and a filter can select one, and in the order a person usually moves
 * through them so a picker reads as a progression. `other` is the escape
 * hatch for a business whose funnel has a step none of these name; it is a
 * deliberate stage, not an absent one.
 */
export const CONTACT_LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'marketing-qualified',
  'sales-qualified',
  'opportunity',
  'customer',
  'evangelist',
  'other',
] as const

export type ContactLifecycleStage = (typeof CONTACT_LIFECYCLE_STAGES)[number]

export function isContactLifecycleStage(
  value: unknown,
): value is ContactLifecycleStage {
  return (
    typeof value === 'string' &&
    (CONTACT_LIFECYCLE_STAGES as readonly string[]).includes(value)
  )
}

/**
 * What a task is, as a fixed list.
 *
 * A const array rather than a bare union because two surfaces have to
 * enumerate it — the task form's picker and the automation step that creates
 * a task without a form — and a union cannot be iterated at run time.
 */
export const CRM_TASK_KINDS = ['call', 'email', 'meeting', 'todo'] as const
export type CrmTaskKind = (typeof CRM_TASK_KINDS)[number]

export function isCrmTaskKind(value: unknown): value is CrmTaskKind {
  return (
    typeof value === 'string' &&
    (CRM_TASK_KINDS as readonly string[]).includes(value)
  )
}

/**
 * How far ahead an automation may date a task, in days.
 *
 * A year, because the longest follow-up anybody schedules from a trigger is
 * an annual renewal check, and a task dated further out than that is one
 * nobody will find on the list when it comes due.
 */
export const CRM_TASK_MAX_DUE_DAYS = 365

/**
 * What a person can log, in the order the picker offers them (AGL-2600).
 *
 * A fixed list rather than free text for the reason the lifecycle stages are
 * one: a report counts calls per week and a filter selects meetings, and
 * neither can be done over a string somebody typed. `note` is the plain
 * entry — something worth writing down that was not a conversation — and
 * `other` the escape hatch for the kind none of these name.
 */
export const CRM_ACTIVITY_KINDS = ['call', 'email', 'meeting', 'note', 'other'] as const

export type CrmActivityKind = (typeof CRM_ACTIVITY_KINDS)[number]

export function isCrmActivityKind(value: unknown): value is CrmActivityKind {
  return (
    typeof value === 'string' &&
    (CRM_ACTIVITY_KINDS as readonly string[]).includes(value)
  )
}
