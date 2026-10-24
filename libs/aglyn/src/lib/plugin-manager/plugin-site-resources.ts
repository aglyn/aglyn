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
 * A PLUGIN'S SHARE OF DELETING A SITE (AGL-4003).
 *
 * Deleting a site (`eraseHost`) destroys what the platform holds for it: its
 * document tree, its Storage, its routing, and the organization documents a
 * plugin declares as the site's (`orgCollections` with a `siteField`). Some
 * plugin resources belong to the ORGANIZATION and are shared with sites by a
 * scope list instead — a dataset shared with one site, or with several. Which
 * of those are the site's own, and what becomes of the rest, is the plugin's
 * to say, so the plugin registers a site-resource eraser here:
 *
 * - `preview` lists what deleting the site would take — the resources shared
 *   with this site alone, each with how many items it holds — and how many it
 *   shares with other sites, which stay. The Delete site card shows it before
 *   anyone confirms, so it must change nothing.
 * - `erase` erases the resources shared with this site alone, items and all,
 *   and takes the site off the sharing of the ones it shares with others. It
 *   answers how many it erased.
 *
 * Erasers run in registration order and are ISOLATED, like every trailing
 * cleanup of a site delete: a throw is logged against its plugin and does not
 * stop the next one or the delete. A preview that throws is reported as
 * `null` for its plugin, so the card can say the list is incomplete rather
 * than show an empty one.
 *
 * Registered from a plugin's `serverDeclarations`, so the eraser is in place
 * in every server process that can delete a site.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/** The site a preview or an erase is about, and the workspace that owns it. */
export interface PluginSiteResourceRequest {
  orgId: string
  hostId: string
}

/** One resource that goes with the site. */
export interface PluginSiteResourceGoing {
  id: string
  /** Its name, as the plugin's own page shows it. */
  name: string
  /** How many items it holds; `null` where they could not be counted. */
  items: number | null
}

/** What deleting the site does to one plugin's resources. */
export interface PluginSiteResourcePreview {
  /** What one resource is called, and several: `['dataset', 'datasets']`. */
  noun: readonly [string, string]
  /** What one of its items is called, and several: `['record', 'records']`. */
  itemNoun: readonly [string, string]
  /** Shared with this site alone: erased with every item. */
  going: PluginSiteResourceGoing[]
  /** Shared with this site and others: they stay, and lose this site. */
  staying: number
}

export interface PluginSiteResourceEraser {
  /** What deleting the site would take. Reads only. */
  preview(request: PluginSiteResourceRequest): Promise<PluginSiteResourcePreview>
  /** Erases the site's own resources; answers how many it erased. */
  erase(request: PluginSiteResourceRequest): Promise<number>
}

interface Registration {
  pluginId: string
  eraser: PluginSiteResourceEraser
}

/**
 * One list per process, on `globalThis` (AGL-3464): the app registers its
 * plugins' declarations from `instrumentation.ts`, which Next compiles apart
 * from the route that deletes a site, and a module-scoped list is filled in
 * one copy and read empty in the other.
 */
const ERASERS_KEY = Symbol.for('@aglyn/aglyn:plugin-site-resource-erasers')

const globalScope = globalThis as typeof globalThis & {
  [ERASERS_KEY]?: Registration[]
}

const registrations: Registration[] =
  globalScope[ERASERS_KEY] ?? (globalScope[ERASERS_KEY] = [])

/**
 * Registers a plugin's site-resource eraser. Owner = the loader's marker
 * inside a register fn, else `options.pluginId`; an eraser with neither
 * throws. One per plugin: registering again replaces the plugin's earlier
 * eraser in place, so a module evaluated twice does not erase twice.
 */
export function registerPluginSiteResourceEraser(
  eraser: PluginSiteResourceEraser,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin site-resource eraser was registered with no owner: pass ' +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  if (typeof eraser?.preview !== 'function' || typeof eraser?.erase !== 'function') {
    throw new Error('a site-resource eraser needs a preview and an erase function')
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, eraser }
  else registrations.push({ pluginId, eraser })
}

/**
 * The erasers in place, after running the app's boot step once when none is:
 * a boot whose declarations failed must not read as a workspace with nothing
 * shared with the site.
 */
async function registered(): Promise<Registration[]> {
  if (!registrations.length) {
    await runPluginDeclarationsRepair().catch((error: unknown) => {
      console.error('[plugins] the declarations repair failed before a site delete', error)
    })
  }
  return [...registrations]
}

/** One plugin's preview, or `null` where its preview failed. */
export interface PluginSiteResourcePreviewRow {
  pluginId: string
  preview: PluginSiteResourcePreview | null
}

/**
 * Every plugin's preview, in registration order. Never throws: a preview that
 * fails is logged and answered as `null` for its plugin.
 */
export async function previewPluginSiteResources(
  request: PluginSiteResourceRequest,
): Promise<PluginSiteResourcePreviewRow[]> {
  const rows: PluginSiteResourcePreviewRow[] = []
  for (const { pluginId, eraser } of await registered()) {
    try {
      rows.push({ pluginId, preview: await eraser.preview(request) })
    } catch (error) {
      console.error(
        `[plugins] ${pluginId} could not list what goes with site ${request.hostId}`,
        error,
      )
      rows.push({ pluginId, preview: null })
    }
  }
  return rows
}

/**
 * Runs every eraser, in registration order, and answers how many resources
 * each erased by plugin id, or `null` for one that threw. Never throws.
 */
export async function erasePluginSiteResources(
  request: PluginSiteResourceRequest,
): Promise<Record<string, number | null>> {
  const erased: Record<string, number | null> = {}
  for (const { pluginId, eraser } of await registered()) {
    try {
      erased[pluginId] = await eraser.erase(request)
    } catch (error) {
      erased[pluginId] = null
      console.error(`[plugins] ${pluginId} failed to erase site ${request.hostId}'s resources`, error)
    }
  }
  return erased
}

/** The plugins with a site-resource eraser, in the order they run. */
export function listPluginSiteResourceErasers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every eraser. */
export function resetPluginSiteResourceErasersForTests(): void {
  registrations.length = 0
}
