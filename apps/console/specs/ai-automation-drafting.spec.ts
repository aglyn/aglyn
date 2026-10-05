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

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  declaredInteractionSteps,
  type InteractionStepBase,
  interactionStepHolds,
  interactionStepLabel,
  isClientActionStep,
  type SiteInteraction,
} from '@aglyn/aglyn/app-utils/site-interactions'
import {
  registeredInteractionStepCheck,
  resetInteractionStepChecksForTests,
  validateStoredInteraction,
} from '@aglyn/aglyn/plugin-manager/interaction-step-checks'
import { resetInteractionRecipesForTests } from '@aglyn/aglyn/plugin-manager/interaction-recipes'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'

/**
 * AN AUTOMATION ANOTHER PLUGIN WRITES MEETS THE CHECKS OF THE EDITOR THAT
 * OWNS IT, IN THIS CONSOLE (AGL-3080).
 *
 * The automation editor is the workflows plugin's. The AI plugin drafts
 * automations and grades its drafts, and the CRM installs its recipes, without
 * loading it: they read each step's declared name and hold from the compiled
 * catalog, and they ask `validateStoredInteraction`, which runs the checks the
 * workflows plugin registers from its declarations. A check that never
 * registered would pass every step it was meant to refuse, without an error.
 * Each plugin's spec holds its own half; this one boots the console's
 * declarations the way the console does and holds the meeting:
 *
 *  1. no step has a check before the declarations run;
 *  2. every server step a stored automation may hold has a declared label and
 *     a registered check after they do;
 *  3. every step that holds a run declares the band a drafter writes in;
 *  4. the automation each AI eval case stores is one the editor's checks
 *     accept, and a faulty step in it is refused in the editor's words.
 *
 * ⚑ It runs THIS APP'S manifests and imports no plugin: an app may not depend
 * on one.
 */

const REPO_ROOT = join(__dirname, '../../..')
const CASES_DIR = join(REPO_ROOT, 'tools/ai-eval/cases/workflow')

/** Every automation a workflow eval case stores, by its file. */
const storedCases = (): Array<{ file: string; action: SiteInteraction<InteractionStepBase> }> =>
  readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      const raw = JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')) as {
        automation?: { action?: SiteInteraction<InteractionStepBase> }
      }
      return raw.automation?.action ? [{ file, action: raw.automation.action }] : []
    })

/** Every server step a plugin declares: a step that is not one of the platform's client steps. */
const serverSteps = () => declaredInteractionSteps().filter((step) => !isClientActionStep({ type: step.type }))

let checkedBeforeBoot: Array<string | null>

beforeAll(async () => {
  resetInteractionStepChecksForTests()
  resetInteractionRecipesForTests()
  checkedBeforeBoot = serverSteps().map((step) => registeredInteractionStepCheck(step.type)?.pluginId ?? null)
  await registerPluginDeclarations()
})

describe('an automation another plugin writes, in this console', () => {
  it('THE CONTROL: before the declarations run, no step has a check', () => {
    expect(serverSteps().length).toBeGreaterThan(0)
    expect(checkedBeforeBoot).toEqual(serverSteps().map(() => null))
  })

  it('names and checks every server step a stored automation may hold', () => {
    for (const step of serverSteps()) {
      expect({
        type: step.type,
        label: Boolean(interactionStepLabel(step.type)),
        checked: Boolean(registeredInteractionStepCheck(step.type)),
      }).toEqual({ type: step.type, label: true, checked: true })
    }
  })

  it('declares, for every step that holds a run, the band of minutes a drafter writes', () => {
    const holding = serverSteps().filter((step) => interactionStepHolds(step.type))
    expect(holding.length).toBeGreaterThan(0)
    for (const step of holding) {
      const holds = interactionStepHolds(step.type)!
      expect(holds.maxMinutes).toBeGreaterThan(holds.minMinutes)
    }
  })

  it('accepts the automation each eval case stores, and refuses one of its steps broken', () => {
    const cases = storedCases()
    expect(cases.length).toBeGreaterThan(0)
    for (const { file, action } of cases) {
      expect({ file, problem: validateStoredInteraction(action) }).toEqual({ file, problem: null })
      // A server step emptied of what it holds is refused by its owner's
      // check — the control that the acceptance above was a check at all.
      const at = action.steps.findIndex((step) => !isClientActionStep(step) && step.type !== 'exitFlow')
      const broken = { ...action, steps: action.steps.map((step, index) => (index === at ? { type: step.type } : step)) }
      expect(validateStoredInteraction(broken)).toMatch(new RegExp(`^Step ${at + 1}: `))
    }
  })
})
