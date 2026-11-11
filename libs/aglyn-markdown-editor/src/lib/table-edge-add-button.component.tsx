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

import AddIcon from '@mui/icons-material/Add'
import { alpha, ButtonBase, Tooltip } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { MouseEvent } from 'react'

export interface TableEdgeAddButtonProps {
  /**
   * `row` is the bar along a table's bottom edge, which adds a row; `column`
   * is the bar down its right edge, which adds a column.
   */
  edge: 'row' | 'column'
  onClick: () => void
  /** Tooltip and accessible name. Defaults to "Add row" / "Add column". */
  label?: string
  sx?: SxProps<Theme>
}

/**
 * The "+" bar along a table's edge, shared by every table an author edits
 * in place: a Markdown block's table and the Table element on the canvas.
 *
 * Always shown, never only on hover. A control an author has to know to
 * hover for is one they report as missing, which is how this came about.
 *
 * It never takes focus on press. Each table it sits beside is being typed
 * into, and a press that moved focus would end that edit before the click
 * that adds the row arrived.
 */
export function TableEdgeAddButton(props: TableEdgeAddButtonProps) {
  const { edge, onClick, label, sx } = props
  const name = label ?? (edge === 'row' ? 'Add row' : 'Add column')
  return (
    <Tooltip title={name} placement={edge === 'row' ? 'bottom' : 'right'}>
      <ButtonBase
        aria-label={name}
        data-table-edge={edge}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          onClick()
        }}
        sx={[
          (theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            borderRadius: 1,
            border: '1px dashed',
            borderColor: alpha(theme.palette.primary.main, 0.45),
            bgcolor: 'background.paper',
            color: 'primary.main',
            transition: theme.transitions.create(
              ['background-color', 'border-color', 'color'],
              { duration: theme.transitions.duration.shortest },
            ),
            '&:hover, &.Mui-focusVisible': {
              bgcolor: 'primary.main',
              borderColor: 'primary.main',
              borderStyle: 'solid',
              color: 'primary.contrastText',
            },
            ...(edge === 'row'
              ? { width: '100%', height: 20 }
              : { width: 20, height: '100%', minHeight: 28 }),
          }),
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        <AddIcon sx={{ fontSize: 16 }} />
      </ButtonBase>
    </Tooltip>
  )
}

TableEdgeAddButton.displayName = 'TableEdgeAddButton'

export default TableEdgeAddButton
