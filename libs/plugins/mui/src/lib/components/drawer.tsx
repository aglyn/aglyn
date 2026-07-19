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

import * as Aglyn from '@aglyn/aglyn'
import { mdiClose, mdiDockLeft, mdiMenu } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import MuiDrawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const DRAWER_ID: Aglyn.ComponentId = 'muiDrawer'
export const DRAWER_TOGGLE_ID: Aglyn.ComponentId = 'muiDrawerToggle'

export type DrawerAnchor = 'left' | 'right'

export interface DrawerElementProps {
  /** Which edge the drawer slides in from. */
  anchor?: DrawerAnchor
  /** CSS width of the open panel (default 280px). */
  width?: string
  children?: ReactNode
}

export interface DrawerToggleProps {
  /**
   * Legacy pre-AGL-572 binding attribute. Persisted values are accepted
   * and silently ignored (no migration): behavior config rides the
   * interactions system (AGL-568), so explicit targeting is authored as
   * *When clicked → Open/close a drawer* on the button instead.
   */
  targetNodeId?: string
  /** Accessible name for the icon button. */
  ariaLabel?: string
}

/**
 * The node id encoded in the renderer's stable `data-aglyn="leaf:<id>"`
 * attribute (the same selector contract the interactions system uses).
 */
export function parseLeafNodeId(dataAglyn: unknown): string | undefined {
  const match = /^leaf:(.+)$/.exec(String(dataAglyn ?? ''))
  return match?.[1] || undefined
}

/**
 * Mounted drawers in mount order. Broadcast commands (no target node id)
 * are answered by the FIRST registered drawer only, so a page with one
 * drawer — the overwhelmingly common case — needs no wiring at all.
 */
const mountedDrawers: string[] = []

/** Test seam: the current broadcast owner (first mounted drawer). */
export function firstMountedDrawer(): string | undefined {
  return mountedDrawers[0]
}

/**
 * Slide-in drawer (AGL-562): a canvas children slot that opens from the
 * page edge — the mobile-menu building block. Opens/closes/toggles via
 * the shared window event bus (`dispatchDrawerCommand`), reachable from
 * the interactions system's drawer steps and the Menu Button element.
 * SSR ships it closed; the canvas renders the contents expanded inline
 * so they stay editable.
 */
const DrawerElement = forwardRef<HTMLDivElement, DrawerElementProps>(
  (props, ref) => {
    const { anchor, width, children, sx, ...rest } = props as DrawerElementProps & {
      sx?: unknown
    }
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
    const resolvedAnchor: DrawerAnchor = anchor === 'right' ? 'right' : 'left'
    const { suppressNavigation } = Aglyn.useScreenLink(undefined)
    const [open, setOpen] = useState(false)
    // The renderer stamps the node id on every leaf; commands target it.
    const nodeId = useMemo(
      () => parseLeafNodeId((rest as Record<string, unknown>)['data-aglyn']),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [(rest as Record<string, unknown>)['data-aglyn']],
    )

    useEffect(() => {
      if (suppressNavigation || !nodeId) return undefined
      mountedDrawers.push(nodeId)
      const unsubscribe = Aglyn.subscribeDrawerCommands((detail) => {
        const targeted = detail.nodeId
          ? detail.nodeId === nodeId
          : mountedDrawers[0] === nodeId
        if (!targeted) return
        if (detail.command === 'open') setOpen(true)
        else if (detail.command === 'close') setOpen(false)
        else setOpen((value) => !value)
      })
      return () => {
        unsubscribe()
        const index = mountedDrawers.indexOf(nodeId)
        if (index >= 0) mountedDrawers.splice(index, 1)
      }
    }, [suppressNavigation, nodeId])

    if (suppressNavigation) {
      // Editor affordance: framed, always-visible contents (like form
      // fields) so the drawer stays authorable without opening anything.
      // The frame is a real design surface (AGL-572): sized to the
      // drawer's configured width with the live panel's padding, so
      // links and headers render full size and select comfortably.
      return (
        <Box
          ref={ref}
          {...rest}
          sx={[
            {
              m: 0.5,
              p: 2,
              width: width || 280,
              maxWidth: '100%',
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
            },
            ...nodeSx,
          ]}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.5 }}
          >
            {`Drawer (${resolvedAnchor}) — slides in on the live site`}
          </Typography>
          {children}
        </Box>
      )
    }

    return (
      <MuiDrawer
        ref={ref}
        {...rest}
        anchor={resolvedAnchor}
        open={open}
        onClose={() => setOpen(false)}
        variant="temporary"
      >
        {/* Node styles land on the panel body, where authors expect
            padding/background edits to show. */}
        <Box sx={[{ width: width || 280, maxWidth: '90vw', p: 2 }, ...nodeSx]}>
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
            <IconButton
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              size="small"
            >
              <MdiIcon path={mdiClose.path} />
            </IconButton>
          </Stack>
          {children}
        </Box>
      </MuiDrawer>
    )
  },
)
DrawerElement.displayName = 'AglynDrawer'

/**
 * Menu button (AGL-562, targeting moved to interactions in AGL-572): a
 * hamburger icon button whose click broadcast-toggles the page's first
 * drawer over the shared command bus — the zero-config default that
 * makes the one-insert Mobile Nav preset work. Targeting a specific
 * drawer is an interaction (*When clicked → Open/close a drawer*), the
 * same openDrawer/closeDrawer/toggleDrawer steps any element can use;
 * the legacy `targetNodeId` attribute is discarded here so persisted
 * values neither retarget the click nor leak into the DOM. Inert on
 * editing surfaces so canvas clicks only select.
 */
export const DrawerToggle = forwardRef<HTMLButtonElement, DrawerToggleProps>(
  (props, ref) => {
    const { targetNodeId: _ignoredLegacyBinding, ariaLabel, ...rest } = props
    const { suppressNavigation } = Aglyn.useScreenLink(undefined)
    return (
      <IconButton
        ref={ref}
        color="inherit"
        aria-label={ariaLabel || 'Open menu'}
        onClick={
          suppressNavigation
            ? undefined
            : () => Aglyn.dispatchDrawerCommand('toggle')
        }
        {...rest}
      >
        <MdiIcon path={mdiMenu.path} />
      </IconButton>
    )
  },
)
DrawerToggle.displayName = 'AglynDrawerToggle'

export const drawerSchema: Aglyn.ComponentSchema<DrawerElementProps> = {
  $id: DRAWER_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Drawer',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiDockLeft.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'anchor',
      description: 'Which edge of the page the drawer slides in from.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Slides in from',
      options: [
        { value: '', label: 'Left (default)' },
        { value: 'right', label: 'Right' },
      ],
    },
    {
      name: 'width',
      description: 'CSS width of the open drawer, e.g. 280px or 20rem.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Width',
    },
  ],
}

export const drawerToggleSchema: Aglyn.ComponentSchema<DrawerToggleProps> = {
  $id: DRAWER_TOGGLE_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Menu Button',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiMenu.path, sx: { color: '#2196f3' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  // No drawer-binding attribute (AGL-572): clicking toggles the page's
  // first drawer out of the box, and targeting a specific drawer is an
  // interaction (*When clicked → Open/close a drawer*), per the AGL-568
  // rule that behavior config rides interactions, not bespoke props.
  attributes: [
    {
      name: 'ariaLabel',
      description: 'Accessible name announced by screen readers.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Accessibility label',
    },
  ],
}

const navLink = (label: string) => ({
  $id: null,
  componentId: 'muiScreenLink',
  pluginId: BUNDLE_ID,
  props: { children: label, color: 'inherit' },
})

/** Vertical link stack every drawer preset starts from. */
const drawerLinkStack = {
  $id: null,
  componentId: 'muiStack',
  pluginId: BUNDLE_ID,
  props: { spacing: 1, sx: { alignItems: 'stretch' } },
  nodes: [navLink('Home'), navLink('About'), navLink('Contact')],
}

export const drawerPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(DRAWER_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Drawer',
    pluginId: BUNDLE_ID,
    description:
      'Slide-in panel with a vertical link stack; open it with a Menu ' +
      'Button or an interaction',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: drawerSchema.icon,
    data: {
      $id: null,
      componentId: DRAWER_ID,
      pluginId: BUNDLE_ID,
      props: {},
      nodes: [drawerLinkStack],
    },
  },
  {
    $id: generatePresetId(DRAWER_TOGGLE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Menu Button',
    pluginId: BUNDLE_ID,
    description: 'Hamburger icon button that opens a drawer',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: drawerToggleSchema.icon,
    data: {
      $id: null,
      componentId: DRAWER_TOGGLE_ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
  {
    // One-insert mobile navigation (AGL-562): hamburger (hidden on
    // desktop) wired to a drawer of links (link cluster hidden below
    // desktop). Media-band sx mirrors the styles panel's Visibility
    // control, so authors can adjust it there afterwards.
    $id: generatePresetId(DRAWER_ID, 'mobile-nav'),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Mobile Nav',
    pluginId: BUNDLE_ID,
    description:
      'Menu button plus drawer for small screens, with an inline link ' +
      'row on desktop — a working responsive nav in one insert',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiMenu.path, sx: { color: '#1976d2' } },
    data: {
      $id: null,
      componentId: 'muiStack',
      pluginId: BUNDLE_ID,
      props: {
        direction: 'row',
        spacing: 1,
        sx: { alignItems: 'center' },
      },
      nodes: [
        {
          $id: null,
          componentId: DRAWER_TOGGLE_ID,
          pluginId: BUNDLE_ID,
          props: {
            ariaLabel: 'Open menu',
            // Hidden where the inline links show.
            sx: {
              [Aglyn.VISIBILITY_BAND_MEDIA.desktop]: { display: 'none' },
            },
          },
        },
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: {
            direction: 'row',
            spacing: 1,
            sx: {
              [Aglyn.VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' },
              [Aglyn.VISIBILITY_BAND_MEDIA.tablet]: { display: 'none' },
            },
          },
          nodes: [navLink('Home'), navLink('About'), navLink('Contact')],
        },
        {
          $id: null,
          componentId: DRAWER_ID,
          pluginId: BUNDLE_ID,
          props: {},
          nodes: [drawerLinkStack],
        },
      ],
    },
  },
]

export default DrawerElement
