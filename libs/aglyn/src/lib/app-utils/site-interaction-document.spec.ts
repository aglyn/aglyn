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
 * The recipe stamp a stored interaction carries, and the stored shape every
 * writer of `hosts/{hostId}/actions` saves (AGL-2639). The recipes themselves
 * are the plugins' that write them (`interaction-recipes`, AGL-3080): this
 * spec registers one of its own, and the CRM's are held in the CRM plugin and,
 * as automations, in `apps/console/specs/interaction-recipes.spec.ts`.
 */

import {
  interactionRecipeStamp,
  registerInteractionRecipes,
  resetInteractionRecipesForTests,
} from '../plugin-manager/interaction-recipes'
import {
  type InteractionStepBase,
  type SiteInteraction,
  siteInteractionDocument,
  validateInteraction,
} from './site-interactions'

type Stored = SiteInteraction<InteractionStepBase>

/** A recipe of this spec's own, registered as a plugin's declarations would. */
const thankBuyer = (): Stored => ({
  recipe: 'specThankBuyer',
  name: 'Thank a buyer',
  trigger: { event: 'formSubmission' },
  steps: [{ type: 'notifyAdmins', title: 'A new order' }],
  enabled: true,
})

beforeAll(() => {
  registerInteractionRecipes(
    [
      {
        id: 'specThankBuyer',
        title: 'Thank a buyer',
        description: 'Thanks a buyer.',
        build: () => ({ ...thankBuyer(), recipe: 'specThankBuyer' }),
      },
    ],
    { pluginId: 'spec' },
  )
})

afterAll(() => {
  resetInteractionRecipesForTests()
})

describe('the stored recipe stamp (AGL-2639)', () => {
  it('reads a known id, null for "no recipe", and UNKNOWN for a document from before the stamp', () => {
    expect(interactionRecipeStamp({ recipe: 'specThankBuyer' })).toBe('specThankBuyer')
    expect(interactionRecipeStamp({ recipe: null })).toBeNull()
    // A retired or mistyped id says nothing usable; it reads as no recipe.
    expect(interactionRecipeStamp({ recipe: 'retiredRecipe' })).toBeNull()
    // No field at all is the older document: unknown, not absent.
    expect(interactionRecipeStamp({})).toBeUndefined()
    expect(interactionRecipeStamp(undefined)).toBeUndefined()
  })

  it('refuses a stamp that names no recipe, and passes null and absent alike', () => {
    const action = thankBuyer()
    expect(validateInteraction({ ...action, recipe: 'retiredRecipe' as never })).toBe(
      'Unknown recipe',
    )
    expect(validateInteraction({ ...action, recipe: null })).toBeNull()
    const { recipe: _stamp, ...unstamped } = action
    expect(validateInteraction(unstamped)).toBeNull()
  })
})

describe('siteInteractionDocument (AGL-2639)', () => {
  const action: Stored = {
    name: 'Nudge',
    trigger: {
      event: 'scrollDepth',
      threshold: 50,
      oncePerVisitor: true,
      cooldownMinutes: 30,
      condition: { field: 'x', op: 'notEmpty' },
      conditions: [{ field: 'path', op: 'contains', value: '/pricing' }],
      combinator: 'or',
    },
    steps: [{ type: 'siteAlert', message: 'Hi', severity: 'info' }],
  }

  it('writes every cap and list out, so a merge-set clears what the editor switched off', () => {
    const stored = siteInteractionDocument(action)
    expect(stored.trigger).toEqual({
      event: 'scrollDepth',
      threshold: 50,
      oncePerVisitor: true,
      oncePerSession: false,
      cooldownMinutes: 30,
      everyTime: false,
      // The legacy single condition is always nulled; the list is canonical.
      condition: null,
      conditions: [{ field: 'path', op: 'contains', value: '/pricing' }],
      combinator: 'or',
    })
    expect(stored.enabled).toBe(true)
    expect(stored.steps).toEqual(action.steps)
    expect(stored.name).toBe('Nudge')
    const bare = siteInteractionDocument({
      name: 'Bare',
      trigger: { event: 'formSubmission' },
      steps: [],
      enabled: false,
    })
    expect(bare.trigger).toEqual({
      event: 'formSubmission',
      oncePerVisitor: false,
      oncePerSession: false,
      cooldownMinutes: null,
      everyTime: false,
      condition: null,
      conditions: null,
      combinator: null,
    })
    expect(bare.enabled).toBe(false)
  })

  it('carries the recipe stamp only when the action says something about it', () => {
    expect('recipe' in siteInteractionDocument(action)).toBe(false)
    expect(siteInteractionDocument({ ...action, recipe: null }).recipe).toBeNull()
    expect(siteInteractionDocument(thankBuyer()).recipe).toBe('specThankBuyer')
  })

  it('is the shape a recipe install writes: the validator accepts it as it accepts the action', () => {
    expect(validateInteraction(thankBuyer())).toBeNull()
    expect(validateInteraction(siteInteractionDocument(thankBuyer()))).toBeNull()
  })
})
