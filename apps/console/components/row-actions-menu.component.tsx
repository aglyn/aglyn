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

import {
  AppLink,
  MdiIcon,
  type AppLinkNakedLinkProps,
} from '@aglyn/shared-ui-jsx'
import { mdiDotsVertical } from '@aglyn/shared-data-mdi'
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material'
import {
  forwardRef,
  useCallback,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'

export interface RowActionsMenuItem {
  key: string
  label: string
  icon?: ReactNode
  /**
   * Where the item navigates. An item that carries one renders as a real
   * anchor, so it can be middle-clicked into a new tab, copied, or opened
   * from the browser's own context menu — the affordances a click handler
   * cannot offer however faithfully it calls `router.push`.
   */
  href?: string
  /** `href` leaves the console, so it opens in a new tab. */
  external?: boolean
  /** For items that open a dialog rather than navigate. */
  onClick?: () => void
  /** Renders the row in the error colour, for destructive actions. */
  destructive?: boolean
  disabled?: boolean
  /**
   * Why the item cannot be used, shown as its tooltip. Mirrors the quick
   * action's `unavailableReason`: a control that is present but inert says
   * nothing on its own, and an absent one and an inapplicable one look alike.
   */
  disabledReason?: string
}

/**
 * The anchor a linked menu item renders as.
 *
 * `naked` is the variant that adds no styling of its own — the MenuItem it is
 * the root of already resets colour and text-decoration, so a linked item is
 * pixel-identical to a handler-driven one.
 */
const MenuItemLinkComponent = forwardRef<any, AppLinkNakedLinkProps>(
  (props, ref) => <AppLink ref={ref} {...props} componentVariant={'naked'} />,
)
MenuItemLinkComponent.displayName = 'MenuItemLinkComponent'

export interface RowActionsMenuProps {
  items: RowActionsMenuItem[]
  /** Distinguishes this row's menu for screen readers. */
  label?: string
}

/**
 * Overflow menu for a table row's secondary actions (AGL-701).
 *
 * The DataGrid lists get this from `GridActionsCellItem showInMenu`, but the
 * screens table is hand-rolled markup driven by a `renderRowActions`
 * render-prop, so `showInMenu` is not available to it and it needs a real
 * menu of its own.
 *
 * Every handler closes the menu first. Delete opens a confirmation, and a
 * menu left standing over that dialog reads as though the click missed.
 *
 * An item that names an `href` is an ANCHOR, not a handler — a navigation
 * action must be middle-clickable and copyable like any other link. It still
 * renders as a menu item: the anchor is the MenuItem's own root element, so
 * it inherits the item's colour, padding and focus ring rather than the
 * browser's link styling.
 */
export function RowActionsMenu(props: RowActionsMenuProps) {
  const { items, label } = props
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const handleOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    // The row itself opens the screen; without this the menu button would
    // navigate out from under the menu it just opened.
    event.stopPropagation()
    setAnchorEl(event.currentTarget)
  }, [])
  const handleClose = useCallback(() => setAnchorEl(null), [])
  if (!items.length) return null
  return (
    <>
      <IconButton
        size="small"
        aria-label={label ? `More actions for ${label}` : 'More actions'}
        aria-haspopup="true"
        onClick={handleOpen}
      >
        <MdiIcon path={mdiDotsVertical.path} size={0.8} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) => {
          // A disabled item is never a link: an anchor whose destination is
          // refused still navigates on a middle-click, which is the one route
          // around the disabled state that `pointer-events: none` misses.
          const linkProps =
            item.href && !item.disabled
              ? {
                  component: MenuItemLinkComponent,
                  href: item.href,
                  ...(item.external
                    ? { target: '_blank', rel: 'noreferrer' }
                    : {}),
                }
              : {}
          const menuItem = (
            <MenuItem
              key={item.key}
              {...(linkProps as any)}
              disabled={item.disabled}
              onClick={() => {
                handleClose()
                item.onClick?.()
              }}
            >
              {item.icon ? (
                <ListItemIcon
                  sx={item.destructive ? { color: 'error.main' } : undefined}
                >
                  {item.icon}
                </ListItemIcon>
              ) : null}
              <ListItemText
                slotProps={
                  item.destructive
                    ? { primary: { color: 'error.main' } }
                    : undefined
                }
              >
                {item.label}
              </ListItemText>
            </MenuItem>
          )
          // span: a disabled item takes no pointer events, so the tooltip
          // needs a wrapper that does. `MenuList` reads its items from
          // context rather than from its direct children, so the wrapper
          // costs nothing in keyboard navigation.
          return item.disabled && item.disabledReason ? (
            <Tooltip key={item.key} title={item.disabledReason}>
              <span>{menuItem}</span>
            </Tooltip>
          ) : (
            menuItem
          )
        })}
      </Menu>
    </>
  )
}

RowActionsMenu.displayName = 'RowActionsMenu'

export default RowActionsMenu
