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

import type * as Aglyn from '@aglyn/aglyn'
import { canvas } from '@aglyn/aglyn'
import { TableEdgeAddButton } from '@aglyn/aglyn-markdown-editor'
import * as Besigner from '@aglyn/besigner'
import type { DataTableShapeEdit } from '@aglyn/shared-data-enums'
import { Box } from '@mui/material'
import { toJS } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useEffect, useState } from 'react'
import { useAnchoredRect } from '../hooks/use-anchored-rect'
import { inlineMarkdownEdit } from '../utils/inline-markdown-edit.store'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import {
  dataTableAppendEdits,
  findDataTableAttributeName,
  withDataTableShapeEdit,
} from '../utils/table-cell-edit'

/** The canvas scroller, the box these controls are clipped to. */
const CANVAS_VIEWPORT_ID = 'aglyn:viewport-canvas'
/** Space between a table's edge and its bar. */
const GAP = 6
/** The bar's thickness, as `TableEdgeAddButton` draws it. */
const BAR = 20
/**
 * Where the row bar sits under a SELECTED table: below the element's action
 * strip, which hangs centred off the selection's bottom edge (about 23px
 * tall), exactly where a full-width bar would run. A fixed clearance rather
 * than a measurement: the strip's popper places itself after these bars do,
 * so a reading of it is a frame stale whenever the table changes size.
 */
const ROW_GAP_UNDER_ACTIONS = 30
const NO_RECT = { left: 0, top: 0, width: 0, height: 0 }

/**
 * The open cell editor's way of applying a row or column edit (AGL-4203).
 *
 * While a cell is being typed into, its text is not yet in the stored grid.
 * A "+" pressed then has to land in the SAME write as that text, or the row
 * arrives and the words just typed are lost — so the editor registers the
 * one-commit path it already uses for its own Rows and columns menu, and the
 * bars call that instead of writing the grid themselves.
 */
let cellEditShapeHandler: ((edit: DataTableShapeEdit) => void) | null = null

export function registerCellEditShapeHandler(
  handler: (edit: DataTableShapeEdit) => void,
): () => void {
  cellEditShapeHandler = handler
  return () => {
    if (cellEditShapeHandler === handler) cellEditShapeHandler = null
  }
}

/**
 * Marks controls that act on an open in-place edit from outside its own
 * toolbar. The cell editor treats a press on one as part of the edit, not
 * as a click away from it.
 */
export const EDIT_COMPANION_SELECTOR = '[data-aglyn-edit-companion]'

/** The `<table>` an element draws: itself, or the first one inside it. */
function tableWithin(element: Element | null | undefined): Element | undefined {
  if (!element) return undefined
  if (element.tagName === 'TABLE') return element
  return element.querySelector('table') ?? undefined
}

interface TargetTable {
  node: Aglyn.NodeSchema<any>
  attribute: string
  table: Element | undefined
  editing: boolean
}

/** The Table being typed into, or else the one selected, if either. */
function targetTable(): TargetTable | null {
  // A Markdown block's own editor carries its own table controls.
  if (inlineMarkdownEdit.node) return null
  const cell = inlineTextEdit.cellTarget
  if (cell && inlineTextEdit.node) {
    return {
      node: inlineTextEdit.node,
      attribute: cell.attribute,
      table: inlineTextEdit.anchor?.closest('table') ?? undefined,
      editing: true,
    }
  }
  // Any other in-place edit owns the canvas while it is open.
  if (inlineTextEdit.node) return null
  if (Besigner.focus.getSelected().length !== 1) return null
  const $id = Besigner.focus.getLastSelected()?.$id
  const node = $id ? canvas.getNode($id) : undefined
  const attribute = findDataTableAttributeName(node)
  if (!node || !attribute) return null
  return {
    node,
    attribute,
    table: tableWithin(Besigner.refs.get($id)?.current),
    editing: false,
  }
}

/**
 * "+" bars along the bottom and right edges of the canvas Table being edited
 * or selected, for adding a row or a column without hunting for a menu.
 *
 * Mounted once among the viewport overlays. It sits outside the canvas's
 * closed shadow root and positions in screen coordinates, clipped to the
 * canvas scroller so a bar never paints over the designer's panels.
 */
export const TableEdgeControlsComponent = observer(
  function TableEdgeControlsComponent() {
    const target = targetTable()
    const props = target
      ? ((toJS(target.node.props) ?? {}) as Record<string, unknown>)
      : undefined
    const edits =
      target && props ? dataTableAppendEdits(props[target.attribute]) : null

    const rect = useAnchoredRect(target?.table, NO_RECT)
    const [scroller, setScroller] = useState<Element | null>(null)
    useEffect(() => {
      setScroller(document.getElementById(CANVAS_VIEWPORT_ID))
    }, [])
    const viewport = useAnchoredRect(scroller ?? undefined, NO_RECT)
    if (!target || !props || !edits || !target.table) return null
    if (rect.width === 0 || viewport.width === 0) return null
    // Entirely scrolled out of the canvas: nothing to reach.
    if (
      rect.top + rect.height < viewport.top ||
      rect.top > viewport.top + viewport.height
    ) {
      return null
    }

    const apply = (edit: DataTableShapeEdit) => {
      if (target.editing && cellEditShapeHandler) {
        cellEditShapeHandler(edit)
        return
      }
      canvas.updateNodeProps(
        target.node,
        withDataTableShapeEdit(props, target.attribute, edit) as never,
      )
    }

    const left = rect.left - viewport.left
    const top = rect.top - viewport.top
    // A table as wide as the canvas leaves no room on its right; the bar then
    // sits just inside the edge rather than off-screen.
    const roomRight = left + rect.width + GAP + BAR <= viewport.width
    const columnLeft = roomRight
      ? left + rect.width + GAP
      : left + rect.width - BAR - 2
    // While a cell is being typed into the strip stands down, so the bar
    // sits right under the table.
    const rowGap = target.editing ? GAP : ROW_GAP_UNDER_ACTIONS

    return (
      <Box
        data-aglyn="overlay:table-edges"
        data-aglyn-edit-companion=""
        sx={{
          position: 'fixed',
          left: viewport.left,
          top: viewport.top,
          width: viewport.width,
          height: viewport.height,
          overflow: 'hidden',
          pointerEvents: 'none',
          '& [data-table-edge]': { pointerEvents: 'auto' },
        }}
      >
        <TableEdgeAddButton
          edge="column"
          onClick={() => apply(edits.column)}
          sx={{
            position: 'absolute',
            left: columnLeft,
            top,
            height: rect.height,
          }}
        />
        <TableEdgeAddButton
          edge="row"
          onClick={() => apply(edits.row)}
          sx={{
            position: 'absolute',
            left,
            top: top + rect.height + rowGap,
            width: rect.width,
          }}
        />
      </Box>
    )
  },
)
TableEdgeControlsComponent.displayName = 'TableEdgeControlsComponent'

export default TableEdgeControlsComponent
