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
import {
  normalizeEmphasisColumn,
  parseDataTableRows,
  readDataTableAlignments,
} from '@aglyn/shared-data-enums'
import { mdiTable } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  scrollRegionProps,
  scrollableTableSx,
  scrollableTableWrapperSx,
} from '../utils/scroll-overflow'

// Component ids are persisted in screen documents; never rename.
export const DATA_TABLE_ID: Aglyn.ComponentId = 'dataTable'

/** What a screen reader announces on reaching the grid's scroll box. */
const TABLE_REGION_LABEL = 'Table'

export interface DataTableProps {
  /**
   * The grid, pipe-delimited, one row per line — and its column alignment,
   * as a markdown divider row. See `@aglyn/shared-data-enums`'s `data-table` utilities.
   */
  rows?: string
  /** Render the first row as a header. */
  headerRow?: boolean
  /** 1-based column to emphasise, or 0/absent for none. */
  emphasizeColumn?: number | string
}

/**
 * A comparison table (AGL-2543).
 *
 * The feature matrix is the load-bearing block on a competitor comparison
 * page, and the palette had no way to build one: searching `table` returned
 * **Table of Contents** and **Pricing Table**, neither of which is a general
 * grid. The only route was to author markdown pipe syntax inside a Markdown
 * element — which renders correctly and is exactly the audience the besigner
 * exists to spare.
 *
 * Three things the Markdown route could not give, and the reason this is an
 * element rather than a docs note:
 *
 *  - **Header emphasis**, without asking an author to remember that the first
 *    row is special.
 *  - **A highlighted column** — the "ours" column on a comparison page is the
 *    entire point of the block, and markdown has no way to say it.
 *  - **A grid to edit**, rather than pipe syntax in a text box — see the
 *    `DATA_TABLE` field this element's `rows` attribute asks for.
 *
 * Narrow-screen behaviour is NOT one of them (AGL-2568). Both routes draw the
 * same block, so both take the same treatment from `scroll-overflow`: the
 * grid scrolls inside its own box once it is too wide to read, and says so.
 */
const DataTable = forwardRef<HTMLDivElement, DataTableProps>((props, ref) => {
  const { rows, headerRow = true, emphasizeColumn, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const grid = parseDataTableRows(rows)
  const width = grid[0]?.length ?? 0
  const alignments = readDataTableAlignments(rows, width)
  const emphasis = normalizeEmphasisColumn(emphasizeColumn, width)

  if (grid.length === 0) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            padding: 2,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Table — add rows in Attributes'}
      </Box>
    )
  }

  const [first, ...body] = grid
  const dataRows = headerRow ? body : grid
  // An emphasised column reads as emphasised in BOTH halves of the table: a
  // header cell that is bold anyway would otherwise show no highlight at all,
  // which is the one row an author looks at first.
  const cellSx = (columnIndex: number) =>
    emphasis === columnIndex + 1
      ? { backgroundColor: 'action.hover', fontWeight: 600 }
      : undefined

  return (
    <Box
      ref={ref}
      {...rest}
      {...scrollRegionProps(TABLE_REGION_LABEL)}
      // The wrapper scrolls the grid, and the grid is sized so that it can
      // (AGL-2568). `overflowX` here is half of it: it does nothing at all
      // while the table inside is `width: 100%`, because a table that cannot
      // exceed this box never overflows it — it crushes its columns instead.
      // The pair is what makes a wide matrix scrollable, and the fade is what
      // makes an overlay-scrollbar platform admit that it did.
      sx={[{ width: '100%', ...scrollableTableWrapperSx }, ...nodeSx]}
    >
      <Table size="small" sx={scrollableTableSx}>
        {headerRow ? (
          <TableHead>
            <TableRow>
              {first.map((cell, columnIndex) => (
                <TableCell
                  key={columnIndex}
                  align={alignments[columnIndex]}
                  sx={{ fontWeight: 700, ...cellSx(columnIndex) }}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
        ) : null}
        <TableBody>
          {dataRows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <TableCell
                  key={columnIndex}
                  align={alignments[columnIndex]}
                  sx={cellSx(columnIndex)}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
})
DataTable.displayName = 'AglynDataTable'

export default DataTable

export const dataTableSchema: Aglyn.ComponentSchema<DataTableProps> = {
  $id: DATA_TABLE_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Table',
  description:
    'A grid of rows and columns — a feature matrix, a spec sheet, a comparison.',
  category: Aglyn.ComponentCategory.BLOCKS,
  icon: { path: mdiTable.path, sx: { color: '#0288d1' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'rows',
      description:
        'The table contents. Paste a markdown table to import one you already have.',
      component: Aglyn.FieldComponentType.DATA_TABLE,
      label: 'Rows',
    },
    {
      name: 'headerRow',
      description: 'Render the first row as a header.',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'First row is a header',
    },
    {
      name: 'emphasizeColumn',
      description:
        'Highlight one column — on a comparison table, usually your own. 0 for none.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Emphasize column',
    },
  ],
}

export const dataTablePresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(DATA_TABLE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Table',
    pluginId: BUNDLE_ID,
    description: 'Comparison grid with a header row',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiTable.path, sx: { color: '#0288d1' } },
    data: {
      $id: null,
      componentId: DATA_TABLE_ID,
      pluginId: BUNDLE_ID,
      props: {
        headerRow: true,
        emphasizeColumn: 2,
        rows: [
          'Feature | Us | Them',
          '--- | :---: | :---:',
          'Open source | Yes | No',
          'Self-hostable | Yes | No',
          'One platform | Yes | No',
        ].join('\n'),
      },
    },
  },
]
