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
 * A recipe one plugin offers reaches the editor another plugin draws, and a
 * stored interaction's stamp is known wherever it is read (AGL-3080).
 *
 * The cases pin the ownership rules a registration is held to — an owner, an
 * id, no id another plugin declares or registered, nothing registered unless
 * every recipe is accepted — and the two sources a stamp is known from: the
 * compiled declarations, which hold in a process whose declarations never
 * ran, and the registry, which is how a marketplace plugin's recipes are
 * known.
 */

let mockDeclared: unknown = undefined

jest.mock('./first-party-plugins.generated', () => {
  const actual = jest.requireActual('./first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_INTERACTION_RECIPES_DECLARED() {
      return mockDeclared === undefined ? actual.PLUGIN_INTERACTION_RECIPES_DECLARED : mockDeclared
    },
  }
})

import {
  declaredInteractionRecipes,
  type InteractionRecipe,
  interactionRecipe,
  interactionRecipes,
  isKnownInteractionRecipe,
  registerInteractionRecipes,
  resetInteractionRecipesForTests,
} from './interaction-recipes'

const recipe = (id: string, title = id): InteractionRecipe => ({
  id,
  title,
  description: `${title}, described`,
  build: () => ({
    recipe: id,
    name: title,
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'siteAlert', message: 'Thanks' }],
    enabled: true,
  }),
})

beforeEach(() => {
  mockDeclared = [{ pluginId: 'bakery', id: 'welcomeRegular' }]
  resetInteractionRecipesForTests()
})

afterAll(() => {
  resetInteractionRecipesForTests()
})

describe('the compiled declarations', () => {
  it('reads every row the generator compiled, each a plugin and a recipe id', () => {
    mockDeclared = undefined
    for (const row of declaredInteractionRecipes()) {
      expect(row).toEqual({ pluginId: expect.any(String), id: expect.any(String) })
    }
  })
})

describe('registerInteractionRecipes', () => {
  it('registers a plugin’s recipes in its own order, and reads one back by id', () => {
    const first = recipe('welcomeRegular')
    const second = recipe('thankBuyer')
    registerInteractionRecipes([first, second], { pluginId: 'bakery' })
    expect(interactionRecipes()).toEqual([first, second])
    expect(interactionRecipe('thankBuyer')).toBe(second)
    expect(interactionRecipe('nothing')).toBeNull()
    expect(interactionRecipe(42)).toBeNull()
  })

  it('refuses a registration with no owner, and a recipe with no id', () => {
    expect(() => registerInteractionRecipes([recipe('welcomeRegular')])).toThrow(/no owner/)
    expect(() => registerInteractionRecipes([recipe(' ')], { pluginId: 'bakery' })).toThrow(/no id/)
    expect(interactionRecipes()).toEqual([])
  })

  it('refuses a recipe id another plugin declares', () => {
    expect(() =>
      registerInteractionRecipes([recipe('welcomeRegular')], { pluginId: 'imposter' }),
    ).toThrow(/declared by "bakery"; refused "imposter"/)
  })

  it('refuses an id another plugin registered, and registers none of the batch', () => {
    registerInteractionRecipes([recipe('ringBell')], { pluginId: 'bells' })
    expect(() =>
      registerInteractionRecipes([recipe('thankBuyer'), recipe('ringBell')], { pluginId: 'bakery' }),
    ).toThrow(/already registered by "bells"; refused "bakery"/)
    expect(interactionRecipe('thankBuyer')).toBeNull()
    expect(interactionRecipes().map((one) => one.id)).toEqual(['ringBell'])
  })

  it('replaces the plugin’s own recipes when it registers again, and leaves another plugin’s', () => {
    registerInteractionRecipes([recipe('ringBell')], { pluginId: 'bells' })
    registerInteractionRecipes([recipe('welcomeRegular'), recipe('thankBuyer')], { pluginId: 'bakery' })
    registerInteractionRecipes([recipe('welcomeRegular', 'Welcome back')], { pluginId: 'bakery' })
    expect(interactionRecipes().map((one) => [one.id, one.title])).toEqual([
      ['ringBell', 'ringBell'],
      ['welcomeRegular', 'Welcome back'],
    ])
  })
})

describe('isKnownInteractionRecipe', () => {
  it('knows a declared recipe before anything registered it', () => {
    expect(isKnownInteractionRecipe('welcomeRegular')).toBe(true)
  })

  it('knows a registered recipe nobody declared — a marketplace plugin’s', () => {
    expect(isKnownInteractionRecipe('ringBell')).toBe(false)
    registerInteractionRecipes([recipe('ringBell')], { pluginId: 'bells' })
    expect(isKnownInteractionRecipe('ringBell')).toBe(true)
  })

  it('knows nothing that is not a recipe id', () => {
    for (const value of ['nothing', '', null, undefined, 7]) {
      expect(isKnownInteractionRecipe(value)).toBe(false)
    }
  })
})
