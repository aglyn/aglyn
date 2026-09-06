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
 * THE COLUMN MENU ON A CRM LIST, with a way to move the column (AGL-2635).
 *
 * A saved view keeps its columns in order, and the grid has no gesture for
 * changing that order: the MIT grid forces `disableColumnReorder`, and
 * its Manage columns panel only shows and hides. So the menu every
 * column header already opens — Sort, Hide, Manage columns — grows Move
 * left and Move right, which go through the view's own `columnOrder` (see
 * `useCrmViewGrid`) rather than the grid's column state: the view is what
 * is saved, and the grid draws what the view says.
 *
 * ## Fed by context, not slot props
 *
 * `ListTable` sets its own `slotProps`, so a caller's `slotProps.columnMenu`
 * would replace them; a provider around the table costs nothing and reaches
 * the menu through the grid's portal. A menu opened outside one offers no
 * move — it is the same menu every other list has.
 */

import { mdiArrowLeft, mdiArrowRight } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  type GridColDef,
  GridColumnMenu,
  type GridColumnMenuProps,
  useGridRootProps,
} from '@mui/x-data-grid'
import { createContext, type SyntheticEvent, useContext } from 'react'
import type { CrmColumnOrder } from '../hooks/use-crm-view-grid'

const CrmColumnOrderContext = createContext<CrmColumnOrder | null>(null)

/** Wraps the list whose column menu should offer Move left / Move right. */
export const CrmColumnOrderProvider = CrmColumnOrderContext.Provider

/**
 * Move left and Move right, as one menu item each.
 *
 * Disabled at the edge rather than absent, so a column that cannot move
 * further still says which way it can. A pinned column (`hideable: false`)
 * has no place in the order and gets neither.
 */
function MoveColumnItems(props: {
  colDef: GridColDef
  onClick: (event: SyntheticEvent) => void
}) {
  const { colDef, onClick } = props
  const rootProps = useGridRootProps()
  const columnOrder = useContext(CrmColumnOrderContext)
  if (!columnOrder || colDef.hideable === false) return null
  const index = columnOrder.order.indexOf(colDef.field)
  if (index === -1) return null
  const MenuItem = rootProps.slots.baseMenuItem
  const item = (delta: -1 | 1, label: string, icon: string, disabled: boolean) => (
    <MenuItem
      disabled={disabled}
      iconStart={<MdiIcon path={icon} size={0.8} />}
      onClick={(event: SyntheticEvent) => {
        // A disabled item still receives an imperative click.
        if (disabled) return
        columnOrder.move(colDef.field, delta)
        onClick(event)
      }}
    >
      {label}
    </MenuItem>
  )
  return (
    <>
      {item(-1, 'Move left', mdiArrowLeft.path, index === 0)}
      {item(1, 'Move right', mdiArrowRight.path, index === columnOrder.order.length - 1)}
    </>
  )
}
MoveColumnItems.displayName = 'MoveColumnItems'

/**
 * The grid's own menu with the move items added between Filter and Hide —
 * after what the column does, before what happens to it.
 */
export function CrmColumnMenu(props: GridColumnMenuProps) {
  return (
    <GridColumnMenu
      {...props}
      slots={{ columnMenuMoveItems: MoveColumnItems }}
      slotProps={{ columnMenuMoveItems: { displayOrder: 25 } }}
    />
  )
}
CrmColumnMenu.displayName = 'CrmColumnMenu'

/**
 * The `slots` a CRM list hands its `ListTable`. One module-level object, so
 * the grid sees one identity across renders rather than a new slot map —
 * and a remounted menu — every time the section draws.
 */
export const CRM_LIST_SLOTS = { columnMenu: CrmColumnMenu } as const

export default CrmColumnMenu
