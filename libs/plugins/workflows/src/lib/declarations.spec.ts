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
 * The editor's checks of the server steps, registered for the plugins that
 * write automations without loading this one (AGL-3080): what they ask is what
 * this editor answers.
 */

import {
  registeredInteractionStepCheck,
  resetInteractionStepChecksForTests,
  validateStoredInteraction,
} from '@aglyn/aglyn/plugin-manager/interaction-step-checks'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerWorkflowsDeclarations } from './declarations'
import { type HostAction, SERVER_ACTION_STEP_TYPES, validateHostAction } from './model/host-actions'

const withStep = (step: HostAction['steps'][number]): HostAction => ({
  name: 'One step',
  trigger: { event: 'formSubmission' },
  steps: [step],
})

/** One faulty step of each kind the checks refuse, and its sound twin. */
const CASES: Array<[HostAction['steps'][number], HostAction['steps'][number]]> = [
  [{ type: 'wait', delayMinutes: 0 }, { type: 'wait', delayMinutes: 60 }],
  [
    { type: 'waitForEvent', eventName: 'lead', timeoutMinutes: 0 },
    { type: 'waitForEvent', eventName: 'lead', timeoutMinutes: 60 },
  ],
  [{ type: 'sendEmail', subject: '', body: 'x' }, { type: 'sendEmail', subject: 'Hi', body: 'x' }],
  [{ type: 'datasetAppend' }, { type: 'datasetAppend', datasetName: 'Leads' }],
  [{ type: 'addContactTag', tag: 'x'.repeat(200) }, { type: 'addContactTag', tag: 'vip' }],
  [
    { type: 'assignContactOwner', roundRobin: true, ownerEmail: 'a@b.co' },
    { type: 'assignContactOwner', roundRobin: true },
  ],
]

beforeAll(() => {
  resetInteractionStepChecksForTests()
  registerWorkflowsDeclarations()
})

afterAll(() => resetInteractionStepChecksForTests())

describe('registerWorkflowsDeclarations', () => {
  it('registers this editor’s check of every server step', () => {
    for (const type of SERVER_ACTION_STEP_TYPES) {
      expect({ type, owner: registeredInteractionStepCheck(type)?.pluginId }).toEqual({ type, owner: BUNDLE_ID })
    }
  })

  it('answers another plugin’s question exactly as this editor’s own validator does', () => {
    for (const [faulty, sound] of CASES) {
      const refused = validateHostAction(withStep(faulty))
      expect(refused).not.toBeNull()
      expect(validateStoredInteraction(withStep(faulty))).toBe(refused)
      expect(validateStoredInteraction(withStep(sound))).toBeNull()
    }
  })
})
