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

import {
  registerServerStepExecutor,
  type ServerStepRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { FieldValue } from 'firebase-admin/firestore'

/** The contact an event names, as the spec's own Firestore double holds it. */
export interface CrmContactDouble {
  id: string
  update(patch: Record<string, unknown>): Promise<unknown>
}

/** Where the stand-in finds the person and which site facet it writes. */
export interface CrmStepsDouble {
  /** The contact the event names, or `null` for nobody the site can see. */
  contact(request: ServerStepRequest): Promise<CrmContactDouble | null>
  /** The consent group whose facet the site writes. */
  groupId: string
}

/** The step types the CRM declares under `serverSteps`. */
export const STAND_IN_CRM_STEP_TYPES = [
  'setContactStage',
  'addContactTag',
  'assignContactOwner',
  'createCrmTask',
  'logCrmActivity',
] as const

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * The CRM steps the CRM runs for this engine (AGL-3080), stood in for this
 * plugin's specs — this plugin may not load the CRM. Over the spec's own
 * Firestore double it does what the owner's executor does for the shapes these
 * specs store: it finds the contact the event names, writes a stage or a tag
 * inside the site's facet, answers the run history's detail, and answers a
 * stage that moved as the `contactStageChanged` event for the engine to raise.
 * An owner, a task and an activity are answered by their detail alone.
 *
 * Owners, tasks, scopes, the plan gate and the activity ceiling are the CRM's
 * own spec's (`automation-steps.spec.ts`), and the real pair runs together in
 * `apps/console/specs/crm-automation-steps.spec.ts`.
 */
export function standInCrmSteps(double: CrmStepsDouble): () => void {
  return registerServerStepExecutor(
    STAND_IN_CRM_STEP_TYPES,
    async (request) => {
      const step = request.step as Record<string, unknown> & { type: string }
      const contact = await double.contact(request)
      if (!contact) {
        const named = String(request.payload['contactId'] ?? request.payload['email'] ?? '')
        return { error: `no contact or lead this site can see for ${named}` }
      }
      const facet = (field: string) => `facets.${double.groupId}.${field}`
      if (step.type === 'setContactStage') {
        const stage = String(step['lifecycleStage'] ?? '')
        await contact.update({
          [facet('lifecycleStage')]: stage,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return {
          detail: capitalized(stage),
          emit: {
            event: 'contactStageChanged',
            payload: { contactId: contact.id, lifecycleStage: stage },
          },
        }
      }
      if (step.type === 'addContactTag') {
        const tag = String(step['tag'] ?? '').trim()
        await contact.update({
          [facet('tags')]: FieldValue.arrayUnion(tag),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { detail: tag }
      }
      if (step.type === 'assignContactOwner') {
        return { detail: step['roundRobin'] === true ? 'round robin' : String(step['ownerEmail'] ?? step['ownerUid'] ?? '') }
      }
      if (step.type === 'createCrmTask') return { detail: String(step['title'] ?? '').slice(0, 60) }
      return { detail: String(step['kind'] ?? '') }
    },
    { pluginId: 'crm' },
  )
}
