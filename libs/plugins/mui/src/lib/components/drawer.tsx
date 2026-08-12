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
import type { SxProps } from '@mui/material/styles'
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

export type DrawerAnchor = 'left' | 'right' | 'top' | 'bottom'

/** All four edges MUI's Drawer supports. */
export const DRAWER_ANCHORS: DrawerAnchor[] = ['left', 'right', 'top', 'bottom']

/** Horizontal anchors are the ones the `width` setting applies to. */
export function isSideAnchor(anchor: unknown): boolean {
  return anchor !== 'top' && anchor !== 'bottom'
}

export interface DrawerElementProps {
  /** Which edge the drawer slides in from. */
  anchor?: DrawerAnchor
  /** CSS width of the open panel (default 280px). Side anchors only. */
  width?: string
  /**
   * Authored node styles, handed over by the renderer rather than typed into
   * an attribute — recomposed below so the panel's own sx is merged, not
   * replaced (AGL-1323 declared it; the merge predates it).
   */
  sx?: SxProps
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
 * True while the besigner canvas flags this leaf's subtree as holding the
 * current selection (AGL-571): the renderer stamps
 * `data-aglyn-selected-within` on a leaf whenever the node itself or any
 * descendant is selected, and drops it when selection leaves the subtree.
 * Live surfaces never set it, so absence simply means "render collapsed" —
 * the same neutral `data-aglyn*` leaf contract `parseLeafNodeId` reads.
 */
export function isLeafSelectedWithin(rest: Record<string, unknown>): boolean {
  return rest['data-aglyn-selected-within'] != null
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
 * The canvas marker's box (AGL-1236). A drawer is a portal — it contributes
 * nothing to the layout of the row it sits in — and on the canvas it has to
 * cost exactly as little.
 *
 * `position: absolute` is doing the real work, and zero-sizing alone was not
 * enough: a zero-WIDTH flex child is still a flex child, so the nav's
 * `justify-content: space-between` kept it as a distribution point and its
 * `gap: 24px` still applied on both sides — which pushed START FREE in off
 * the right edge for an element that renders nowhere near it. Out of flow,
 * the row lays out exactly as it ships.
 *
 * The visible chip is `fixed` to the canvas frame, so it no longer matters
 * that an abspos flex child takes its static position from the container's
 * justify-content (that is what once parked the chip on top of the logo).
 */
const MARKER_SX = {
  position: 'absolute',
  width: 0,
  height: 0,
  overflow: 'visible',
  m: 0,
  p: 0,
} as const

/**
 * Slide-in drawer (AGL-562): a canvas children slot that opens from the
 * page edge — the mobile-menu building block. Opens/closes/toggles via
 * the shared window event bus (`dispatchDrawerCommand`), reachable from
 * the interactions system's drawer steps and the Menu Button element.
 * SSR ships it closed; the canvas shows a slim collapsed placeholder that
 * expands its contents inline only while the drawer or one of its
 * descendants is selected (AGL-571) — full drawer designability is
 * AGL-572.
 */
const DrawerElement = forwardRef<HTMLDivElement, DrawerElementProps>(
  (props, ref) => {
    const { anchor, width, children, sx, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
    const resolvedAnchor: DrawerAnchor = DRAWER_ANCHORS.includes(
      anchor as DrawerAnchor,
    )
      ? (anchor as DrawerAnchor)
      : 'left'
    // A top/bottom sheet spans the viewport; a width would pin it to a
    // narrow strip against the edge, which is never what was meant.
    const sideAnchored = isSideAnchor(resolvedAnchor)
    const { editorInert } = Aglyn.useScreenLink(undefined)
    const [open, setOpen] = useState(false)
    // The renderer stamps the node id on every leaf; commands target it.
    const nodeId = useMemo(
      () => parseLeafNodeId((rest as Record<string, unknown>)['data-aglyn']),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [(rest as Record<string, unknown>)['data-aglyn']],
    )

    useEffect(() => {
      if (editorInert || !nodeId) return undefined
      mountedDrawers.push(nodeId)
      const unsubscribe = Aglyn.subscribeDrawerCommands((detail) => {
        // Match on the un-namespaced suffix (AGL-573): an interaction
        // authored on a layout-scoped drawer stores the raw canvas id
        // while this drawer's live id is `layout__`-namespaced (or vice
        // versa) — leafIdsMatch compares them equal without re-authoring.
        const targeted = detail.nodeId
          ? Aglyn.leafIdsMatch(detail.nodeId, nodeId)
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
    }, [editorInert, nodeId])

    if (editorInert) {
      // Editor affordance: a selectable marker mirroring the live
      // hidden-until-opened drawer (AGL-571). While the drawer or a
      // descendant is selected, the contents expand inline as a real
      // design surface sized to the configured width with the live
      // panel's padding (AGL-572), so links and headers render full size.
      const authoring = isLeafSelectedWithin(rest as Record<string, unknown>)
      if (authoring) {
        // Selected: render the panel the way it actually opens — an overlay
        // pinned to its anchor edge, at the configured width, with the same
        // padding and close row as the live drawer (AGL-1236). It used to be
        // an inline block in the parent's flow, so selecting it shoved the
        // nav row apart and showed a column that looked nothing like the
        // panel that ships. Zero-size wrapper + `fixed` child, so the design
        // surface behind it is untouched while it is open.
        const edge = { left: 0, right: 0, top: 0, bottom: 0 }
        const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const
        delete (edge as Record<string, number>)[opposite[resolvedAnchor]]
        return (
          <Box
            ref={ref}
            {...rest}
            sx={MARKER_SX}
          >
            <Box
              sx={[
                {
                  position: 'fixed',
                  ...edge,
                  zIndex: 3,
                  overflowY: 'auto',
                  backgroundColor: 'background.paper',
                  boxShadow: 16,
                },
                sideAnchored
                  ? { width: width || 280, maxWidth: '90vw', p: 2 }
                  : { width: 'auto', p: 2 },
                ...nodeSx,
              ]}
            >
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
                <IconButton aria-label="Close menu" size="small" disabled>
                  <MdiIcon path={mdiClose.path} />
                </IconButton>
              </Stack>
              {children}
            </Box>
          </Box>
        )
      }
      // Unselected: a ZERO-SIZE anchor in flow, with its chip lifted out of
      // the design surface to the canvas's top-right (AGL-1236).
      //
      // A drawer is a portal — on the live site it contributes nothing to
      // the layout of the row it sits in — so a placeholder that consumed
      // 280px made the canvas disagree with the page it renders: the
      // marketing nav's logo collapsed and overlapped the first link.
      //
      // Two things were needed, and the first alone was not enough.
      // Absolute positioning on the marker itself takes its static position
      // from the flex container's justify-content, so under `space-between`
      // it jumped to the START of the row and sat on top of the logo. The
      // marker is therefore a zero-size in-flow box — correct place in the
      // row, no reserved space — and the chip is `fixed` to the top-right
      // of the canvas so it never covers content at all.
      //
      // Author `sx` deliberately does NOT apply here: on the live site
      // those styles land on the panel body, which is not on screen while
      // the drawer is closed. Applying `width: 280` to the marker would put
      // the footprint straight back.
      return (
        <Box
          ref={ref}
          {...rest}
          sx={MARKER_SX}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              // `fixed` resolves against the canvas viewport frame (it is a
              // containing block), so a negative top puts the chip in the
              // gutter ABOVE the design surface rather than over it.
              position: 'fixed',
              top: -26,
              insetInlineEnd: 0,
              zIndex: 2,
              px: 0.75,
              py: 0.25,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              backgroundColor: 'background.paper',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
              opacity: 0.85,
            }}
          >
            {`Drawer · ${resolvedAnchor}`}
          </Typography>
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
        <Box
          sx={[
            sideAnchored
              ? { width: width || 280, maxWidth: '90vw', p: 2 }
              : { width: 'auto', p: 2 },
            ...nodeSx,
          ]}
        >
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
 * values neither retarget the click nor leak into the DOM. Inert on the
 * static canvas so canvas clicks only select; live (incl. Preview) it toggles.
 */
export const DrawerToggle = forwardRef<HTMLButtonElement, DrawerToggleProps>(
  (props, ref) => {
    const { targetNodeId: _ignoredLegacyBinding, ariaLabel, ...rest } = props
    const { editorInert } = Aglyn.useScreenLink(undefined)
    return (
      <IconButton
        ref={ref}
        color="inherit"
        aria-label={ariaLabel || 'Open menu'}
        onClick={
          editorInert ? undefined : () => Aglyn.dispatchDrawerCommand('toggle')
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
      // `left` is one of MUI's four anchors and the value `resolvedAnchor`
      // already falls back to, so the sentinel is real (AGL-1451). Spelled
      // `''` it could not persist (AGL-1191), which meant a drawer moved to
      // the right could never be moved back.
      options: [
        { value: 'left', label: 'Left (default)' },
        { value: 'right', label: 'Right' },
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
    {
      name: 'width',
      description:
        'Width of the open drawer, e.g. 280px or 20rem. Top and ' +
        'bottom drawers span the viewport instead.',
      component: Aglyn.FieldComponentType.CSS_DIMENSION,
      label: 'Width',
      // A width on a top/bottom sheet is ignored by the renderer, so the
      // control is hidden rather than left to do nothing.
      condition: { when: 'anchor', is: ['top', 'bottom'], notMatch: true },
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
  props: { spacing: 1 },
  // On the node's own sx, not in props (AGL-1346): `props.sx` renders but
  // the Styles panel cannot edit or clear it.
  sx: { alignItems: 'stretch' },
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
      props: { direction: 'row', spacing: 1 },
      sx: { alignItems: 'center' },
      nodes: [
        {
          $id: null,
          componentId: DRAWER_TOGGLE_ID,
          pluginId: BUNDLE_ID,
          props: { ariaLabel: 'Open menu' },
          // Hidden where the inline links show. On `sx`, which is what the
          // panel's Visibility switches read and write (AGL-1346) — in
          // `props.sx` this band was invisible to the very control the
          // comment below promises authors can adjust it with.
          sx: {
            [Aglyn.VISIBILITY_BAND_MEDIA.desktop]: { display: 'none' },
          },
        },
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { direction: 'row', spacing: 1 },
          sx: {
            [Aglyn.VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' },
            [Aglyn.VISIBILITY_BAND_MEDIA.tablet]: { display: 'none' },
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
