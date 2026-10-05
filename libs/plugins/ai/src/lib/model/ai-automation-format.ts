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

import type {
  ContactLifecycleStage,
  CrmActivityDirection,
  CrmActivityKind,
  CrmTaskKind,
  CrmTaskPriority,
} from '@aglyn/aglyn/app-utils/crm'
import {
  type ClientInteractionStep,
  type InteractionStepGuard,
  interactionStepHolds,
  type InteractionStepHolds,
  interactionStepLabel,
  type SiteInteraction,
} from '@aglyn/aglyn/app-utils/site-interactions'

/**
 * THE AUTOMATION FORMAT, AS THIS PLUGIN DRAFTS AND READS IT (AGL-2919,
 * AGL-3080).
 *
 * An automation is a site interaction whose steps include the server's — the
 * stored document at `hosts/{hostId}/actions/{id}`. The automation editor is
 * the workflows plugin's, and this plugin never loads it. It drafts in the
 * terms every plugin can read:
 *
 *  - WHAT A STEP IS CALLED, which step HOLDS a run and for how long, and the
 *    field a hold that ran out of time leaves in scope, are each step's
 *    declaration (`interactionSteps` in `plugins.config.json`), compiled into
 *    core and read here through `site-interactions`;
 *  - WHAT IT HANDS OVER is written through the `automation` resource's draft
 *    writer (`plugin-resource-drafts`), which the workflows plugin registers
 *    and which refuses anything its editor would not save;
 *  - WHAT IT GRADES a drafted automation against is the platform's validator
 *    with every step check the owners registered (`interaction-step-checks`).
 *
 * The shapes below are the steps this plugin drafts and explains, as the
 * stored document holds them: its own reading of the format, typed so a
 * drafted step cannot miss a field it means to write. The writer is the judge
 * of the document. In this plugin's specs no editor registers its checks, so a
 * draft is graded by the platform's checks and this plugin's own reader;
 * `apps/console/specs/ai-automation-drafting.spec.ts` boots both plugins and
 * holds every server step named, checked and held as drafted here.
 */

/** A server step, as this plugin writes and reads it. */
export type AiAutomationServerStep = (
  | { type: 'runWorkflow'; workflowId?: string; workflowName?: string }
  | { type: 'customEvent'; eventName: string }
  | { type: 'datasetAppend'; datasetId?: string; datasetName?: string }
  | { type: 'updateDataset'; datasetId?: string; datasetName?: string }
  | { type: 'webhookPost'; webhookId?: string; webhookName?: string }
  | { type: 'sendEmail'; subject: string; body: string; toField?: string; topicId?: string }
  | { type: 'notifyAdmins'; title: string; body?: string }
  | { type: 'enrollList'; listId?: string; listName?: string }
  | { type: 'assignCampaign'; campaignId?: string; campaignName?: string }
  | { type: 'wait'; delayMinutes: number }
  | { type: 'waitForEvent'; eventName: string; timeoutMinutes: number }
  | { type: 'exitFlow' }
  | { type: 'setContactStage'; lifecycleStage: ContactLifecycleStage }
  | { type: 'addContactTag'; tag: string }
  | { type: 'assignContactOwner'; ownerUid?: string; ownerEmail?: string; roundRobin?: boolean }
  | {
      type: 'createCrmTask'
      title: string
      kind: CrmTaskKind
      /** By meaning; the runner stores the org's label (AGL-3538). */
      priority?: CrmTaskPriority
      dueInDays: number
      assigneeUid?: string
      assigneeEmail?: string
    }
  | {
      type: 'logCrmActivity'
      kind: CrmActivityKind
      body: string
      /** Which way a call or an email went (AGL-3538). */
      direction?: CrmActivityDirection
    }
) & {
  when?: InteractionStepGuard | null
}

/** Any step of an automation: a platform client step, or a server step. */
export type AiAutomationStep = ClientInteractionStep | AiAutomationServerStep

/** A step type of the format. */
export type AiAutomationFormatStepType = AiAutomationStep['type']

/** An automation, as the stored document holds it. */
export type AiAutomation = SiteInteraction<AiAutomationStep>

/** How a step type reads in a sentence: its declared label, or its raw type. */
export function aiStepLabel(type: string): string {
  return interactionStepLabel(type) ?? type
}

/** The hold a step declares; a step this plugin drafts as a hold must declare one. */
function declaredHolds(type: string): InteractionStepHolds {
  const holds = interactionStepHolds(type)
  if (!holds) throw new Error(`the "${type}" step declares no hold, and the automation drafter writes it as one`)
  return holds
}

/** The whole minutes a `wait` or a `waitForEvent` may hold, as their declarations give them. */
export const AI_AUTOMATION_WAIT_MINUTES: Readonly<{ min: number; max: number }> = (() => {
  const wait = declaredHolds('wait')
  return { min: wait.minMinutes, max: wait.maxMinutes }
})()

/**
 * The field a `waitForEvent` that ran out of time leaves in scope, which a
 * later step's guard names to take the timeout branch.
 */
export const AI_AUTOMATION_TIMED_OUT_FIELD: string = (() => {
  const field = declaredHolds('waitForEvent').timeoutField
  if (!field) throw new Error('the "waitForEvent" step declares no timeout field')
  return field
})()
