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
  interactionStepLabel,
  interactionStepsForClient,
  isClientActionStep,
} from '@aglyn/aglyn/app-utils/site-interactions'
import {
  registeredInteractionStepCheck,
  resetInteractionStepChecksForTests,
  validateStoredInteraction,
} from '@aglyn/aglyn/plugin-manager/interaction-step-checks'
import {
  declaredInteractionRecipes,
  interactionRecipe,
  interactionRecipes,
  resetInteractionRecipesForTests,
} from '@aglyn/aglyn/plugin-manager/interaction-recipes'
import { pluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'

/**
 * THE RECIPES ONE PLUGIN WRITES REACH THE EDITOR ANOTHER DRAWS, IN THIS
 * CONSOLE (AGL-3080).
 *
 * The automation editor's Recipes menu lists whatever recipes the plugins
 * registered (`plugin-manager/interaction-recipes`), and a recipe that picks a
 * record lists the picker's options through the record kind's list source. A
 * recipe that never registered would vanish from the menu without an error,
 * and one whose automation the editor refused would open a draft nobody could
 * save. Each plugin's spec holds its own half; this one boots the console's
 * declarations the way the console does and holds the meeting:
 *
 *  1. every declared recipe is registered by the plugin that declares it, and
 *     none before the boot;
 *  2. each builds an automation every step's registered check accepts —
 *     picked where it picks — from steps a label names;
 *  3. a kind a recipe picks is one a plugin in this console lists;
 *  4. what a visitor's page receives of each stops at its first wait.
 *
 * ⚑ It runs THIS APP'S manifests and imports no plugin: an app may not depend
 * on one.
 */

const PICKED = { id: 'form-contact', name: 'Contact us' }

let registeredBeforeBoot: string[]

beforeAll(async () => {
  resetInteractionRecipesForTests()
  resetInteractionStepChecksForTests()
  resetPluginServicesForTests()
  registeredBeforeBoot = interactionRecipes().map((recipe) => recipe.id)
  await registerPluginDeclarations()
  // The kinds a recipe picks are listed by their owners' console registrars.
  const picked = new Set(interactionRecipes().flatMap((recipe) => (recipe.picks ? [recipe.picks.kind] : [])))
  for (const entry of CONSOLE_PLUGIN_MANIFEST) {
    const register = entry.register?.console
    if (!register) continue
    const loaded = (await entry.load()) as Record<string, () => void>
    loaded[String(register)]()
    if ([...picked].every((kind) => pluginRecordListSource(kind))) break
  }
})

/** Every registered recipe's automation, built with a pick where it picks. */
const built = () =>
  interactionRecipes().map((recipe) => ({
    recipe,
    action: recipe.build(recipe.picks ? { picked: PICKED } : undefined),
  }))

describe('the interaction recipes, in this console', () => {
  it('THE CONTROL: before the declarations run, no recipe is registered', () => {
    expect(registeredBeforeBoot).toEqual([])
  })

  it('registers every declared recipe through the plugin that declares it', () => {
    expect(declaredInteractionRecipes().length).toBeGreaterThan(0)
    for (const row of declaredInteractionRecipes()) {
      expect({ id: row.id, registered: Boolean(interactionRecipe(row.id)) }).toEqual({
        id: row.id,
        registered: true,
      })
    }
  })

  it('builds, from each, an automation every step’s registered check accepts, of steps a label names', () => {
    for (const { recipe, action } of built()) {
      expect({ id: recipe.id, problem: validateStoredInteraction(action) }).toEqual({
        id: recipe.id,
        problem: null,
      })
      for (const step of action.steps) {
        expect({ type: step.type, label: Boolean(interactionStepLabel(step.type)) }).toEqual({
          type: step.type,
          label: true,
        })
        // A server step is judged by the plugin that holds its check, which
        // the boot registered: the control that the acceptance above meant it.
        if (!isClientActionStep(step)) {
          expect(registeredInteractionStepCheck(step.type)).not.toBeNull()
        }
      }
    }
  })

  it('refuses a recipe that picks a record, built without its pick', () => {
    for (const recipe of interactionRecipes().filter((one) => one.picks)) {
      expect(validateStoredInteraction(recipe.build())).toMatch(/value/i)
    }
  })

  it('lists every kind a recipe picks through the plugin that keeps it', () => {
    for (const recipe of interactionRecipes().filter((one) => one.picks)) {
      const kind = recipe.picks?.kind ?? ''
      expect({ kind, listed: Boolean(pluginRecordListSource(kind)) }).toEqual({ kind, listed: true })
    }
  })

  it('hands a visitor’s page nothing past a recipe’s first wait', () => {
    for (const { action } of built()) {
      const waitAt = action.steps.findIndex((step) => step.type === 'wait' || step.type === 'waitForEvent')
      expect(interactionStepsForClient(action.steps)).toHaveLength(
        waitAt < 0 ? action.steps.length : waitAt,
      )
    }
  })
})
