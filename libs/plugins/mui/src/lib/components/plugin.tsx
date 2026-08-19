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

import * as Aglyn from '@aglyn/aglyn'
import { MdiIcons } from '@aglyn/shared-data-mdi'
import { registerPluginInstallPresetMapper } from '@aglyn/aglyn'
import { mdiPuzzle } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { PluginFrame } from './plugin-frame'

// Component id is persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = Aglyn.PLUGIN_COMPONENT_ID

export interface MarketplacePluginProps {
  /** Installed listing id; the only prop authors set. */
  listingId?: string
  /**
   * Which DECLARED element of the plugin this node is (AGL-1031). Set by the
   * palette preset; absent for the generic Plugin element. Passed through to
   * the sandboxed frame as an ordinary prop, so one node type and one compose
   * path serve both.
   */
  elementId?: string
  /** Injected at compose by `attachPluginInstalls` (AGL-45). */
  version?: string
  sha256?: string
  capabilities?: Aglyn.PluginCapabilities
  revoked?: boolean
  /** Extra props forwarded to the plugin (filtered to its allowlist). */
  pluginProps?: Record<string, unknown>
  /**
   * Per-placement plugin settings as JSON (AGL-192), authored in the
   * element panel. Parsed into `pluginProps` and filtered to the
   * manifest's declared props before it reaches the plugin.
   */
  pluginPropsJson?: string
}

/** Parses the authored settings JSON; invalid input yields no props. */
export function parsePluginPropsJson(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  if (!raw || !raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * What the inert placeholder says, and — more to the point — what it refuses
 * to say (AGL-1029).
 *
 * It used to read "not installed on this site" for EVERY plugin with a listing
 * id, because it inferred installation from `version`/`sha256`: fields the
 * tenant compose pass injects and the canvas never has. Plugins do not execute
 * in the editor by design, so their absence there means nothing about the pin,
 * and the first thing an author saw after installing was a message telling them
 * the install had failed.
 *
 * The claim is only made when it has been earned. The editor publishes the
 * installs it reads (`setKnownPluginInstalls`); a listing id missing from that
 * list really is not installed. Where nothing published a list — the tenant, a
 * preview — the placeholder states what is true of the placement instead and
 * asserts nothing about installation.
 */
export function placeholderText(listingId: string | undefined): string {
  if (!listingId) return 'Plugin — pick an installed plugin'
  const known = Aglyn.getKnownPluginInstall(listingId)
  if (known) {
    const name = known.displayName || 'Plugin'
    return known.scope === 'org'
      ? `${name} — installed org-wide; renders on the published site`
      : `${name} — renders on the published site`
  }
  return Aglyn.hasKnownPluginInstalls()
    ? 'Plugin — not installed on this site'
    : 'Plugin — renders on the published site'
}

/**
 * Marketplace plugin element (AGL-45): a placement for an installed executable
 * plugin. The saved node carries only `listingId`; the tenant compose pass
 * (`attachPluginInstalls`) injects the pinned version/sha256/capabilities +
 * kill-switch state, and this renders them through the sandboxed
 * `PluginFrame`. Without a resolved install (the editor canvas, or an
 * uninstalled listing) it shows an inert placeholder — plugins never
 * execute in the editor. The plugin origin is a NEXT_PUBLIC env so it's
 * available in the browser bundle; unset = plugins disabled (placeholder).
 */
const MarketplacePlugin = forwardRef<HTMLElement, MarketplacePluginProps>(
  (props, ref) => {
    const {
      listingId,
      elementId,
      version,
      sha256,
      capabilities,
      revoked,
      pluginProps,
      pluginPropsJson,
      ...rest
    } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    // Merge authored settings (AGL-192) under any compose-injected props;
    // PluginFrame filters the result to the manifest allowlist.
    const resolvedPluginProps = {
      ...(pluginProps ?? {}),
      ...(parsePluginPropsJson(pluginPropsJson) ?? {}),
    }
    const pluginOrigin =
      typeof process !== 'undefined'
        ? // Dot notation (AGL-2037) — a client component; the bracket
          // form reads undefined in the browser.
          process.env.NEXT_PUBLIC_PLUGIN_ORIGIN
        : undefined
    // Host id for host-mediated fetch (AGL-191); empty in the editor.
    const { hostId } = Aglyn.useSite()

    // No resolved install (editor canvas / uninstalled): inert placeholder.
    if (!listingId || !version || !sha256) {
      return (
        <Box
          ref={ref as any}
          {...rest}
          sx={[
            {
              minHeight: 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              color: 'text.secondary',
              fontSize: 13,
              fontFamily: 'system-ui, sans-serif',
              p: 2,
              textAlign: 'center',
            },
            ...nodeSx,
          ]}
        >
          {placeholderText(listingId)}
        </Box>
      )
    }

    return (
      <PluginFrame
        ref={ref as any}
        pluginOrigin={pluginOrigin}
        hostId={hostId}
        listingId={listingId}
        elementId={elementId}
        version={version}
        sha256={sha256}
        capabilities={capabilities}
        pluginProps={resolvedPluginProps}
        revoked={revoked}
      />
    )
  },
)
MarketplacePlugin.displayName = 'AglynMarketplacePlugin'

export const schema: Aglyn.ComponentSchema<MarketplacePluginProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Plugin',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiPuzzle.path, sx: { color: '#5e35b1' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'listingId',
      // A picker over what is actually installed (AGL-1030), not a typed
      // document id: a mistyped character used to produce an element that
      // looked broken with no clue why. The old helper text also pointed at
      // "Manage → Plugins", a path AGL-1011 removed (AGL-1029).
      description:
        'Which installed plugin to place here. The sandboxed plugin renders ' +
        'in an isolated iframe region on the published site.',
      component: Aglyn.FieldComponentType.PLUGIN_SELECT,
      label: 'Plugin',
    },
    {
      name: 'pluginPropsJson',
      description:
        'Only what this plugin declares in its manifest is offered here, so ' +
        'what you set is what it receives. "Edit as JSON" covers anything a ' +
        'declaration does not.',
      // Was a raw JSON textarea (AGL-1049): authors guessed key names, and a
      // typo did not fail — `filterPluginProps` silently dropped it.
      component: Aglyn.FieldComponentType.PLUGIN_SETTINGS,
      label: 'Plugin settings',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Plugin',
    pluginId: BUNDLE_ID,
    description: 'Sandboxed marketplace plugin region',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiPuzzle.path, sx: { color: '#5e35b1' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

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

export default MarketplacePlugin
