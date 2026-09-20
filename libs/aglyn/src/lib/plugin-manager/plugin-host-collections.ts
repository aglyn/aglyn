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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * The host subcollections a plugin owns, declared by that plugin (AGL-3124).
 *
 * A first-party plugin writes ordinary documents under `hosts/{hostId}` with
 * the ordinary SDKs, and several core surfaces have to know which plugin owns
 * which of them: the media-usage scan decides what to read before an author
 * deletes an asset, a reference row deep-links to the console page that shows
 * one, and the artifact counters total what a site holds.
 *
 * Core answered all three by listing the collections and switching over plugin
 * ids — `services` and `resources` are bookings', `campaigns` and `experiments`
 * are marketing's, `functions`, `variables` and `actions` are logic's — which
 * is the platform holding a map of its plugins' storage. Every entry is also a
 * thing that can silently fall out of step: a plugin that ships a new
 * collection is invisible to all three until somebody remembers the list.
 *
 * So the plugin declares what it owns, once, and the three readers ask.
 *
 * ## What a declaration says, and what it deliberately does not
 *
 * A declaration names the collection, how the media scan should treat it, the
 * console slug a reference row links to, and whether a document in it is an
 * ARTIFACT the site's counters total beside screens and layouts. It does NOT
 * name fields: the scan flattens a document generically on purpose, and a
 * field list here would be the same staleness trap one level down.
 *
 * The media default is inherited from the scan's own rule and is the whole
 * reason that rule survives this move: **a collection is scanned unless its
 * declaration says why it is not.** A plugin that ships a media-bearing
 * collection is covered the day it lands rather than the day somebody
 * remembers it, and `mediaScan: 'none'` without a reason is refused — "it
 * probably has no images in it" is the guess the scan's design exists to
 * avoid making.
 *
 * ## One collection, one owner
 *
 * Two plugins writing one collection under one site would be two schemas in
 * one place, and the scan, the deep link and the counters would each pick a
 * winner by registration order. So a collection another plugin declared is
 * refused naming both, and the incumbent keeps it; the same plugin declaring
 * again replaces its own.
 *
 * Reached by its own subpath rather than through `plugin-manager/index.ts`:
 * the readers are the media scan, the console counters and the reference
 * rows, none of which a published page renders.
 */

/** How the media-usage scan reads a collection. */
export type PluginHostCollectionMediaScan =
  /** Flattened and searched generically, with no per-collection decoder. */
  | 'generic'
  /** Read by a pass that knows its shape, the way screens and layouts are. */
  | 'own'
  /** Not read; {@link PluginHostCollectionDeclaration.mediaScanReason} says why. */
  | 'none'

export interface PluginHostCollectionDeclaration {
  /** The subcollection under `hosts/{hostId}`, spelled as Firestore holds it. */
  name: string
  /**
   * What one of its documents is called in a reference row. Derived from the
   * collection name when absent, so a new collection reads correctly without
   * a second list to keep in step.
   */
  label?: string
  /** Default `generic` — see this module's note on why the default is to scan. */
  mediaScan?: PluginHostCollectionMediaScan
  /**
   * Why the scan does not read it. Required with `mediaScan: 'none'`, and it
   * has to answer what scanning would COST or what it would get WRONG.
   */
  mediaScanReason?: string
  /**
   * The `[pluginSlug]` segment of the plugin's console hub, for a reference
   * row's deep link. Optional on purpose: a row with no destination still
   * renders as text, which is better than the row not existing.
   */
  routeSlug?: string
  /**
   * Whether a document here is a live ARTIFACT — something the site's own
   * counters total beside its screens, layouts, components and templates.
   */
  artifact?: boolean
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginHostCollection = PluginHostCollectionDeclaration & {
  pluginId: string
}

export const PLUGIN_HOST_COLLECTIONS =
  definePluginServiceContract<PluginHostCollectionDeclaration>(
    'core.host-collections',
    { multiple: true },
  )

/**
 * Declares the host subcollections the registering plugin owns. The owner is
 * the loader's marker when a register fn is running, else `options.pluginId`;
 * with neither the registration throws. A collection another plugin declared
 * throws naming both, and nothing in the same call is registered — a
 * declaration is one plugin's statement about its own storage, so half of it
 * landing would be worse than none.
 */
export function registerPluginHostCollections(
  collections: readonly PluginHostCollectionDeclaration[],
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const prepared = collections.map((declaration) => {
    const name = declaration.name?.trim() ?? ''
    if (!name) throw new Error('a host collection needs a name')
    if (declaration.mediaScan === 'none' && !declaration.mediaScanReason?.trim()) {
      throw new Error(
        `host collection "${name}" is not scanned for media and says no ` +
          'reason: mediaScanReason has to name what scanning would cost, or ' +
          'what it would get wrong',
      )
    }
    const incumbent = resolvePluginServices(PLUGIN_HOST_COLLECTIONS).find(
      (entry) => entry.key === name,
    )
    if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
      throw new Error(
        `host collection "${name}" is already declared by ` +
          `"${incumbent.pluginId}"; refused "${pluginId}"`,
      )
    }
    return { ...declaration, name }
  })
  for (const declaration of prepared) {
    registerPluginService(PLUGIN_HOST_COLLECTIONS, declaration, {
      ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
      key: declaration.name,
    })
  }
}

/** Every declared collection, with its owner, in registration order. */
export function listPluginHostCollections(): ResolvedPluginHostCollection[] {
  return resolvePluginServices(PLUGIN_HOST_COLLECTIONS).map((entry) => ({
    ...entry.impl,
    pluginId: entry.pluginId,
  }))
}

/** One declared collection by name, with its owner, or `null`. */
export function pluginHostCollection(
  name: string,
): ResolvedPluginHostCollection | null {
  const key = name.trim()
  const entry = resolvePluginServices(PLUGIN_HOST_COLLECTIONS).find(
    (one) => one.key === key,
  )
  return entry ? { ...entry.impl, pluginId: entry.pluginId } : null
}

/** The plugin that owns a collection, or `undefined` when none declares it. */
export function pluginIdForHostCollection(name: string): string | undefined {
  return pluginHostCollection(name)?.pluginId
}

/**
 * The console hub slug a reference row for this collection links to, or
 * `undefined` when the owner routes none.
 */
export function pluginHostCollectionRouteSlug(
  name: string,
): string | undefined {
  return pluginHostCollection(name)?.routeSlug
}

/**
 * The declared collections the media scan reads generically — the list the
 * scan walks, in place of one core keeps by hand.
 */
export function pluginHostCollectionsScannedGenerically(): string[] {
  return listPluginHostCollections()
    .filter((one) => (one.mediaScan ?? 'generic') === 'generic')
    .map((one) => one.name)
}

/** The declared collections the scan does not read, with the reason given. */
export function pluginHostCollectionsExcludedFromMediaScan(): Array<{
  name: string
  reason: string
  pluginId: string
}> {
  return listPluginHostCollections()
    .filter((one) => one.mediaScan === 'none')
    .map((one) => ({
      name: one.name,
      reason: one.mediaScanReason ?? '',
      pluginId: one.pluginId,
    }))
}

/** The declared collections whose documents the site's artifact counters total. */
export function pluginHostArtifactCollections(): string[] {
  return listPluginHostCollections()
    .filter((one) => one.artifact === true)
    .map((one) => one.name)
}

/**
 * What to call one of a collection's documents in a reference row: the
 * declared label, else derived from the name — `productCategories` reads as
 * "Product category". Singularized with the two rules English spells
 * consistently enough to automate; anything else keeps its name, which is a
 * cosmetic miss rather than a coverage one.
 */
export function pluginHostCollectionLabel(name: string): string {
  const declared = pluginHostCollection(name)?.label?.trim()
  if (declared) return declared
  const singular = /ies$/.test(name)
    ? name.replace(/ies$/, 'y')
    : /(ss|s)$/.test(name)
      ? name.replace(/s$/, '')
      : name
  const spaced = singular.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
