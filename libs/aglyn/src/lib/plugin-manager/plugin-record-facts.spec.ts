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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  pluginRecordFactsReader,
  registerPluginRecordFactsReader,
  type PluginRecordFactsReader,
  type PluginRecordFactsRequest,
} from './plugin-record-facts'
import { resetPluginServicesForTests, unregisterPluginServices } from './plugin-services'

/**
 * The seam with no CRM or AI in it: a `recipes` plugin owns recipes, and a
 * `digest` plugin that knows nothing about how recipes are stored writes a
 * line about one through the reader the recipes plugin registered — refused
 * where the recipes plugin refuses, and told only the facts its reader
 * chose to report.
 */

const NOW = new Date('2026-09-16T20:00:00.000Z')

/** The recipes plugin's own store and rules; nothing outside its reader touches either. */
function recipesPlugin() {
  const recipes = new Map<string, { hostId: string; title: string; minutes: number; secretIngredient: string }>([
    ['r-1', { hostId: 'host-1', title: 'Rye loaf', minutes: 240, secretIngredient: 'malt' }],
  ])
  const reads: string[] = []
  const reader: PluginRecordFactsReader = {
    read: async ({ hostId, id, uid }) => {
      reads.push(id)
      if (uid === 'viewer') return { ok: false, status: 403, error: 'Reading recipes requires the cook role' }
      const recipe = recipes.get(id)
      // A site reads its own recipes; the organization reads all of them.
      if (!recipe || (hostId !== null && recipe.hostId !== hostId)) {
        return { ok: false, status: 404, error: 'Unknown recipe' }
      }
      // The secret ingredient is modeled here and never leaves here.
      return { ok: true, facts: { title: recipe.title, minutes: recipe.minutes } }
    },
  }
  return { reader, reads }
}

/** The digest: it names the resource, never the plugin that stores it. */
async function digestLine(request: Omit<PluginRecordFactsRequest, 'orgId' | 'org' | 'now'>) {
  const found = pluginRecordFactsReader('recipe')
  if (!found) return 'Recipes are not available here'
  const read = await found.reader.read({ ...request, orgId: 'org-1', org: null, now: NOW })
  if (read.ok === false) return read.error
  return `${String(read.facts['title'])} takes ${String(read.facts['minutes'])} minutes (${Object.keys(read.facts).join(', ')})`
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('record facts', () => {
  it('lets a plugin read another plugin’s record through the owner’s reader, and only the facts it reports', async () => {
    const recipes = recipesPlugin()
    setRegisteringPluginId('recipes')
    registerPluginRecordFactsReader('recipe', recipes.reader)
    setRegisteringPluginId(undefined)

    expect(pluginRecordFactsReader('recipe')).toEqual({ pluginId: 'recipes', reader: recipes.reader })
    expect(await digestLine({ hostId: 'host-1', id: 'r-1', uid: 'cook' })).toBe(
      'Rye loaf takes 240 minutes (title, minutes)',
    )
    // The organization's own view of a record a site holds.
    expect(await digestLine({ hostId: null, id: 'r-1', uid: 'cook' })).toBe(
      'Rye loaf takes 240 minutes (title, minutes)',
    )
  })

  it('refuses where the owner refuses, in the owner’s words', async () => {
    const recipes = recipesPlugin()
    registerPluginRecordFactsReader('recipe', recipes.reader, { pluginId: 'recipes' })
    expect(await digestLine({ hostId: 'host-1', id: 'r-1', uid: 'viewer' })).toBe(
      'Reading recipes requires the cook role',
    )
    expect(await digestLine({ hostId: 'host-2', id: 'r-1', uid: 'cook' })).toBe('Unknown recipe')
  })

  it('answers null for a resource no plugin reads, and after its owner unloads', async () => {
    expect(pluginRecordFactsReader('recipe')).toBeNull()
    expect(await digestLine({ hostId: 'host-1', id: 'r-1', uid: 'cook' })).toBe('Recipes are not available here')
    registerPluginRecordFactsReader('recipe', recipesPlugin().reader, { pluginId: 'recipes' })
    unregisterPluginServices('recipes')
    expect(pluginRecordFactsReader('recipe')).toBeNull()
  })

  it('keeps one owner per resource: a second plugin is refused naming both, and the owner re-registers its own', () => {
    const first = recipesPlugin()
    const second = recipesPlugin()
    registerPluginRecordFactsReader('recipe', first.reader, { pluginId: 'recipes' })
    expect(() => registerPluginRecordFactsReader('recipe', second.reader, { pluginId: 'scraper' })).toThrow(
      'resource "recipe" already has a facts reader from "recipes"; refused "scraper"',
    )
    expect(pluginRecordFactsReader('recipe')?.reader).toBe(first.reader)

    registerPluginRecordFactsReader('recipe', second.reader, { pluginId: 'recipes' })
    expect(pluginRecordFactsReader('recipe')).toEqual({ pluginId: 'recipes', reader: second.reader })
    // Another resource from another plugin is its own key.
    registerPluginRecordFactsReader('pantry', first.reader, { pluginId: 'scraper' })
    expect(pluginRecordFactsReader('pantry')?.pluginId).toBe('scraper')
  })

  it('needs a resource name and an owner', () => {
    expect(() => registerPluginRecordFactsReader('  ', recipesPlugin().reader, { pluginId: 'recipes' })).toThrow(
      'a record facts reader needs a resource name',
    )
    expect(() => registerPluginRecordFactsReader('recipe', recipesPlugin().reader)).toThrow(/no owner/)
  })
})
