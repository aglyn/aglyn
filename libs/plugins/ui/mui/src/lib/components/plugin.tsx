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
import { mdiPuzzle } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { PluginFrame } from './plugin-frame'

// Component id is persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = Aglyn.PLUGIN_COMPONENT_ID

export interface CommunityPluginProps {
  /** Installed listing id; the only prop authors set. */
  listingId?: string
  /** Injected at compose by `attachPluginInstalls` (AGL-45). */
  version?: string
  sha256?: string
  capabilities?: Aglyn.PluginCapabilities
  revoked?: boolean
  /** Extra props forwarded to the plugin (filtered to its allowlist). */
  pluginProps?: Record<string, unknown>
}

/**
 * Community plugin element (AGL-45): a placement for an installed executable
 * plugin. The saved node carries only `listingId`; the tenant compose pass
 * (`attachPluginInstalls`) injects the pinned version/sha256/capabilities +
 * kill-switch state, and this renders them through the sandboxed
 * `PluginFrame`. Without a resolved install (the editor canvas, or an
 * uninstalled listing) it shows an inert placeholder — plugins never
 * execute in the editor. The plugin origin is a NEXT_PUBLIC env so it's
 * available in the browser bundle; unset = plugins disabled (placeholder).
 */
const CommunityPlugin = forwardRef<HTMLElement, CommunityPluginProps>(
  (props, ref) => {
    const {
      listingId,
      version,
      sha256,
      capabilities,
      revoked,
      pluginProps,
      ...rest
    } = props
    const pluginOrigin =
      typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_PLUGIN_ORIGIN']
        : undefined
    // Host id for host-mediated fetch (AGL-191); empty in the editor.
    const { hostId } = Aglyn.useSite()

    // No resolved install (editor canvas / uninstalled): inert placeholder.
    if (!listingId || !version || !sha256) {
      return (
        <Box
          ref={ref as any}
          {...rest}
          sx={{
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
          }}
        >
          {listingId
            ? 'Plugin — not installed on this site'
            : 'Plugin — pick an installed plugin'}
        </Box>
      )
    }

    return (
      <PluginFrame
        ref={ref as any}
        pluginOrigin={pluginOrigin}
        hostId={hostId}
        listingId={listingId}
        version={version}
        sha256={sha256}
        capabilities={capabilities}
        pluginProps={pluginProps}
        revoked={revoked}
      />
    )
  },
)
CommunityPlugin.displayName = 'AglynCommunityPlugin'

export const schema: Aglyn.ComponentSchema<CommunityPluginProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Plugin',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiPuzzle.path, sx: { color: '#5e35b1' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'listingId',
      description:
        'Installed community plugin id (Manage → Plugins). The sandboxed ' +
        'plugin renders in an isolated iframe region.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Plugin listing id',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Plugin',
    pluginId: BUNDLE_ID,
    description: 'Sandboxed community plugin region',
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
export const PLUGIN_DRAWER_CATEGORY = 'Community'

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
 * draggable drawer entry that drops a `communityPlugin` node with the
 * listing id pre-pinned, so editors never hand-type ids. Reuses the single
 * `communityPlugin` renderer — no per-plugin component registration. The
 * manifest's lineal rules ride on the node data for later enforcement.
 * Returns null for an install without a resolvable listing id.
 */
export function pluginInstallToPreset(
  install: PluginInstallLike,
): Aglyn.PresetSchema | null {
  const listingId = install.listingId ?? install.$id
  if (!listingId) return null
  const name =
    install.displayName || install.manifest?.name || 'Community plugin'
  return {
    $id: `plugin__${listingId}`,
    type: Aglyn.NodeType.PRESET,
    displayName: name,
    pluginId: BUNDLE_ID,
    description: 'Installed community plugin',
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

export default CommunityPlugin
