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

// The pure half of `backfill-plugin-id-crm.mjs` (AGL-2595): what a plugin-id
// rename does to one stored document, with no Firestore in sight so it can be
// asserted against fixtures.
//
// A first-party plugin id is persisted in three places — `org.enabledPlugins`,
// `host.disabledPlugins`, `host.enabledPlugins` — and as the DOCUMENT ID under
// every `pluginSettings` collection. While a rename is in flight the runtime
// reads the old id through `canonicalPluginId` (see `enabled-plugins.ts`),
// which is what makes the deploy safe on its own; this rewrite is what lets
// that alias be retired.
//
// The `contacts` → `crm` rename has completed: the backfill reported zero
// documents carrying the old id and the runtime alias was retired
// (AGL-2614). The table below is the record of that rename and the shape the
// next one copies; the test beside this file asserts the runtime no longer
// aliases it.

/** Old id → current id, for the rename this script performed. */
export const PLUGIN_ID_RENAMES = Object.freeze({ contacts: 'crm' })

/**
 * A stored id list with every retired id replaced, de-duplicated in place
 * (the first occurrence keeps its position). `null` when nothing changes, so
 * a caller never writes a document it did not need to touch.
 */
export function renamePluginIds(list, renames = PLUGIN_ID_RENAMES) {
  if (!Array.isArray(list)) return null
  const next = []
  const seen = new Set()
  let changed = false
  for (const raw of list) {
    const id = String(raw)
    const current = renames[id] ?? id
    if (current !== id) changed = true
    if (seen.has(current)) {
      changed = true
      continue
    }
    seen.add(current)
    next.push(current)
  }
  return changed ? next : null
}

/** The field patch for one org document, or `null` when it is already current. */
export function planOrgUpdate(org, renames = PLUGIN_ID_RENAMES) {
  const enabledPlugins = renamePluginIds(org?.enabledPlugins, renames)
  return enabledPlugins ? { enabledPlugins } : null
}

/** The field patch for one host document, or `null` when it is already current. */
export function planHostUpdate(host, renames = PLUGIN_ID_RENAMES) {
  const patch = {}
  const disabledPlugins = renamePluginIds(host?.disabledPlugins, renames)
  if (disabledPlugins) patch.disabledPlugins = disabledPlugins
  const enabledPlugins = renamePluginIds(host?.enabledPlugins, renames)
  if (enabledPlugins) patch.enabledPlugins = enabledPlugins
  return Object.keys(patch).length ? patch : null
}

/**
 * Where a `pluginSettings/{oldId}` document goes: the sibling named by the
 * current id, or nowhere when the id is not one being renamed.
 */
export function pluginSettingsTarget(docId, renames = PLUGIN_ID_RENAMES) {
  return renames[docId] ?? null
}
