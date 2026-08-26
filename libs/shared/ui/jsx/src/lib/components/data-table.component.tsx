/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Box,
  type BoxProps,
  LinearProgress,
  type LinearProgressProps as MuiLinearProgressProps,
} from '@mui/material'
import {
  DataGrid,
  type DataGridProps as MuiDataGridProps,
  type GridColDef as MuiGridColDef,
  GridOverlay,
  type GridOverlayProps,
} from '@mui/x-data-grid'
import { forwardRef } from 'react'
import { EmptyStateComponent } from './empty-state.component'
import { HelpTip } from './help-tip.component'

/**
 * The grid's empty state is THE console empty state (AGL-693).
 *
 * The illustration and its five mode-aware fills used to live here, which is
 * why the media library — not a grid — had a bare line of text where every
 * other list had a picture and a sentence. `EmptyStateComponent` owns it now
 * and both render the same thing.
 */
const noRowsOverlay = (label: string) =>
  (function NoRowsOverlay(props: GridOverlayProps) {
    return (
      <GridOverlay {...props}>
        <EmptyStateComponent label={label ?? 'No Items'} />
      </GridOverlay>
    )
  })

type LoadingOverlayViewProps = {
  LinearProgressProps?: MuiLinearProgressProps
}
const AppLoaderOverlayView = (props: LoadingOverlayViewProps = {}) =>
  (function AppLoaderOverlayView() {
    return (
      <GridOverlay>
        <div style={{ position: 'absolute', top: 0, width: '100%' }}>
          <LinearProgress color="primary" {...props.LinearProgressProps} />
        </div>
      </GridOverlay>
    )
  })

export interface DataTableProps extends Partial<MuiDataGridProps> {
  rows?: MuiDataGridProps['rows']
  columns?: MuiDataGridProps['columns']
  loading?: MuiDataGridProps['loading']
  RootBoxProps?: Partial<BoxProps>
  LoadingOverlayViewProps?: LoadingOverlayViewProps
  noRowsLabel?: string
  children?: JSX.Children
}

/**
 * Adds a small help affordance to the header of every column that declares a
 * `description` (AGL-601). Columns with their own `renderHeader` are left
 * untouched. Also usable directly by call sites that render MUI `DataGrid`
 * themselves instead of `DataTableComponent`.
 */
export function withColumnHelp(
  columns: readonly MuiGridColDef[],
): MuiGridColDef[] {
  return columns.map((column) => {
    if (!column.description || column.renderHeader) return column
    return {
      ...column,
      renderHeader: () => (
        <Box
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
        >
          <Box component="span" className="MuiDataGrid-columnHeaderTitle">
            {column.headerName ?? column.field}
          </Box>
          <HelpTip
            excerpt={column.description}
            ariaLabel={`Help: ${column.headerName ?? column.field}`}
            sx={{ fontSize: '0.9em' }}
          />
        </Box>
      ),
    }
  })
}

const DataTableComponent = forwardRef<HTMLElement, DataTableProps>(
  function RefRenderFn(props, ref) {
    const {
      rows = [],
      columns = [],
      loading,
      RootBoxProps,
      noRowsLabel,
      LoadingOverlayViewProps,
      children,
      sx,
      slots,
      ...rest
    } = props
    return (
      <Box
        ref={ref}
        sx={mergeSxProps(
          {
            height: 400,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            '& .MuiDataGrid-root': {
              border: 'none',
              '& .MuiDataGrid-cell': {
                '&:focus': {
                  outline: 'none',
                },
              },
              // Column headers styled to match a plain MUI <TableHead>, which
              // is what the screens list renders (it uses a bespoke table, not
              // this grid). Without this the console shows two different table
              // header designs depending on which listing you look at.
              //
              // Nested inside .MuiDataGrid-root deliberately: at the Box level
              // these lost the cascade to the grid's own class-level styles —
              // the separators stayed visible while the font rules landed,
              // which is exactly the kind of half-applied styling that reads
              // as "close but wrong".
              '& .MuiDataGrid-columnSeparator': { display: 'none' },
              /*
                NO border-bottom here, and that is the fix (AGL-693).

                It used to add `1px solid divider` to the header CONTAINER —
                and the grid already draws that line one level down: every
                `.MuiDataGrid-columnHeader` cell carries a bottom border in
                `--DataGrid-rowBorderColor`, and `.MuiDataGrid-filler` carries
                it across whatever width the columns leave over. Measured on
                the layouts list, the cells' line ended at y=364.43 and the
                container's at y=365.68 — two 1.25px rules a fifth of a pixel
                apart, which is the "double border below the table header"
                Zach spotted on every grid list and never on the screens
                table, which is a plain MUI `<Table>` with one.

                The colours were already identical: `divider` is
                rgba(0,0,0,0.12), and the row border resolves to rgb(224,224,224)
                — the same line MuiTableCell head draws. So the one to keep is
                the grid's own, which spans the full width without help.
              */
              '& .MuiDataGrid-columnHeader': {
                '&:focus, &:focus-within': { outline: 'none' },
              },
              '& .MuiDataGrid-columnHeaderTitle': {
                // Matches MuiTableCell head: medium weight at body-2 size.
                fontWeight: 500,
                fontSize: '0.875rem',
                lineHeight: 1.5,
              },
            },
          },
          sx,
        )}
        {...RootBoxProps}
      >
        <DataGrid
          sx={{ flexGrow: 1 }}
          // Same height as a row by default, like a TableHead cell; a caller
          // that sets columnHeaderHeight explicitly still wins via `rest`.
          columnHeaderHeight={48}
          rows={rows}
          columns={withColumnHelp(columns)}
          loading={loading}
          slots={{
            noRowsOverlay: noRowsOverlay(noRowsLabel),
            loadingOverlay: AppLoaderOverlayView(LoadingOverlayViewProps),
            ...slots,
          }}
          {...rest}
        />
        {children}
      </Box>
    )
  },
)

DataTableComponent.displayName = 'DataTableComponent'
DataTableComponent.aglyn = true

export { DataTableComponent }
export default DataTableComponent
