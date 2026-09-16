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

import type { HostActionStepType } from '@aglyn/aglyn/app-utils/actions'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  HOST_EVENT_LABELS,
  HOST_EVENT_TYPES,
  type HostEventType,
} from '@aglyn/aglyn/app-utils/workflows'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'

/**
 * A `workflow` job (AGL-2919): an automation drafted from a description, or an
 * existing automation explained — what it does, or why one of its runs failed.
 *
 * One kind, three modes, because the three share everything a job carries:
 * the site, the gates, the meter and the automation vocabulary. `inputs.mode`
 * picks the mode, and a job created without one drafts.
 *
 *  - `draft` writes a new automation to the site's Actions through the
 *    workflows plugin's draft writer, OFF, built only from the triggers and
 *    steps below that this workspace can run. What the description names that
 *    the site does not have is left as a placeholder, never guessed.
 *  - `explain` reads a saved automation — an action or a workflow — and
 *    answers in plain words what it does.
 *  - `diagnose` reads a saved automation and one of its FAILED runs, as the
 *    run history recorded it, and answers why it failed and what to change.
 *
 * Nothing in any mode switches an automation on, runs one, or changes one.
 */

export const AI_WORKFLOW_JOB_MODES = ['draft', 'explain', 'diagnose'] as const
export type AiWorkflowJobMode = (typeof AI_WORKFLOW_JOB_MODES)[number]

/** What an explained automation is: an action, or a workflow of function calls. */
export const AI_WORKFLOW_TARGET_TYPES = ['action', 'workflow'] as const
export type AiWorkflowTargetType = (typeof AI_WORKFLOW_TARGET_TYPES)[number]

export type AiWorkflowJobInputs =
  | { mode: 'draft' }
  | { mode: 'explain'; targetType: AiWorkflowTargetType; targetId: string }
  | { mode: 'diagnose'; targetType: AiWorkflowTargetType; targetId: string; runId: string }

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A job's inputs read into its mode, or the sentence that says what is wrong with them. */
export function parseAiWorkflowJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiWorkflowJobInputs | string {
  const mode = inputs?.['mode'] ?? 'draft'
  if (!(AI_WORKFLOW_JOB_MODES as readonly unknown[]).includes(mode)) {
    return 'inputs.mode must be draft, explain or diagnose'
  }
  if (mode === 'draft') return { mode }
  const targetType = inputs?.['targetType']
  const targetId = inputs?.['targetId']
  if (
    !(AI_WORKFLOW_TARGET_TYPES as readonly unknown[]).includes(targetType) ||
    typeof targetId !== 'string' ||
    !DOCUMENT_ID.test(targetId)
  ) {
    return 'Pick the automation to explain'
  }
  const target = { targetType: targetType as AiWorkflowTargetType, targetId }
  if (mode === 'explain') return { mode, ...target }
  const runId = inputs?.['runId']
  if (typeof runId !== 'string' || !DOCUMENT_ID.test(runId)) return 'Pick the run to explain'
  return { mode: 'diagnose', ...target, runId }
}

// ── What a workspace can run ──────────────────────────────────────────────

/** A part of the platform some triggers and steps need beyond the actions builder itself. */
export type AiAutomationNeed = 'crm' | 'webhooks' | 'bookings'

export type AiAutomationCapabilities = Readonly<Record<AiAutomationNeed, boolean>>

/** Each need as a sentence names it. */
export const AI_AUTOMATION_NEED_LABELS: Readonly<Record<AiAutomationNeed, string>> = {
  crm: 'the CRM',
  webhooks: 'webhooks',
  bookings: 'bookings',
}

/**
 * What this workspace can run, from the entitlements the executor itself
 * reads before it runs a step: `crm` for the CRM steps, `webhooks` for a
 * webhook post, and `bookings` for the booking trigger's door.
 */
export function aiAutomationCapabilities(
  org: Partial<AglynOrgBilling> | Readonly<Record<string, unknown>> | null | undefined,
): AiAutomationCapabilities {
  const billing = org as Partial<AglynOrgBilling> | null | undefined
  return {
    crm: checkEntitlement(billing, 'crm'),
    webhooks: checkEntitlement(billing, 'webhooks'),
    bookings: checkEntitlement(billing, 'bookings'),
  }
}

// ── The vocabulary ────────────────────────────────────────────────────────

/**
 * The triggers a drafted automation may start on: every host event, which is
 * every event a server door emits. The on-page events (a click, a scroll) are
 * left out: they watch one element of one page, which a description cannot
 * name, and they belong to the page's own interactions.
 */
export const AI_AUTOMATION_TRIGGERS: readonly HostEventType[] = HOST_EVENT_TYPES

/** The triggers only a door of a part of the platform emits. */
export const AI_AUTOMATION_TRIGGER_NEEDS: Readonly<Partial<Record<HostEventType, AiAutomationNeed>>> = {
  booking: 'bookings',
  taskCompleted: 'crm',
  contactStageChanged: 'crm',
  dealStageChanged: 'crm',
  dealWon: 'crm',
  dealLost: 'crm',
}

/**
 * The steps a drafted automation may take: the server steps and the flow
 * steps, which act on the person an event names. The on-page steps — show an
 * element, open a menu, run a script — are left out for the reason the
 * on-page triggers are: they need a selector on a page a description cannot
 * name.
 */
export const AI_AUTOMATION_STEP_TYPES = [
  'sendEmail',
  'notifyAdmins',
  'enrollList',
  'assignCampaign',
  'runWorkflow',
  'datasetAppend',
  'updateDataset',
  'webhookPost',
  'siteAlert',
  'wait',
  'waitForEvent',
  'exitFlow',
  'setContactStage',
  'addContactTag',
  'assignContactOwner',
  'createCrmTask',
  'logCrmActivity',
] as const satisfies readonly HostActionStepType[]

export type AiAutomationStepType = (typeof AI_AUTOMATION_STEP_TYPES)[number]

/** The steps the executor refuses without a part of the platform. */
export const AI_AUTOMATION_STEP_NEEDS: Readonly<Partial<Record<AiAutomationStepType, AiAutomationNeed>>> = {
  webhookPost: 'webhooks',
  setContactStage: 'crm',
  addContactTag: 'crm',
  assignContactOwner: 'crm',
  createCrmTask: 'crm',
  logCrmActivity: 'crm',
}

/** The trigger's name as the Actions editor labels it. */
export function aiAutomationTriggerLabel(event: string): string {
  return HOST_EVENT_LABELS[event as HostEventType] ?? event
}

// ── A description the vocabulary cannot build ─────────────────────────────

/**
 * Why a description was answered with no automation. Each is a fixed reason
 * with a fixed sentence, so what a person reads is never the model's own
 * account of itself.
 */
export const AI_AUTOMATION_UNSUPPORTED = [
  'not-an-automation',
  'no-trigger',
  'no-step',
  'needs-crm',
  'needs-webhooks',
  'needs-bookings',
] as const

export type AiAutomationUnsupported = (typeof AI_AUTOMATION_UNSUPPORTED)[number]

/** The need an unsupported reason names, for the reasons that name one. */
export const AI_AUTOMATION_UNSUPPORTED_NEED: Readonly<
  Partial<Record<AiAutomationUnsupported, AiAutomationNeed>>
> = {
  'needs-crm': 'crm',
  'needs-webhooks': 'webhooks',
  'needs-bookings': 'bookings',
}

export const AI_AUTOMATION_UNSUPPORTED_COPY: Readonly<Record<AiAutomationUnsupported, string>> = {
  'not-an-automation':
    'This description is not an automation — something that happens, and what to do then — so nothing was drafted.',
  'no-trigger':
    'Nothing on the platform can start an automation like this one, so nothing was drafted. Describe it as something that happens on your site, such as a form being submitted.',
  'no-step': 'An automation cannot do what this description asks yet, so nothing was drafted.',
  'needs-crm':
    'This automation needs the CRM, which this workspace’s plan does not include, so nothing was drafted.',
  'needs-webhooks':
    'This automation needs webhooks, which this workspace’s plan does not include, so nothing was drafted.',
  'needs-bookings':
    'This automation needs bookings, which this workspace’s plan does not include, so nothing was drafted.',
}

// ── What a job tells a person ─────────────────────────────────────────────

/** The id the workflows plugin is registered under. */
export const AI_WORKFLOWS_PLUGIN_ID = 'workflows'

/** The resource the workflows plugin writes a drafted automation under. */
export const AI_AUTOMATION_RESOURCE = 'automation'

export const AI_WORKFLOW_NO_SITE_COPY = 'This automation job names a site this workspace does not have.'
export const AI_WORKFLOW_UNAVAILABLE_COPY = 'Automations are not available on this site.'
export const AI_WORKFLOW_GONE_COPY = 'That automation no longer exists.'
export const AI_WORKFLOW_RUN_GONE_COPY = 'That run is no longer in the automation’s history.'
export const AI_WORKFLOW_RUN_NOT_FAILED_COPY = 'That run did not fail, so there is nothing to explain.'
export const AI_WORKFLOW_NO_DRAFT_COPY =
  'The AI could not draft an automation from this description. Try describing what happens, and what should happen then.'
export const AI_WORKFLOW_NO_EXPLANATION_COPY =
  'The AI could not explain this automation. Try again.'
export const AI_WORKFLOW_SAVE_FAILURE_COPY =
  'The automation was drafted but could not be saved. Try the job again.'
