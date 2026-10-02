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
 * The check of a step the platform does not know (AGL-3080): the plugin that
 * holds it registers it, and a plugin that writes an interaction it does not
 * edit asks for every check at once.
 */

import type { InteractionStepBase, SiteInteraction } from '../app-utils/site-interactions'
import {
  registeredInteractionStepCheck,
  registerInteractionStepChecks,
  resetInteractionStepChecksForTests,
  validateStoredInteraction,
} from './interaction-step-checks'

const bake = (loaves: string): SiteInteraction<InteractionStepBase> => ({
  name: 'Bake on order',
  trigger: { event: 'formSubmission' },
  steps: [{ type: 'specBake', loaves }],
})

const loavesCheck = (step: InteractionStepBase, label: string) =>
  String(step['loaves'] ?? '').trim() ? null : `${label}: say how many loaves`

afterEach(() => resetInteractionStepChecksForTests())

describe('registerInteractionStepChecks', () => {
  it('THE CONTROL: with no check registered, the platform alone judges the step', () => {
    expect(validateStoredInteraction(bake(''))).toBeNull()
  })

  it('refuses what the registered check refuses, in its words', () => {
    registerInteractionStepChecks(['specBake'], loavesCheck, { pluginId: 'bakery' })
    expect(validateStoredInteraction(bake(''))).toBe('Step 1: say how many loaves')
    expect(validateStoredInteraction(bake('3'))).toBeNull()
    expect(registeredInteractionStepCheck('specBake')?.pluginId).toBe('bakery')
  })

  it('still runs the platform’s own checks first', () => {
    registerInteractionStepChecks(['specBake'], loavesCheck, { pluginId: 'bakery' })
    expect(validateStoredInteraction({ ...bake('3'), name: ' ' })).toBe('Name the action')
  })

  it('refuses a registration with no owner, a type that is not plain, and none at all', () => {
    expect(() => registerInteractionStepChecks(['specBake'], loavesCheck)).toThrow(/no owner/)
    expect(() => registerInteractionStepChecks(['spec bake'], loavesCheck, { pluginId: 'bakery' })).toThrow(
      /not a plain step type/,
    )
    expect(() => registerInteractionStepChecks([], loavesCheck, { pluginId: 'bakery' })).toThrow(/no step type/)
  })

  it('refuses a type another plugin’s check holds, and registers nothing of the refused list', () => {
    registerInteractionStepChecks(['specBake'], loavesCheck, { pluginId: 'bakery' })
    expect(() =>
      registerInteractionStepChecks(['specSlice', 'specBake'], () => 'no', { pluginId: 'deli' }),
    ).toThrow(/already checked by "bakery"/)
    expect(registeredInteractionStepCheck('specSlice')).toBeNull()
    expect(registeredInteractionStepCheck('specBake')?.pluginId).toBe('bakery')
  })

  it('lets the same plugin register again, and its unregister removes only what it still holds', () => {
    const first = registerInteractionStepChecks(['specBake'], loavesCheck, { pluginId: 'bakery' })
    registerInteractionStepChecks(['specBake'], () => null, { pluginId: 'bakery' })
    first()
    expect(registeredInteractionStepCheck('specBake')).not.toBeNull()
    expect(validateStoredInteraction(bake(''))).toBeNull()
  })
})
