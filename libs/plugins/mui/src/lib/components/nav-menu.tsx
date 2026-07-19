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
  useRef,
  useState,
} from 'react'
import type { SxProps } from '@mui/material/styles'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const NAV_MENU_ID: Aglyn.ComponentId = 'muiNavMenu'
export const MEGA_MENU_ID: Aglyn.ComponentId = 'muiMegaMenu'

export type NavMenuTrigger = 'click' | 'hover'
export type MegaMenuPanelWidth = 'auto' | 'wide' | 'full'

/** Hover close grace period so the pointer can cross into the panel. */
const HOVER_CLOSE_DELAY_MS = 150

export interface NavMenuProps {
  /** Visible trigger text of the nav item. */
  label?: string
  /** How the dropdown opens (AGL-562); nav menus default to click. */
  trigger?: NavMenuTrigger
  children?: ReactNode
}

export interface MegaMenuProps {
  label?: string
  /** Mega menus follow the SaaS convention and default to hover. */
  trigger?: NavMenuTrigger
  /** Panel width preset: content-sized, wide (720px), or full-bleed. */
  panelWidth?: MegaMenuPanelWidth
  children?: ReactNode
}

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
 * Shared dropdown shell (AGL-562): a trigger button plus an absolutely
 * positioned panel inside a relative wrapper. Keeping the panel inside
 * the wrapper's DOM (no portal) makes hover open/close a single
 * mouseenter/mouseleave pair and keeps SSR hydration trivial — the panel
 * simply isn't rendered until opened, so the server ships a closed menu.
 *
 * On editing surfaces (besigner canvas, preview — flagged by
 * ScreenLinkContext.suppressNavigation) the children render expanded
 * inline instead, like form fields do, so menu contents stay selectable
 * and editable without fighting a popup.
 */
interface MenuShellProps extends BoxProps {
  label: string
  trigger: NavMenuTrigger
  editorHint: string
  panelSx: SxProps
}

const MenuShell = forwardRef<HTMLDivElement, MenuShellProps>((props, ref) => {
  const { label, trigger, editorHint, panelSx, sx, children, ...rest } = props
  // Node styles ride the sx prop the renderer merges; keep them by
  // composing with the shell's own layout sx (stack.ts pattern).
  const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
  const { suppressNavigation } = Aglyn.useScreenLink(undefined)
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS)
  }, [cancelClose])

  if (suppressNavigation) {
    // Editor affordance: trigger + inline, editable panel contents.
    return (
      <Box ref={ref} {...rest} sx={[{ display: 'inline-block' }, ...nodeSx]}>
        <Button color="inherit" endIcon={<MdiIcon path={mdiChevronDown.path} />}>
          {label}
        </Button>
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
      </Box>
    )
  }

  const hoverHandlers =
    trigger === 'hover'
      ? {
          onMouseEnter: () => {
            cancelClose()
            setOpen(true)
          },
          onMouseLeave: scheduleClose,
        }
      : {}

  const content = (
    <Box
      ref={ref}
      {...rest}
      {...hoverHandlers}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Escape') setOpen(false)
      }}
      sx={[{ position: 'relative', display: 'inline-flex' }, ...nodeSx]}
    >
      <Button
        color="inherit"
        aria-haspopup="true"
        aria-expanded={open || undefined}
        endIcon={<MdiIcon path={mdiChevronDown.path} />}
        onClick={
          trigger === 'hover' ? undefined : () => setOpen((value) => !value)
        }
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
  )

  // Click-away only matters for click-opened menus; hover menus close on
  // mouseleave. Wrapped unconditionally for that trigger so the tree
  // shape (and the mounted DOM) stays stable across open/close.
  if (trigger === 'click') {
    return (
      <ClickAwayListener onClickAway={() => open && setOpen(false)}>
        {content}
      </ClickAwayListener>
    )
  }
  return content
})
MenuShell.displayName = 'AglynMenuShell'

/**
 * Dropdown nav item (AGL-562): a labeled nav button whose children —
 * screen links, buttons, anything — open in a dropdown panel on click or
 * hover. SSR ships the menu closed; no window access happens at render.
 */
const NavMenu = forwardRef<HTMLDivElement, NavMenuProps>((props, ref) => {
  const { label, trigger, children, ...rest } = props
  return (
    <MenuShell
      ref={ref}
      label={label || 'Menu'}
      trigger={trigger === 'hover' ? 'hover' : 'click'}
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
 * Hover mega menu (AGL-562): a SaaS-style wide panel anchored under a
 * nav item with a free-form canvas slot — columns of links, promos,
 * whatever the author drops in.
 */
export const MegaMenu = forwardRef<HTMLDivElement, MegaMenuProps>(
  (props, ref) => {
    const { label, trigger, panelWidth, children, ...rest } = props
    return (
      <MenuShell
        ref={ref}
        label={label || 'Menu'}
        trigger={trigger === 'click' ? 'click' : 'hover'}
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

const TRIGGER_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'click', label: 'Click' },
  { value: 'hover', label: 'Hover' },
]

export const navMenuSchema: Aglyn.ComponentSchema<NavMenuProps> = {
  $id: NAV_MENU_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Dropdown Menu',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiFormDropdown.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'label',
      description: 'Text on the nav item that opens the dropdown.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Label',
    },
    {
      name: 'trigger',
      description:
        'How the dropdown opens on the live site: on click (default) or ' +
        'on hover.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Open on',
      options: TRIGGER_OPTIONS,
    },
  ],
}

export const megaMenuSchema: Aglyn.ComponentSchema<MegaMenuProps> = {
  $id: MEGA_MENU_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Mega Menu',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiViewGridOutline.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'label',
      description: 'Text on the nav item that opens the panel.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Label',
    },
    {
      name: 'trigger',
      description:
        'How the panel opens on the live site: on hover (default) or on ' +
        'click.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Open on',
      options: [
        { value: '', label: 'Default' },
        { value: 'hover', label: 'Hover' },
        { value: 'click', label: 'Click' },
      ],
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
    description: 'Hover-opened wide panel with columns of links',
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
