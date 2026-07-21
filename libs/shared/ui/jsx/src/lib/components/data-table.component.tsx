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

import {
  generateComponentClassKeys,
  mergeSxProps,
  styled,
} from '@aglyn/shared-ui-theme'
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
import { HelpTip } from './help-tip.component'

const classKeys = generateComponentClassKeys('DataTableComponent', [
  'label',
  'antEmptyImg1',
  'antEmptyImg2',
  'antEmptyImg3',
  'antEmptyImg4',
  'antEmptyImg5',
  'dataGrid',
])

const StyledGridOverlay = styled(GridOverlay, {
  name: 'AglynNoRowsOverlay',
})(({ theme }) => ({
  flexDirection: 'column',
  [`& .${classKeys.label}`]: {
    marginTop: theme.spacing(1),
  },
  [`& .${classKeys.antEmptyImg1}`]: {
    fill: theme.palette.mode === 'light' ? '#AEB8C2' : '#262626',
  },
  [`& .${classKeys.antEmptyImg2}`]: {
    fill: theme.palette.mode === 'light' ? '#F5F5F7' : '#595959',
  },
  [`& .${classKeys.antEmptyImg3}`]: {
    fill: theme.palette.mode === 'light' ? '#DCE0E6' : '#434343',
  },
  [`& .${classKeys.antEmptyImg4}`]: {
    fill: theme.palette.mode === 'light' ? '#FFFFFF' : '#1C1C1C',
  },
  [`& .${classKeys.antEmptyImg5}`]: {
    fillOpacity: theme.palette.mode === 'light' ? '0.8' : '0.08',
    fill: theme.palette.mode === 'light' ? '#F5F5F5' : '#FFFFFF',
  },
}))

const noRowsOverlay = (label: string) =>
  (function NoRowsOverlay(props: GridOverlayProps) {
    return (
      <StyledGridOverlay>
        <svg
          width="120"
          height="100"
          viewBox="0 0 184 152"
          aria-hidden
          focusable="false"
        >
          <g fill="none" fillRule="evenodd">
            <g transform="translate(24 31.67)">
              <ellipse
                className={classKeys.antEmptyImg5}
                cx="67.797"
                cy="106.89"
                rx="67.797"
                ry="12.668"
              />
              <path
                className={classKeys.antEmptyImg1}
                d="M122.034 69.674L98.109 40.229c-1.148-1.386-2.826-2.225-4.593-2.225h-51.44c-1.766 0-3.444.839-4.592 2.225L13.56 69.674v15.383h108.475V69.674z"
              />
              <path
                className={classKeys.antEmptyImg2}
                d="M33.83 0h67.933a4 4 0 0 1 4 4v93.344a4 4 0 0 1-4 4H33.83a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z"
              />
              <path
                className={classKeys.antEmptyImg3}
                d="M42.678 9.953h50.237a2 2 0 0 1 2 2V36.91a2 2 0 0 1-2 2H42.678a2 2 0 0 1-2-2V11.953a2 2 0 0 1 2-2zM42.94 49.767h49.713a2.262 2.262 0 1 1 0 4.524H42.94a2.262 2.262 0 0 1 0-4.524zM42.94 61.53h49.713a2.262 2.262 0 1 1 0 4.525H42.94a2.262 2.262 0 0 1 0-4.525zM121.813 105.032c-.775 3.071-3.497 5.36-6.735 5.36H20.515c-3.238 0-5.96-2.29-6.734-5.36a7.309 7.309 0 0 1-.222-1.79V69.675h26.318c2.907 0 5.25 2.448 5.25 5.42v.04c0 2.971 2.37 5.37 5.277 5.37h34.785c2.907 0 5.277-2.421 5.277-5.393V75.1c0-2.972 2.343-5.426 5.25-5.426h26.318v33.569c0 .617-.077 1.216-.221 1.789z"
              />
            </g>
            <path
              className={classKeys.antEmptyImg3}
              d="M149.121 33.292l-6.83 2.65a1 1 0 0 1-1.317-1.23l1.937-6.207c-2.589-2.944-4.109-6.534-4.109-10.408C138.802 8.102 148.92 0 161.402 0 173.881 0 184 8.102 184 18.097c0 9.995-10.118 18.097-22.599 18.097-4.528 0-8.744-1.066-12.28-2.902z"
            />
            <g
              className={classKeys.antEmptyImg4}
              transform="translate(149.65 15.383)"
            >
              <ellipse cx="20.654" cy="3.167" rx="2.849" ry="2.815" />
              <path d="M5.698 5.63H0L2.898.704zM9.259.704h4.985V5.63H9.259z" />
            </g>
          </g>
        </svg>
        <div className={classKeys.label}>{label ?? 'No Items'}</div>
      </StyledGridOverlay>
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
          <LinearProgress color="secondary" {...props.LinearProgressProps} />
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
            },
          },
          sx,
        )}
        {...RootBoxProps}
      >
        <DataGrid
          sx={{ flexGrow: 1 }}
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
