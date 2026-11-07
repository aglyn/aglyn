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
 * WHICH COLLECTIONS HOLD DOCUMENTS SHARED WITH "ALL SITES EXCEPT…" (AGL-4047).
 *
 * Such a document names its included sites in `visibleTo`, so that list has
 * to change when a site joins or leaves the workspace. One sweep does that for
 * every collection (`scope-sharing-sweep.ts`), and it can only walk what it
 * has been told about, so a plugin declares its collections in the
 * `scopeSharingCollections` block of `plugins.config.json`, compiled like its
 * other storage. Media belongs to the platform and is listed here.
 *
 * A collection whose documents store fields derived from `visibleTo` declares
 * `patch: true` and registers the function that recomputes them. The sweep
 * refuses to write such a collection while the function is missing, because a
 * `visibleTo` written without them leaves a document its list cannot find.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { PLUGIN_SCOPE_SHARING_COLLECTIONS_DECLARED } from './plugin-scope-sharing.generated'

/** One collection under `orgs/{orgId}` whose documents can be all-except. */
export interface ScopeSharingCollection {
  /** The subcollection, spelled as Firestore holds it. */
  name: string
  /** Stored fields follow `visibleTo`: a patch function is registered. */
  patch?: boolean
  /** The most sites one document may reach; past it the list stops widening. */
  maxIncluded?: number
  /** Fields naming sites that stay included though they are excluded. */
  keepSiteFields?: string[]
}

/** A declaration with its owner; `core` for what the platform holds itself. */
export type ResolvedScopeSharingCollection = ScopeSharingCollection & {
  pluginId: string
}

/** The platform's own: media belongs to no plugin. */
const CORE_SCOPE_SHARING_COLLECTIONS: readonly ResolvedScopeSharingCollection[] = [
  { pluginId: 'core', name: 'media' },
  { pluginId: 'core', name: 'mediaFolders' },
]

/**
 * Every collection the sweep walks, in a stable order: a sweep's cursor names
 * a position in this list, and resuming relies on the ones before it being done.
 */
export function listScopeSharingCollections(): ResolvedScopeSharingCollection[] {
  return [
    ...CORE_SCOPE_SHARING_COLLECTIONS,
    ...PLUGIN_SCOPE_SHARING_COLLECTIONS_DECLARED,
  ].map((row) => ({ ...row }))
}

/**
 * Recomputes the fields a document derives from its scope: `next` is the whole
 * document as it will be stored, and the answer is merged into the write.
 */
export type ScopeSharingPatch = (
  collection: string,
  next: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>

/**
 * One map per process, on `globalThis`, for the reason `plugin-site-resources`
 * gives: the declarations register from `instrumentation.ts`, which Next
 * compiles apart from the route that runs the sweep.
 */
const PATCHES_KEY = Symbol.for('@aglyn/aglyn:plugin-scope-sharing-patches')

const globalScope = globalThis as typeof globalThis & {
  [PATCHES_KEY]?: Map<string, ScopeSharingPatch>
}

const patches: Map<string, ScopeSharingPatch> =
  globalScope[PATCHES_KEY] ?? (globalScope[PATCHES_KEY] = new Map())

/**
 * Registers the patch for collections a plugin declared with `patch: true`.
 * Refuses a collection another plugin declared, or one declared without it.
 */
export function registerPluginScopeSharingPatch(
  collections: readonly string[],
  patch: ScopeSharingPatch,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a scope-sharing patch was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  for (const name of collections) {
    const declared = PLUGIN_SCOPE_SHARING_COLLECTIONS_DECLARED.find((row) => row.name === name)
    if (declared?.pluginId !== pluginId || !declared.patch) {
      throw new Error(`${pluginId} did not declare ${name} with patch: true in scopeSharingCollections`)
    }
  }
  for (const name of collections) patches.set(name, patch)
}

/** The patch registered for a collection, or `null`. */
export function scopeSharingPatchFor(collection: string): ScopeSharingPatch | null {
  return patches.get(collection) ?? null
}

/** Test seam: forget every patch. */
export function resetScopeSharingPatchesForTests(): void {
  patches.clear()
  siteChangeHooks.clear()
}

/**
 * What a plugin keeps level itself after a workspace's sites change, for
 * sharing it stores somewhere other than a document's own marker: the CRM's
 * grants shared with all sites except some, which sit inside a record's
 * `sharing` map. Called after the sweep, with the time it may spend inline;
 * work left past it is the plugin's to finish. It must never throw.
 */
export type ScopeSharingSiteChangeHook = (input: {
  orgId: string
  reason: 'site-added' | 'site-removed' | 'drift-repair'
  hostId?: string
  budgetMs: number
}) => Promise<void>

const SITE_CHANGE_KEY = Symbol.for('@aglyn/aglyn:plugin-scope-sharing-site-change')

const globalHooks = globalThis as typeof globalThis & {
  [SITE_CHANGE_KEY]?: Map<string, ScopeSharingSiteChangeHook>
}

const siteChangeHooks: Map<string, ScopeSharingSiteChangeHook> =
  globalHooks[SITE_CHANGE_KEY] ?? (globalHooks[SITE_CHANGE_KEY] = new Map())

/** Registers a plugin's {@link ScopeSharingSiteChangeHook}. One per plugin; again replaces it. */
export function registerPluginScopeSharingSiteChange(
  hook: ScopeSharingSiteChangeHook,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a scope-sharing site-change hook was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  siteChangeHooks.set(pluginId, hook)
}

/** Every registered site-change hook, by plugin. */
export function listScopeSharingSiteChangeHooks(): Array<{
  pluginId: string
  hook: ScopeSharingSiteChangeHook
}> {
  return [...siteChangeHooks.entries()].map(([pluginId, hook]) => ({ pluginId, hook }))
}
