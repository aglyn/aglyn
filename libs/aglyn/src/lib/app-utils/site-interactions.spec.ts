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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  registerInteractionRecipes,
  resetInteractionRecipesForTests,
} from '../plugin-manager/interaction-recipes'
import {
  CLIENT_ACTION_STEP_TYPES,
  CLIENT_INTERACTION_STEP_LABELS,
  declaredInteractionStep,
  declaredInteractionSteps,
  type InteractionStepDeclaration,
  interactionStepHolds,
  interactionStepLabel,
  interactionStepsForClient,
  interactionStepTypedFields,
  isClientActionStep,
  type SiteInteraction,
  type InteractionStepBase,
  validateInteraction,
} from './site-interactions'

/**
 * The platform's interaction vocabulary (AGL-3080): what an interaction is,
 * what the platform checks of one, and how a plugin's step joins it — by a
 * declaration compiled from `plugins.config.json`, never by core naming it.
 */

const REPO_ROOT = join(__dirname, '../../../../..')

const click = (steps: InteractionStepBase[]): SiteInteraction<InteractionStepBase> => ({
  name: 'Open the menu',
  trigger: { event: 'elementClick', selector: '[data-aglyn="leaf:menu"]' },
  steps,
})

const BOTTLE: InteractionStepDeclaration = {
  pluginId: 'cellar',
  type: 'pourBottle',
  label: 'Pour a bottle',
  picks: {
    collection: 'bottles',
    limit: 20,
    idField: 'bottleId',
    nameField: 'bottleName',
    label: 'Bottle',
    missing: 'pick a bottle',
  },
}

describe('validateInteraction', () => {
  it('checks the platform’s own steps', () => {
    expect(validateInteraction(click([{ type: 'toggleElement', selector: '#panel' }]))).toBeNull()
    expect(validateInteraction(click([{ type: 'toggleElement', selector: ' ' }]))).toBe(
      'Step 1: pick the element to show or hide',
    )
    expect(validateInteraction(click([{ type: 'scrollTo', selector: '#a', offsetPx: 5000 }]))).toBe(
      'Step 1: the offset must be 0–1000px',
    )
  })

  it('checks the trigger, and takes any event name that fits the pattern', () => {
    expect(validateInteraction({ ...click([{ type: 'siteAlert', message: 'Hi' }]), trigger: { event: '' } })).toBe(
      'Pick a trigger event',
    )
    expect(validateInteraction({ ...click([{ type: 'siteAlert', message: 'Hi' }]), trigger: { event: 'formSubmission' } })).toBeNull()
    expect(validateInteraction({ ...click([{ type: 'siteAlert', message: 'Hi' }]), trigger: { event: 'no spaces' } })).toBe(
      'Custom event names are 2–40 letters, digits, dashes',
    )
  })

  it('refuses a declared step that picks nothing, with the declaration’s words', () => {
    const declarations = [BOTTLE]
    expect(validateInteraction(click([{ type: 'pourBottle' }]), { declarations })).toBe('Step 1: pick a bottle')
    expect(validateInteraction(click([{ type: 'pourBottle', bottleId: 'b-1' }]), { declarations })).toBeNull()
    expect(validateInteraction(click([{ type: 'pourBottle', bottleName: 'Rioja' }]), { declarations })).toBeNull()
  })

  it('leaves a step it does not know to its owner', () => {
    expect(validateInteraction(click([{ type: 'pourBottle' }]), { declarations: [] })).toBeNull()
    const validateStep = jest.fn((step: InteractionStepBase, label: string) =>
      step.type === 'pourBottle' ? `${label}: not today` : null,
    )
    expect(validateInteraction(click([{ type: 'addClass', selector: '#a', className: 'x' }, { type: 'pourBottle' }]), { validateStep })).toBe(
      'Step 2: not today',
    )
    expect(validateStep).toHaveBeenCalledTimes(2)
  })

  it('checks a step’s guard before its owner does', () => {
    const validateStep = jest.fn((): string | null => null)
    expect(
      validateInteraction(
        click([{ type: 'pourBottle', when: { conditions: [{ field: '', op: 'notEmpty' }] } }]),
        { validateStep },
      ),
    ).toBe('Step 1: name the field the condition checks')
    expect(validateStep).not.toHaveBeenCalled()
  })
})

describe('a plugin’s step', () => {
  it('is a server step to the page, whatever its name', () => {
    expect(isClientActionStep({ type: 'pourBottle' })).toBe(false)
    expect(isClientActionStep({ type: 'showElement', selector: '#a' })).toBe(true)
  })

  it('is found by its declaration', () => {
    expect(declaredInteractionStep('pourBottle', [BOTTLE])).toBe(BOTTLE)
    expect(declaredInteractionStep('pourBottle', [])).toBeNull()
  })

  it('is declared only in the compiled catalog, and core names none', () => {
    // The catalog is what plugins.config.json declares; every pick lists
    // records from a collection its own plugin declares.
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'plugins.config.json'), 'utf8')) as {
      plugins: Array<{ id: string; interactionSteps?: Array<{ type: string }>; hostCollections?: Array<{ name: string }> }>
    }
    const declared = config.plugins.flatMap((plugin) =>
      (plugin.interactionSteps ?? []).map((step) => `${plugin.id}:${step.type}`),
    )
    expect(declaredInteractionSteps().map((step) => `${step.pluginId}:${step.type}`)).toEqual(declared)
    for (const step of declaredInteractionSteps()) {
      if (!step.picks) continue
      const owner = config.plugins.find((plugin) => plugin.id === step.pluginId)
      expect((owner?.hostCollections ?? []).map((collection) => collection.name)).toContain(step.picks.collection)
    }
    const source = readFileSync(join(__dirname, 'site-interactions.ts'), 'utf8')
    for (const step of declaredInteractionSteps()) {
      expect(source).not.toContain(`'${step.picks?.collection}'`)
    }
  })
})

/** A plugin's step that holds the run, as a declaration names it. */
const REST: InteractionStepDeclaration = {
  pluginId: 'cellar',
  type: 'restDough',
  label: 'Let the dough rest',
  offered: false,
  holds: { minMinutes: 5, maxMinutes: 600, timeoutField: '_restedOut' },
  typedFields: [{ key: 'note', names: 'the note' }],
}

describe('how a step is named, held and typed', () => {
  it('names a client step the platform’s way, and a plugin’s step by its declaration', () => {
    expect(interactionStepLabel('showElement', [REST])).toBe('Show an element')
    expect(interactionStepLabel('restDough', [REST])).toBe('Let the dough rest')
    expect(interactionStepLabel('notAStep', [REST])).toBeNull()
  })

  it('labels every client step', () => {
    for (const type of CLIENT_ACTION_STEP_TYPES) {
      expect(CLIENT_INTERACTION_STEP_LABELS[type as keyof typeof CLIENT_INTERACTION_STEP_LABELS]).toBeTruthy()
    }
  })

  it('reads a hold and the typed fields off the declaration', () => {
    expect(interactionStepHolds('restDough', [REST])).toEqual(REST.holds)
    expect(interactionStepHolds('showElement', [REST])).toBeNull()
    expect(interactionStepTypedFields('restDough', [REST])).toEqual(REST.typedFields)
    expect(interactionStepTypedFields('siteAlert', [REST])).toEqual([{ key: 'message', names: 'the message' }])
    expect(interactionStepTypedFields('showElement', [REST])).toEqual([])
  })

  it('hands a visitor’s page nothing past the first step that holds the run', () => {
    const steps: InteractionStepBase[] = [
      { type: 'showElement', selector: '#a' },
      { type: 'pourBottle', bottleId: 'b' },
      { type: 'restDough' },
      { type: 'hideElement', selector: '#a' },
    ]
    expect(interactionStepsForClient(steps, [REST]).map((step) => step.type)).toEqual([
      'showElement',
      'pourBottle',
    ])
    expect(interactionStepsForClient([{ type: 'restDough' }], [REST])).toEqual([])
    expect(interactionStepsForClient(null, [REST])).toEqual([])
  })

  it('compiles every declared hold as a band of whole minutes from at least one', () => {
    const holds = declaredInteractionSteps().flatMap((step) => (step.holds ? [step.holds] : []))
    expect(holds.length).toBeGreaterThan(0)
    for (const hold of holds) {
      expect(Number.isInteger(hold.minMinutes) && hold.minMinutes >= 1).toBe(true)
      expect(hold.maxMinutes).toBeGreaterThanOrEqual(hold.minMinutes)
    }
  })

  it('compiles a label for every declared step, and leaves the ones only an automation holds out of the builder', () => {
    for (const step of declaredInteractionSteps()) expect(interactionStepLabel(step.type)).toBeTruthy()
    expect(declaredInteractionSteps().some((step) => step.offered === false)).toBe(true)
  })
})

describe('the recipe stamp', () => {
  beforeAll(() =>
    registerInteractionRecipes(
      [
        {
          id: 'specProve',
          title: 'Prove the dough',
          description: 'Proves it.',
          build: () => ({ ...click([{ type: 'showElement', selector: '#a' }]), recipe: 'specProve' }),
        },
      ],
      { pluginId: 'cellar' },
    ),
  )
  afterAll(() => resetInteractionRecipesForTests())

  it('passes a known recipe, null and absent, and refuses one nobody offers', () => {
    const interaction = click([{ type: 'showElement', selector: '#a' }])
    expect(validateInteraction({ ...interaction, recipe: 'specProve' })).toBeNull()
    expect(validateInteraction({ ...interaction, recipe: null })).toBeNull()
    expect(validateInteraction(interaction)).toBeNull()
    expect(validateInteraction({ ...interaction, recipe: 'retiredRecipe' })).toBe('Unknown recipe')
  })
})
