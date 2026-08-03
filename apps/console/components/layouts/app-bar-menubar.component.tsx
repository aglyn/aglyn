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
 * The besigner app bar's FILE / EDIT / INSERT menus (AGL-1222).
 *
 * THIS IS THE ONLY MODULE IN THE REPOSITORY THAT MAY IMPORT `@base-ui/react`.
 * Base UI is pinned to an exact version and its parts are composed here and
 * nowhere else, so a breaking upgrade is a one-file change. Everything else
 * keeps talking to this component through the plain `items` data shape the
 * hand-rolled menus already used.
 *
 * What Base UI buys over the previous `Menu` + `MenuItem` clusters: roving
 * focus across the three triggers, hovering from an open menu onto a sibling
 * trigger switches menus, typeahead and arrow traversal that cross the
 * boundary of one menu, and Escape closing back onto its trigger.
 */

import { Menu } from '@base-ui/react/menu'
import { Menubar } from '@base-ui/react/menubar'
import { ICON_VARIANT_MENU_DOWN } from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Box,
  Button,
  Divider,
  ListItemButton,
  ListItemIcon,
  type ListItemIconProps,
  ListItemText,
  type ListItemTextProps,
  ListSubheader,
  Paper,
  Stack,
  Typography,
  type TypographyProps,
} from '@mui/material'
import { Fragment } from 'react'

/** Matches the paper height cap the hand-rolled menu used. */
const ITEM_HEIGHT = 48

/**
 * A dense `MenuItem` rebuilt on `ListItemButton`.
 *
 * MUI v9's `MenuItem` throws without a `MenuListContext` and takes its tab
 * index from `MenuList`'s roving-tabindex context, so it cannot live inside
 * another library's menu — and wrapping the popup in a `MenuList` to satisfy
 * it would put MUI's arrow-key and typeahead handlers in a fight with Base
 * UI's. `ListItemButton` is the same ButtonBase underneath with the same
 * hover / selected / disabled treatment and no menu context of its own; the
 * rest here is MenuItem's dense variant, copied.
 */
const ROW_SX = {
  typography: 'body2',
  minHeight: 32,
  flexGrow: 0,
  width: '100%',
  paddingY: 0.5,
  paddingX: 2,
  whiteSpace: 'nowrap',
  textAlign: 'left',
  textDecoration: 'none',
  color: 'inherit',
  // Base UI drives the highlight — one state for both the pointer and the
  // keyboard, so arrowing through a menu looks like hovering it.
  '&[data-highlighted]': { backgroundColor: 'action.hover' },
  '&[data-disabled]': {
    opacity: (theme: any) => theme.palette.action.disabledOpacity,
    cursor: 'default',
  },
  '& .MuiListItemIcon-root': { minWidth: 36 },
  '& .MuiListItemIcon-root svg': { fontSize: '1.25rem' },
  '& .MuiListItemText-root': { marginTop: 0, marginBottom: 0 },
  '& .MuiListItemText-inset': { paddingLeft: '36px' },
  '& + .MuiDivider-root': { marginTop: 1, marginBottom: 1 },
}

export interface AppBarMenubarRowProps {
  type?: 'item' | 'divider' | 'subheader'
  id?: string
  key?: string | number
  children?: JSX.Node
  icon?: MdiIconProps
  /** Trailing hint (a shortcut, usually) rendered right-aligned. */
  endIcon?: MdiIconProps | JSX.Node
  disabled?: boolean
  href?: string
  onClick?: (event: any) => void
  ListItemTextProps?: Partial<ListItemTextProps>
  ListItemIconProps?: Partial<ListItemIconProps>
  EndIconTypographyProps?: Partial<TypographyProps>
  [key: string]: any
}

export interface AppBarMenubarEntryProps {
  id?: string
  key?: string | number
  children?: JSX.Node
  icon?: MdiIconProps
  items?: AppBarMenubarRowProps[]
  [key: string]: any
}

export interface AppBarMenubarProps {
  entries?: AppBarMenubarEntryProps[]
}

/**
 * The trigger keeps the exact `Button` the hand-rolled nav rendered — same
 * colour, same start icon, same chevron — so nothing about the bar moves.
 */
const renderTrigger = (icon: MdiIconProps | undefined, rest: any) => (
  <Button
    color="inherit"
    startIcon={!icon?.path ? icon : <MdiIcon {...icon} />}
    endIcon={<MdiIcon path={ICON_VARIANT_MENU_DOWN.path} />}
    {...rest}
    sx={mergeSxProps(
      {
        '& .MuiButton-endIcon': { marginLeft: 0 },
        '& .MuiButton-endIcon>*:nth-of-type(1)': { fontSize: `1.7em` },
      },
      rest?.sx,
    )}
  />
)

const renderRow = (row: AppBarMenubarRowProps, i: number, hasAnyIcon: boolean) => {
  const {
    type,
    id,
    key: keyProp,
    children,
    icon,
    endIcon,
    disabled,
    href,
    onClick,
    ListItemTextProps: listItemTextProps,
    ListItemIconProps: listItemIconProps,
    EndIconTypographyProps: endIconTypographyProps,
    component,
    componentVariant,
    ...rest
  } = row
  const key = keyProp ?? id ?? i

  if (type === 'divider') {
    // `Menu.Separator` renders a div, so the Divider has to be one too — an
    // <hr> inside a role="menu" is not a thing Base UI will place.
    return (
      <Menu.Separator
        key={key}
        render={<Divider component="div" />}
        {...(rest as any)}
      />
    )
  }

  if (type === 'subheader') {
    return (
      <ListSubheader key={key} component="div" {...(rest as any)}>
        {children}
      </ListSubheader>
    )
  }

  // One left edge per menu (AGL-1216): a row without an icon still gets the
  // icon gutter when any sibling row has one, and `inset` — whose 56px never
  // matched a dense ListItemIcon's 36px — stands down while the spacer is
  // doing the job.
  const body = (
    <Fragment>
      {icon?.path ? (
        <ListItemIcon {...listItemIconProps}>
          <MdiIcon fontSize="small" {...icon} />
        </ListItemIcon>
      ) : hasAnyIcon ? (
        <ListItemIcon {...listItemIconProps} />
      ) : null}
      <ListItemText
        {...listItemTextProps}
        inset={hasAnyIcon ? false : listItemTextProps?.inset}
      >
        {children}
      </ListItemText>
      {!endIcon ? null : (
        <Typography
          variant="body2"
          {...endIconTypographyProps}
          sx={mergeSxProps(
            { color: 'text.secondary' },
            endIconTypographyProps?.sx,
          )}
        >
          {!(endIcon as MdiIconProps)?.path ? (
            (endIcon as JSX.Node)
          ) : (
            <MdiIcon fontSize="small" {...(endIcon as MdiIconProps)} />
          )}
        </Typography>
      )}
    </Fragment>
  )

  const rowSx = mergeSxProps(ROW_SX, (rest as any)?.sx)

  if (href) {
    // Base UI's link item renders an <a href>, which MUI's ButtonBase also
    // recognises as natively activatable, so exactly one of them turns Enter
    // into a click. `closeOnClick` is false by default on link items and the
    // menu this replaces always closed.
    return (
      <Menu.LinkItem
        key={key}
        id={id}
        closeOnClick
        render={
          <ListItemButton
            component={component || AppLink}
            componentVariant={componentVariant || 'naked'}
            href={href}
            nativeButton={false}
            {...(rest as any)}
            sx={rowSx}
          />
        }
      >
        {body}
      </Menu.LinkItem>
    )
  }

  // A native <button> on both sides. Base UI and MUI each synthesise an
  // Enter/Space click for NON-native elements, so a div row would run every
  // command twice; a real button lets the browser fire it once. `disabled`
  // is Base UI's to enforce — a natively disabled button drops out of the
  // arrow-key walk, which is not how a menu should read.
  return (
    <Menu.Item
      key={key}
      id={id}
      disabled={disabled}
      onClick={onClick}
      render={
        <ListItemButton component="button" {...(rest as any)} sx={rowSx} />
      }
    >
      {body}
    </Menu.Item>
  )
}

const renderEntry = (entry: AppBarMenubarEntryProps, i: number) => {
  const {
    id,
    key: keyProp,
    children,
    icon,
    items,
    avatar: _avatar,
    MenuProps: menuProps,
    ...rest
  } = entry
  const key = keyProp ?? id ?? i

  // A plain (menu-less) center nav entry stays the plain button it was.
  if (!items?.length) {
    return (
      <Fragment key={key}>
        <Button
          id={id}
          color="inherit"
          startIcon={!icon?.path ? icon : <MdiIcon {...icon} />}
          {...(rest.href
            ? {
                component: AppLink,
                componentVariant: 'button',
                nativeButton: false,
              }
            : {})}
          {...(rest as any)}
        >
          {children}
        </Button>
      </Fragment>
    )
  }

  const hasAnyIcon = items.some((row) => (row as any)?.icon?.path)

  return (
    <Menu.Root key={key}>
      <Menu.Trigger id={id} render={renderTrigger(icon, rest)}>
        {children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={4}
          align="start"
          render={<Box sx={{ zIndex: 'modal' }} />}
        >
          <Menu.Popup
            render={
              <Paper
                elevation={0}
                sx={mergeSxProps(
                  {
                    maxHeight: ITEM_HEIGHT * 4.5,
                    width: '30ch',
                    overflowY: 'auto',
                    paddingY: 1,
                    filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                    backgroundColor: 'surface.main',
                    '&:before': {
                      content: '""',
                      display: 'block',
                      position: 'absolute',
                      top: 0,
                      left: 14,
                      width: 10,
                      height: 10,
                      bgcolor: 'surface.main',
                      transform: 'translateY(-50%) rotate(45deg)',
                      zIndex: 0,
                    },
                  },
                  menuProps?.sx,
                )}
              />
            }
          >
            {items.map((row, rowIndex) => renderRow(row, rowIndex, hasAnyIcon))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/**
 * `modal` is left at Base UI's default. In a menubar that renders a fixed
 * backdrop with a hole cut over the bar itself, which is what makes a click
 * anywhere — including over the besigner's canvas IFRAME, whose pointer
 * events never reach this document — close the open menu, while a pointer
 * moving between triggers still lands on them.
 */
export const AppBarMenubarComponent = (props: AppBarMenubarProps) => {
  const { entries } = props

  return (
    <Menubar
      render={
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'flex-start' }}
        />
      }
    >
      {(entries ?? []).map(renderEntry)}
    </Menubar>
  )
}

AppBarMenubarComponent.displayName = 'AppBarMenubarComponent'

export default AppBarMenubarComponent
