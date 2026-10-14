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
 * The console's one menu row: the look of the besigner's File / Edit /
 * Insert menus, shared with every table row's ⋮ menu (Zach, 2026-10-10: "this
 * menu is supposed to use the menu item buttons, just like we have in the
 * besigner file menu").
 *
 * Only the LOOK lives here — the dense row, the leading icon, the label and
 * its second line, a trailing hint. Behaviour stays with each menu: the
 * besigner's menubar drives these rows through Base UI (the only module that
 * may import it), the row menu through MUI's `Menu`. Both render
 * {@link MenuRowContent} inside an element styled with {@link MENU_ROW_SX},
 * inside a popup styled with {@link MENU_POPUP_SX}, so the two cannot drift.
 */

import { MdiIcon, type MdiIconProps } from './mdi-icon/mdi-icon'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  ListItemIcon,
  type ListItemIconProps,
  ListItemText,
  type ListItemTextProps,
  Typography,
  type TypographyProps,
} from '@mui/material'
import { Fragment, isValidElement, type ReactNode } from 'react'

/**
 * MUI `MenuItem`'s dense variant, as a plain sx object so it can style a
 * `MenuItem` and a `ListItemButton` alike (MUI v9's `MenuItem` cannot live
 * inside another library's menu, so the menubar renders a `ListItemButton`).
 */
export const MENU_ROW_SX = {
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
  // Base UI marks the highlighted row with a data attribute — one state for
  // both the pointer and the keyboard. MUI's own hover / focus-visible
  // treatment covers the same ground for a `MenuItem`.
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
} as const

/** The popup's surface: flat paper on the surface colour, a soft shadow. */
export const MENU_POPUP_SX = {
  paddingY: 1,
  // Paper transitions `box-shadow` by default. Base UI reads a running
  // transition on the popup as a close animation and waits for
  // `transitionend` before unmounting — and box-shadow never changes here,
  // so that event never came: the closed menu stayed on screen holding focus.
  transition: 'none',
  filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
  backgroundColor: 'surface.main',
} as const

/** An mdi glyph (`{ path }`) or an already-rendered icon. */
export type MenuRowIcon = MdiIconProps | ReactNode

const isMdiIcon = (icon: unknown): icon is MdiIconProps =>
  Boolean(icon) &&
  typeof icon === 'object' &&
  !isValidElement(icon) &&
  typeof (icon as MdiIconProps).path === 'string'

/** Whether a row draws a leading icon at all. */
export const hasMenuRowIcon = (icon: unknown): boolean =>
  isMdiIcon(icon) ? Boolean(icon.path) : isValidElement(icon)

export interface MenuRowContentProps {
  icon?: MenuRowIcon
  /**
   * Keep the icon's column even when this row has no icon, so every label in
   * the menu starts at one left edge (AGL-1216). Pass whether ANY row of the
   * menu has an icon.
   */
  gutter?: boolean
  /** The label. */
  children?: ReactNode
  /** A second line under the label: where it goes, or why it is unavailable. */
  secondary?: ReactNode
  /** Trailing hint (a shortcut, usually) rendered right-aligned. */
  endIcon?: MenuRowIcon
  ListItemTextProps?: Partial<ListItemTextProps>
  ListItemIconProps?: Partial<ListItemIconProps>
  EndIconTypographyProps?: Partial<TypographyProps>
}

/** The inside of one menu row: leading icon, label, second line, hint. */
export function MenuRowContent(props: MenuRowContentProps) {
  const {
    icon,
    gutter = false,
    children,
    secondary,
    endIcon,
    ListItemTextProps: listItemTextProps,
    ListItemIconProps: listItemIconProps,
    EndIconTypographyProps: endIconTypographyProps,
  } = props
  const showIcon = hasMenuRowIcon(icon)
  return (
    <Fragment>
      {showIcon ? (
        <ListItemIcon {...listItemIconProps}>
          {isMdiIcon(icon) ? (
            <MdiIcon fontSize="small" {...icon} />
          ) : (
            (icon as ReactNode)
          )}
        </ListItemIcon>
      ) : gutter ? (
        <ListItemIcon {...listItemIconProps} />
      ) : null}
      <ListItemText
        secondary={secondary}
        {...listItemTextProps}
        // `inset`'s 56px never matched a dense icon column's 36px; the empty
        // icon column does the job whenever a sibling has an icon.
        inset={gutter ? false : listItemTextProps?.inset}
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
          {isMdiIcon(endIcon) ? (
            <MdiIcon fontSize="small" {...endIcon} />
          ) : (
            (endIcon as ReactNode)
          )}
        </Typography>
      )}
    </Fragment>
  )
}

MenuRowContent.displayName = 'MenuRowContent'
