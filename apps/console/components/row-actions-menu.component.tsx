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

import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { mdiDotsVertical } from '@aglyn/shared-data-mdi'
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'

export interface RowActionsMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onClick: () => void
  /** Renders the row in the error colour, for destructive actions. */
  destructive?: boolean
  disabled?: boolean
}

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
        {items.map((item) => (
          <MenuItem
            key={item.key}
            disabled={item.disabled}
            onClick={() => {
              handleClose()
              item.onClick()
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
        ))}
      </Menu>
    </>
  )
}

RowActionsMenu.displayName = 'RowActionsMenu'

export default RowActionsMenu
