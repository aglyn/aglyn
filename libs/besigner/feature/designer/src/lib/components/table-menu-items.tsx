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

import type * as Aglyn from '@aglyn/aglyn'
import { canvas } from '@aglyn/aglyn'
import type { DataTableShapeEdit } from '@aglyn/shared-data-enums'
import { parseDataTableRows } from '@aglyn/shared-data-enums'
import {
  mdiTable,
  mdiTableColumnPlusAfter,
  mdiTableRowPlusAfter,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Divider, ListItemIcon, ListItemText, MenuItem } from '@mui/material'
import { toJS } from 'mobx'
import type { ReactElement } from 'react'
import type { CanvasContextMenuTableCell } from '../utils/canvas-context-menu'
import {
  dataTableCellActions,
  findDataTableAttributeName,
  withDataTableShapeEdit,
  withDataTableStarted,
} from '../utils/table-cell-edit'

/** Writes a Table's new props as one change: one undo entry. */
function writeTable(
  node: Aglyn.NodeSchema<any>,
  next: Record<string, unknown>,
): void {
  canvas.updateNodeProps(node, next as never)
}

function propsOf(node: Aglyn.NodeSchema<any>): Record<string, unknown> {
  return (toJS(node.props) ?? {}) as Record<string, unknown>
}

/**
 * The Table's own items for the element menu (AGL-4203): rows and columns,
 * edited where the author is looking instead of in the Attributes grid.
 *
 * Opened on a cell (a right-click), they are relative to it: insert above,
 * below, left or right, and delete its row or column. Opened anywhere else
 * (the ⋮ button), there is no cell to be relative to, so they append. An
 * empty Table has neither, and is offered the same starter the Attributes
 * grid writes.
 *
 * Returned as an ARRAY of items rather than a component: a `MenuList` reads
 * its children for keyboard focus, and refuses a Fragment.
 */
export function tableMenuItems(options: {
  node: Aglyn.NodeSchema<any> | undefined
  cell: CanvasContextMenuTableCell | null
  multi: boolean
  onAction?: () => void
}): ReactElement[] {
  const { node, cell, multi, onAction } = options
  const attribute = node && !multi ? findDataTableAttributeName(node) : undefined
  if (!node || !attribute) return []
  const stored = (node.props as Record<string, unknown> | undefined)?.[attribute]
  const grid = parseDataTableRows(stored)

  const reshape = (edit: DataTableShapeEdit) => () => {
    onAction?.()
    writeTable(node, withDataTableShapeEdit(propsOf(node), attribute, edit))
  }

  const items: ReactElement[] = []
  if (grid.length === 0) {
    items.push(
      <MenuItem
        key="table-start"
        onClick={() => {
          onAction?.()
          writeTable(node, withDataTableStarted(propsOf(node), attribute))
        }}
      >
        <ListItemIcon>
          <MdiIcon fontSize="inherit" path={mdiTable.path} />
        </ListItemIcon>
        <ListItemText>{'Start a table'}</ListItemText>
      </MenuItem>,
    )
  } else if (cell) {
    for (const action of dataTableCellActions(stored, cell.row, cell.column)) {
      items.push(
        <MenuItem
          key={`table-${action.key}`}
          disabled={action.disabled}
          onClick={reshape(action.edit)}
        >
          <ListItemIcon>
            <MdiIcon fontSize="inherit" path={action.icon} />
          </ListItemIcon>
          <ListItemText>{action.label}</ListItemText>
        </MenuItem>,
      )
    }
  } else {
    items.push(
      <MenuItem
        key="table-add-row"
        onClick={reshape({ kind: 'insertRow', at: grid.length })}
      >
        <ListItemIcon>
          <MdiIcon fontSize="inherit" path={mdiTableRowPlusAfter.path} />
        </ListItemIcon>
        <ListItemText>{'Add row'}</ListItemText>
      </MenuItem>,
      <MenuItem
        key="table-add-column"
        onClick={reshape({
          kind: 'insertColumn',
          at: grid[0]?.length ?? 0,
        })}
      >
        <ListItemIcon>
          <MdiIcon fontSize="inherit" path={mdiTableColumnPlusAfter.path} />
        </ListItemIcon>
        <ListItemText>{'Add column'}</ListItemText>
      </MenuItem>,
    )
  }
  items.push(<Divider key="table-divider" />)
  return items
}
