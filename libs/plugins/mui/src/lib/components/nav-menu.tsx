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
import { mdiChevronDown, mdiFormDropdown, mdiViewGridOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box, { type BoxProps } from '@mui/material/Box'
import Button from '@mui/material/Button'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { SxProps } from '@mui/material/styles'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { isLeafSelectedWithin, parseLeafNodeId } from './drawer'

// Component ids are persisted in screen documents; never rename.
export const NAV_MENU_ID: Aglyn.ComponentId = 'muiNavMenu'
export const MEGA_MENU_ID: Aglyn.ComponentId = 'muiMegaMenu'

export type MegaMenuPanelWidth = 'auto' | 'wide' | 'full'

/** Hover close grace period so the pointer can cross into the panel. */
const HOVER_CLOSE_DELAY_MS = 150

export interface NavMenuProps {
  /** Visible trigger text of the nav item. */
  label?: string
  children?: ReactNode
}

export interface MegaMenuProps {
  label?: string
  /** Panel width preset: content-sized, wide (720px), or full-bleed. */
  panelWidth?: MegaMenuPanelWidth
  children?: ReactNode
}

/**
 * Mounted menus in mount order (AGL-568). Broadcast commands (no target
 * node id) are answered by the FIRST registered menu only, mirroring the
 * drawer bus, so a page with one menu needs no wiring at all.
 */
const mountedMenus: string[] = []

/**
 * The panel sx per mega-menu width preset. Wide/full center under the
 * trigger with the 50%/translate trick, so no measuring is needed and
 * SSR markup is stable.
 */
export function megaMenuPanelSx(panelWidth: MegaMenuPanelWidth): SxProps {
  switch (panelWidth) {
    case 'full':
      return {
        width: '100vw',
        maxWidth: '100vw',
        left: '50%',
        transform: 'translateX(-50%)',
        borderRadius: 0,
      }
    case 'wide':
      return {
        width: 'min(90vw, 720px)',
        left: '50%',
        transform: 'translateX(-50%)',
      }
    default:
      return { minWidth: 280, left: 0 }
  }
}

/**
 * Shared dropdown shell (AGL-562, interactions-driven since AGL-568): a
 * trigger button plus an absolutely positioned panel inside a relative
 * wrapper. Keeping the panel inside the wrapper's DOM (no portal) makes
 * pointer leave of trigger + panel a single mouseleave and keeps SSR
 * hydration trivial — the panel simply isn't rendered until opened, so
 * the server ships a closed menu.
 *
 * Open/close behavior: clicking the trigger toggles the menu (the
 * zero-config default), and the interactions system drives it over the
 * menu command bus (`dispatchMenuCommand`) keyed by node id — e.g. "On
 * hover → Open menu (this element)". Hover-opened menus close on their
 * own when the pointer leaves the trigger + panel surface (with a short
 * grace period); click/command opens stay put until click-away, Escape,
 * or an explicit close.
 *
 * On editing surfaces (besigner canvas, preview — flagged by
 * ScreenLinkContext.suppressNavigation) the menu mirrors the live site's
 * collapsed state: just the trigger, no panel (AGL-571). Only while the
 * menu or one of its descendants is selected (the renderer stamps
 * `data-aglyn-selected-within` on the leaf) does the panel expand
 * inline, like form fields do, so its contents stay selectable and
 * editable without fighting a popup — and it collapses again the moment
 * selection leaves the subtree.
 */
interface MenuShellProps extends BoxProps {
  label: string
  editorHint: string
  panelSx: SxProps
}

const MenuShell = forwardRef<HTMLDivElement, MenuShellProps>((props, ref) => {
  const { label, editorHint, panelSx, sx, children, ...rest } = props
  // Node styles ride the sx prop the renderer merges; keep them by
  // composing with the shell's own layout sx (stack.ts pattern).
  const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
  const { suppressNavigation } = Aglyn.useScreenLink(undefined)
  const [open, setOpen] = useState(false)
  // True while the menu is open BECAUSE a hover interaction opened it —
  // only then does pointer leave close the menu.
  const hoverOpenRef = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The renderer stamps the node id on every leaf; commands target it.
  const nodeId = useMemo(
    () => parseLeafNodeId((rest as Record<string, unknown>)['data-aglyn']),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(rest as Record<string, unknown>)['data-aglyn']],
  )

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const closeNow = useCallback(() => {
    cancelClose()
    hoverOpenRef.current = false
    setOpen(false)
  }, [cancelClose])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(closeNow, HOVER_CLOSE_DELAY_MS)
  }, [cancelClose, closeNow])

  // Menu command bus enrollment (AGL-568): mirrors the drawer exactly —
  // live surfaces only, keyed by node id, broadcasts answered by the
  // first mounted menu.
  useEffect(() => {
    if (suppressNavigation || !nodeId) return undefined
    mountedMenus.push(nodeId)
    const unsubscribe = Aglyn.subscribeMenuCommands((detail) => {
      // Match on the un-namespaced suffix (AGL-573): a command authored on
      // a layout-scoped menu carries the raw canvas id while this menu's
      // live id is `layout__`-namespaced (or vice versa) — leafIdsMatch
      // compares them equal without re-authoring the persisted action.
      const targeted = detail.nodeId
        ? Aglyn.leafIdsMatch(detail.nodeId, nodeId)
        : mountedMenus[0] === nodeId
      if (!targeted) return
      cancelClose()
      if (detail.command === 'close') {
        hoverOpenRef.current = false
        setOpen(false)
        return
      }
      // open/toggle: remember hover provenance so pointer leave closes
      // hover-opened menus (and never click/command-opened ones).
      hoverOpenRef.current = Boolean(detail.hover)
      if (detail.command === 'open') setOpen(true)
      else setOpen((value) => !value)
    })
    return () => {
      unsubscribe()
      cancelClose()
      const index = mountedMenus.indexOf(nodeId)
      if (index >= 0) mountedMenus.splice(index, 1)
    }
  }, [suppressNavigation, nodeId, cancelClose])

  if (suppressNavigation) {
    // Editor affordance (AGL-571): collapsed trigger by default — exactly
    // what the live site shows — expanding to inline, editable panel
    // contents only while the menu subtree holds the selection.
    const authoring = isLeafSelectedWithin(rest as Record<string, unknown>)
    return (
      <Box ref={ref} {...rest} sx={[{ display: 'inline-block' }, ...nodeSx]}>
        <Button
          color="inherit"
          aria-expanded={authoring || undefined}
          endIcon={<MdiIcon path={mdiChevronDown.path} />}
        >
          {label}
        </Button>
        {authoring ? (
          <Box
            sx={{
              m: 0.5,
              p: 1,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.5 }}
            >
              {editorHint}
            </Typography>
            {children}
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <ClickAwayListener onClickAway={() => open && closeNow()}>
      <Box
        ref={ref}
        {...rest}
        // Hover-close choreography (AGL-568): the panel renders inside
        // this wrapper (no portal), so trigger + panel share one
        // enter/leave pair. Only hover-opened menus follow the pointer
        // out; enter always cancels a pending close so the pointer can
        // travel between trigger and panel.
        onMouseEnter={cancelClose}
        onMouseLeave={() => {
          if (hoverOpenRef.current) scheduleClose()
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Escape') closeNow()
        }}
        sx={[{ position: 'relative', display: 'inline-flex' }, ...nodeSx]}
      >
        <Button
          color="inherit"
          aria-haspopup="true"
          aria-expanded={open || undefined}
          endIcon={<MdiIcon path={mdiChevronDown.path} />}
          onClick={() => {
            // Zero-config default: the trigger click-toggles its menu;
            // a click also "pins" a hover-opened menu.
            cancelClose()
            hoverOpenRef.current = false
            setOpen((value) => !value)
          }}
        >
          {label}
        </Button>
        {open ? (
          <Paper
            elevation={4}
            aria-label={label}
            sx={[
              {
                position: 'absolute',
                top: '100%',
                zIndex: (theme) => theme.zIndex.modal,
                p: 1,
              },
              panelSx as never,
            ]}
          >
            {children}
          </Paper>
        ) : null}
      </Box>
    </ClickAwayListener>
  )
})
MenuShell.displayName = 'AglynMenuShell'

/**
 * Strips the pre-AGL-568 "Open on" attribute persisted docs may still
 * carry. Behavior configuration rides the interactions system now; the
 * stored value is ignored silently — no migrations, no warnings — and
 * must never leak onto the DOM.
 */
function stripLegacyTrigger(rest: Record<string, unknown>): void {
  delete rest['trigger']
}

/**
 * Dropdown nav item (AGL-562): a labeled nav button whose children —
 * screen links, buttons, anything — open in a dropdown panel. Clicking
 * the trigger toggles it; interactions drive it over the menu command
 * bus (AGL-568). SSR ships the menu closed; no window access happens at
 * render.
 */
const NavMenu = forwardRef<HTMLDivElement, NavMenuProps>((props, ref) => {
  const { label, children, ...rest } = props
  stripLegacyTrigger(rest as Record<string, unknown>)
  return (
    <MenuShell
      ref={ref}
      label={label || 'Menu'}
      editorHint="Dropdown items — shown in a menu on the live site"
      panelSx={{ minWidth: 220, left: 0 }}
      {...rest}
    >
      <Stack spacing={0.5} sx={{ alignItems: 'stretch' }}>
        {children}
      </Stack>
    </MenuShell>
  )
})
NavMenu.displayName = 'AglynNavMenu'

/**
 * Mega menu (AGL-562): a SaaS-style wide panel anchored under a nav
 * item with a free-form canvas slot — columns of links, promos,
 * whatever the author drops in. Click-toggles like the dropdown; the
 * SaaS hover-open convention is one interaction away ("On hover → Open
 * menu", AGL-568) and then closes itself on pointer leave.
 */
export const MegaMenu = forwardRef<HTMLDivElement, MegaMenuProps>(
  (props, ref) => {
    const { label, panelWidth, children, ...rest } = props
    stripLegacyTrigger(rest as Record<string, unknown>)
    return (
      <MenuShell
        ref={ref}
        label={label || 'Menu'}
        editorHint="Mega menu panel — opens under the nav item on the live site"
        panelSx={{ p: 3, ...megaMenuPanelSx(panelWidth || 'auto') } as never}
        {...rest}
      >
        {children}
      </MenuShell>
    )
  },
)
MegaMenu.displayName = 'AglynMegaMenu'

export const navMenuSchema: Aglyn.ComponentSchema<NavMenuProps> = {
  $id: NAV_MENU_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Dropdown Menu',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiFormDropdown.path, sx: { color: '#2196f3' } },
  // Open/close behavior deliberately has NO attribute (AGL-568): click
  // toggles by default and everything else is authored as an
  // interaction (e.g. "On hover → Open menu").
  attributes: [
    {
      name: 'label',
      description: 'Text on the nav item that opens the dropdown.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Label',
    },
  ],
}

export const megaMenuSchema: Aglyn.ComponentSchema<MegaMenuProps> = {
  $id: MEGA_MENU_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Mega Menu',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiViewGridOutline.path, sx: { color: '#2196f3' } },
  // Open/close behavior deliberately has NO attribute (AGL-568) — see
  // navMenuSchema.
  attributes: [
    {
      name: 'label',
      description: 'Text on the nav item that opens the panel.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Label',
    },
    {
      name: 'panelWidth',
      description: 'How wide the opened panel is.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Panel width',
      options: [
        { value: '', label: 'Fit content' },
        { value: 'wide', label: 'Wide (720px)' },
        { value: 'full', label: 'Full width' },
      ],
    },
  ],
}

const navLink = (label: string) => ({
  $id: null,
  componentId: 'muiScreenLink',
  pluginId: BUNDLE_ID,
  props: { children: label, color: 'inherit' },
})

const megaColumn = (title: string, links: string[]) => ({
  $id: null,
  componentId: 'muiStack',
  pluginId: BUNDLE_ID,
  props: { spacing: 0.5, sx: { minWidth: 180, alignItems: 'flex-start' } },
  nodes: [
    {
      $id: null,
      componentId: 'muiTypography',
      pluginId: BUNDLE_ID,
      props: { variant: 'overline', color: 'text.secondary', children: title },
    },
    ...links.map(navLink),
  ],
})

export const navMenuPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(NAV_MENU_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Dropdown Menu',
    pluginId: BUNDLE_ID,
    description: 'Nav item that opens a dropdown of links',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: navMenuSchema.icon,
    data: {
      $id: null,
      componentId: NAV_MENU_ID,
      pluginId: BUNDLE_ID,
      props: { label: 'More' },
      nodes: [navLink('About'), navLink('Blog'), navLink('Contact')],
    },
  },
  {
    $id: generatePresetId(MEGA_MENU_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Mega Menu',
    pluginId: BUNDLE_ID,
    description:
      'Wide panel with columns of links; add a hover interaction to ' +
      'open it on hover',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: megaMenuSchema.icon,
    data: {
      $id: null,
      componentId: MEGA_MENU_ID,
      pluginId: BUNDLE_ID,
      props: { label: 'Products', panelWidth: 'wide' },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: {
            direction: 'row',
            spacing: 4,
            sx: { flexWrap: 'wrap' },
          },
          nodes: [
            megaColumn('Shop', ['New arrivals', 'Best sellers', 'Sale']),
            megaColumn('Company', ['About', 'Careers', 'Press']),
            megaColumn('Support', ['Help center', 'Contact']),
          ],
        },
      ],
    },
  },
]

export default NavMenu
