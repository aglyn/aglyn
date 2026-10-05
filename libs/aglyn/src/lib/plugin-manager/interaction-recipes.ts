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

import type { InteractionStepBase, SiteInteraction } from '../app-utils/site-interactions'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { PLUGIN_INTERACTION_RECIPES_DECLARED } from './first-party-plugins.generated'

/**
 * A READY-TO-EDIT INTERACTION ANOTHER PLUGIN OFFERS (AGL-3080).
 *
 * A recipe is a stored interaction — a trigger, its conditions and an ordered
 * step list — built from the step vocabulary and handed to an editor as a
 * draft. Nothing is written until a person saves, and every field is theirs to
 * change first: the recipe decides where the editor starts, not what the site
 * runs. The plugin that knows what a recipe is FOR writes it — the CRM's
 * "Welcome a new lead" is the CRM's — and the plugin that edits and stores
 * interactions offers it. Neither imports the other: the author registers its
 * recipes here, and the editor reads them.
 *
 * A stored interaction remembers the recipe it began as by the recipe's id
 * (its `recipe` stamp), so a recipe's id never changes once it has shipped.
 *
 * ## Declared, then registered
 *
 * A recipe BUILDS its interaction, which is code, so it is registered — from
 * the author's `declarations` entry, which both apps and the console's loader
 * run at boot. Its ID is also declared, under `interactionRecipes` in
 * `plugins.config.json`, and compiled into core, because a validator must know
 * a stamp names a real recipe in every process, including one where the
 * author's declarations did not run: {@link isKnownInteractionRecipe} answers
 * from either. A marketplace plugin's recipes are registered and never
 * compiled, and are known once registered.
 */

/** The compiled declaration: which plugin offers which recipe. */
export interface InteractionRecipeDeclaration {
  pluginId: string
  /** The recipe's id, as a stored interaction's `recipe` stamp names it. */
  id: string
}

/** What a recipe is handed before it builds. */
export interface InteractionRecipeInput {
  /** The record a person picked, for a recipe that {@link InteractionRecipe.picks} one. */
  picked?: { id: string; name: string }
}

/**
 * The record a person picks before a recipe can be built, and the words the
 * editor asks for it in. The editor lists the records of `kind` through the
 * list source the plugin that keeps them publishes (`plugin-record-lists`).
 */
export interface InteractionRecipePick {
  /** The record kind, as `plugin-record-lists` lists it: `'form'`. */
  kind: string
  /** The picker's label: "Form". */
  label: string
  /** The kind's plural, for the sentence that says the list was cut short: "forms". */
  plural: string
  /** What the person is asked to pick, one sentence: "Pick the form whose new contacts get the tag." */
  prompt: string
  /** What the picker says on a site that has none. */
  none: string
}

/** The interaction a recipe builds: a fresh one each call, stamped with the recipe's id. */
export type InteractionRecipeDraft = SiteInteraction<InteractionStepBase> & {
  recipe: string
}

export interface InteractionRecipe {
  /** Never changes once shipped: stored interactions name it. */
  id: string
  /** How the recipe reads in a menu; also the interaction's starting name. */
  title: string
  /** One sentence under the title. */
  description: string
  /**
   * The record a person picks before the recipe can be built. A recipe that
   * needs nothing opens the editor at once. Built WITHOUT its pick, such a
   * recipe yields an interaction a validator refuses — a condition with no
   * value — rather than one that saves and then silently matches nothing.
   */
  picks?: InteractionRecipePick
  /**
   * A fresh interaction each call, because the draft is edited in place. It
   * carries `recipe: id` — the provenance is the builder's to stamp, so a
   * writer that saves what it was handed cannot forget it.
   */
  build(input?: InteractionRecipeInput): InteractionRecipeDraft
}

/** Every recipe a first-party plugin declares, in `plugins.config.json` order. */
export function declaredInteractionRecipes(): readonly InteractionRecipeDeclaration[] {
  return PLUGIN_INTERACTION_RECIPES_DECLARED
}

interface RegisteredRecipe {
  pluginId: string
  recipe: InteractionRecipe
}

/**
 * One table per process, on `globalThis` (AGL-3412): the server apps register
 * from `instrumentation.ts`, which Next compiles apart from the routes that
 * read, and a module-scoped map would be filled in one copy and read empty in
 * the other.
 */
const RECIPES_KEY = Symbol.for('@aglyn/aglyn:interaction-recipes')

const globalScope = globalThis as typeof globalThis & {
  [RECIPES_KEY]?: Map<string, RegisteredRecipe>
}

const recipes: Map<string, RegisteredRecipe> =
  globalScope[RECIPES_KEY] ?? (globalScope[RECIPES_KEY] = new Map())

/**
 * Registers a plugin's recipes, in the order its menu lists them.
 *
 * The owner is the plugin whose register fn is running, or the `pluginId`
 * passed for a boot declaration. A registration with neither is refused; so is
 * a recipe id another plugin declares or already registered, because two
 * recipes under one id would each answer for the other's stamps. The same
 * plugin registering again replaces its own. Nothing is registered unless
 * every recipe is accepted.
 */
export function registerInteractionRecipes(
  list: readonly InteractionRecipe[],
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'interaction recipes were registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  for (const recipe of list) {
    const id = recipe.id.trim()
    if (!id) throw new Error(`"${pluginId}" registered an interaction recipe with no id`)
    const declared = PLUGIN_INTERACTION_RECIPES_DECLARED.find((row) => row.id === id)
    if (declared && declared.pluginId !== pluginId) {
      throw new Error(
        `interaction recipe "${id}" is declared by "${declared.pluginId}"; refused "${pluginId}"`,
      )
    }
    const held = recipes.get(id)
    if (held && held.pluginId !== pluginId) {
      throw new Error(
        `interaction recipe "${id}" is already registered by "${held.pluginId}"; refused "${pluginId}"`,
      )
    }
  }
  for (const [id, entry] of [...recipes]) if (entry.pluginId === pluginId) recipes.delete(id)
  for (const recipe of list) recipes.set(recipe.id.trim(), { pluginId, recipe })
}

/** Every registered recipe, each plugin's in its own order. */
export function interactionRecipes(): InteractionRecipe[] {
  return [...recipes.values()].map((entry) => entry.recipe)
}

/** The registered recipe with this id, or `null` for one nobody registered. */
export function interactionRecipe(id: unknown): InteractionRecipe | null {
  return typeof id === 'string' ? (recipes.get(id)?.recipe ?? null) : null
}

/**
 * Whether a stamp names a recipe: one a first-party plugin declares, or one a
 * plugin registered in this process.
 */
export function isKnownInteractionRecipe(id: unknown): id is string {
  if (typeof id !== 'string' || !id) return false
  return recipes.has(id) || PLUGIN_INTERACTION_RECIPES_DECLARED.some((row) => row.id === id)
}

/**
 * The recipe a STORED interaction came from, read off its document (AGL-2639).
 *
 * Three answers, and the third is the one that matters. A known id: the
 * interaction was installed from, or begun as, that recipe — one a plugin
 * declares or registered ({@link isKnownInteractionRecipe}). `null`: it was
 * begun blank, or from a recipe this build no longer knows — the editor wrote
 * the field and said "no recipe". `undefined`: the document carries no
 * `recipe` field at all, which is every interaction saved before the stamp
 * existed. Such an interaction may well have started from a recipe — the menu
 * opened the editor prefilled long before anything recorded it — so a reader
 * that needs to know whether a site has a recipe treats `undefined` as
 * UNKNOWN, never as absent, and never writes a `null` over it.
 */
export function interactionRecipeStamp(
  interaction: { recipe?: unknown } | null | undefined,
): string | null | undefined {
  const stamp = interaction?.recipe
  if (stamp === undefined) return undefined
  return isKnownInteractionRecipe(stamp) ? stamp : null
}

/** Only for specs: forgets every registered recipe. */
export function resetInteractionRecipesForTests(): void {
  recipes.clear()
}
