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
'use client'

/**
 * The drawer presets an installed marketplace plugin contributes (AGL-190,
 * AGL-1031), apart from the element that renders them.
 *
 * `plugin.ts` registers these mappers on every surface, published pages
 * included, and the Plugin element itself loads only where it is placed. In
 * the element's module the mappers pinned the whole module — its component
 * and the sandboxed frame — to every published page, because a module a
 * surface imports statically and also lazily is one module, with every export
 * kept (AGL-3401).
 */

import * as Aglyn from '@aglyn/aglyn'
import { MdiIcons, mdiPuzzle } from '@aglyn/shared-data-mdi'
import { BUNDLE_ID } from '../constants/bundle-common'

/** The Plugin element's component id, as the presets name it. */
const ID: Aglyn.ComponentId = Aglyn.PLUGIN_COMPONENT_ID

/** The besigner drawer category installed plugins register under (AGL-190). */
export const PLUGIN_DRAWER_CATEGORY = 'Marketplace'

export interface PluginInstallLike {
  listingId?: string
  $id?: string
  displayName?: string
  pluginId?: string
  manifest?: {
    name?: string
    restrictParent?: string[]
    restrictChildren?: string[]
  }
}

/**
 * Builds a besigner preset for an installed plugin (AGL-190): a named,
 * draggable drawer entry that drops a `marketplacePlugin` node with the
 * listing id pre-pinned, so editors never hand-type ids. Reuses the single
 * `marketplacePlugin` renderer — no per-plugin component registration. The
 * manifest's lineal rules ride on the node data for later enforcement.
 * Returns null for an install without a resolvable listing id.
 */
export function muiPluginInstallToPreset(
  install: PluginInstallLike,
): Aglyn.PresetSchema | null {
  const listingId = install.listingId ?? install.$id
  if (!listingId) return null
  const name =
    install.displayName || install.manifest?.name || 'Marketplace plugin'
  return {
    $id: `plugin__${listingId}`,
    type: Aglyn.NodeType.PRESET,
    displayName: name,
    pluginId: BUNDLE_ID,
    description: 'Installed marketplace plugin',
    category: PLUGIN_DRAWER_CATEGORY,
    icon: { path: mdiPuzzle.path, sx: { color: '#5e35b1' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { listingId },
      ...(install.manifest?.restrictParent
        ? { restrictParent: install.manifest.restrictParent }
        : {}),
      ...(install.manifest?.restrictChildren
        ? { restrictChildren: install.manifest.restrictChildren }
        : {}),
    } as any,
  }
}

/**
 * Every drawer preset an installed plugin contributes (AGL-1031).
 *
 * The generic Plugin element, plus one per element the PINNED version
 * declares. Declared elements save as the same node with an `elementId`
 * alongside the listing id — the issue's preferred answer, and the one that
 * keeps a single compose path and a single sandbox. What changes is the
 * palette entry and the label, not what executes.
 *
 * Resolved from the pin, so an element appears only where the plugin is
 * installed and disappears with a revoked or downgraded version.
 */
export function muiPluginInstallToPresets(
  install: PluginInstallLike,
): Aglyn.PresetSchema[] {
  const generic = muiPluginInstallToPreset(install)
  const presets = generic ? [generic] : []
  const listingId = install.listingId ?? install.$id
  if (!listingId) return presets

  for (const element of Aglyn.resolvePluginElements({
    listingId,
    capabilities: (install as any).manifest?.capabilities,
    manifest: (install as any).manifest,
  })) {
    // The declared icon is an mdi NAME; look it up in the set the host already
    // ships. An unresolved name falls back to the puzzle mark rather than
    // rendering nothing — the entry is still placeable, which matters more
    // than the glyph.
    const declared = element.icon ? MdiIcons.get(element.icon as never) : undefined
    presets.push({
      $id: `plugin__${listingId}__${element.elementId}`,
      type: Aglyn.NodeType.PRESET,
      displayName: element.displayName,
      pluginId: BUNDLE_ID,
      description: element.description ?? 'Installed marketplace plugin',
      category: element.category,
      icon: {
        path: (declared as { path?: string } | undefined)?.path ?? mdiPuzzle.path,
        sx: { color: '#5e35b1' },
      },
      data: {
        $id: null,
        componentId: ID,
        pluginId: BUNDLE_ID,
        props: { listingId, elementId: element.elementId },
        ...(install.manifest?.restrictParent
          ? { restrictParent: install.manifest.restrictParent }
          : {}),
        ...(install.manifest?.restrictChildren
          ? { restrictChildren: install.manifest.restrictChildren }
          : {}),
      } as any,
    })
  }
  return presets
}
