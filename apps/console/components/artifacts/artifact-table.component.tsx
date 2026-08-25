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

import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { DataTableComponent } from '@aglyn/shared-ui-jsx/components/data-table.component'
import type { DataTableProps } from '@aglyn/shared-ui-jsx/components/data-table.component'
import { IconButton, Stack, Tooltip } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import type { ReactNode } from 'react'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '../row-actions-menu.component'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../../constants/shared'

/**
 * ONE row grammar for every artifact list (AGL-693).
 *
 * Zach: *"We need to carry this standard across all of them the screens list,
 * the layouts list, the components list, the templates list. They all could
 * have the same context menu and clicking them should open the detail view. …
 * They should all share the same kind of table, seems they all use a different
 * table right now."*
 *
 * They did. Three of the four are `DataTableComponent`, but each declared its
 * own column set, its own action arrangement and its own row-click, and the
 * fourth — screens — is a hand-rolled tree because it has to be: drag to
 * reorder, expand to nest, no grid can do that. So "the same table" cannot
 * literally be one component for all four, and pretending otherwise would mean
 * either losing the hierarchy or bolting a tree onto a grid.
 *
 * What IS shared is the row GRAMMAR, and that is what actually differed on
 * screen. Every artifact row now reads the same way:
 *
 * ```
 *   [ drag · expand ]   name   id   description   updated   created   [ ⇗ ⋮ ]
 *     screens only                                                  quick  menu
 * ```
 *
 * - **The row opens the detail view.** Clicking anywhere that is not a control
 *   navigates. It is the primary action on every one of these lists and it was
 *   previously a link buried in one column.
 * - **Rows are NOT selectable.** The grid lists shipped with selection on, so
 *   a click both navigated AND tinted the row, and the footer counted "1 row
 *   selected" for a selection nothing could act on. A selection with no bulk
 *   action is a state the reader has to dismiss and cannot use.
 * - **Exactly one quick action, then the menu.** Everything else moves behind
 *   the overflow — a delete sitting inline is one mis-click from the row's own
 *   open handler, which is the argument AGL-701 already made for components and
 *   never carried to the rest.
 *
 * The quick action is the one thing worth a direct click on that kind of
 * artifact: **Open live page** for a screen, **Preview** for anything that has
 * no address of its own. It is the only per-kind variation in the trailing
 * cluster, and it is chosen by the caller rather than inferred here.
 */

/**
 * The single trailing icon beside the overflow menu.
 *
 * Three shapes, because the destinations genuinely differ: an EXTERNAL live
 * page (new tab), an IN-APP preview route, and a plain handler for the rare
 * action that opens a dialog. `unavailableReason` is the fourth state and the
 * one most easily got wrong — a screen with no single live page (a collection
 * template renders under routes it does not own) must still show the control,
 * disabled, saying why. Hiding it would read as the feature being absent.
 */
export interface ArtifactQuickAction {
  /** `mdi` icon path. */
  icon: string
  /** Accessible name; also the tooltip when the action is unavailable. */
  label: string
  /** A live, external URL — opened in a new tab. */
  href?: string
  /** An in-app route — a normal client navigation. */
  to?: string
  onClick?: () => void
  /**
   * Why this row cannot use the action. Renders it DISABLED with the reason as
   * its tooltip, rather than removing it — an absent control and an
   * inapplicable one look identical, and only one of them is honest.
   */
  unavailableReason?: string
}

export interface ArtifactRowActionsProps {
  /** The artifact's name — every control is labelled with it, because these
   * repeat once per row and "More actions" alone says nothing about which. */
  label: string
  quick?: ArtifactQuickAction | null
  items: RowActionsMenuItem[]
}

/** The trailing cluster: one quick action, then the overflow menu. */
export function ArtifactRowActions(props: ArtifactRowActionsProps) {
  const { label, quick, items } = props
  return (
    <Stack
      direction="row"
      spacing={0.5}
      /*
        `height: '100%'` is what actually centres these (AGL-693). A DataGrid
        cell is a flex box, but `renderCell` content is auto-height inside it —
        so at the taller `TABLE_ROW_HEIGHT` these icons sat at the top of the
        row while the text beside them was centred, which is the misalignment
        Zach spotted. `alignItems` alone cannot fix it: there is no spare
        height to distribute until the child claims the row.
      */
      sx={{
        height: '100%',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
      // The row's own click opens the detail view; without this every control
      // in here would navigate out from under the thing it just opened.
      onClick={(event) => event.stopPropagation()}
    >
      {quick ? <ArtifactQuickButton label={label} action={quick} /> : null}
      <RowActionsMenu label={label} items={items} />
    </Stack>
  )
}
ArtifactRowActions.displayName = 'ArtifactRowActions'

function ArtifactQuickButton(props: {
  label: string
  action: ArtifactQuickAction
}) {
  const { label, action } = props
  const icon = <MdiIcon path={action.icon} size={0.8} />
  const name = `${action.label} — ${label}`

  if (action.unavailableReason) {
    return (
      <Tooltip title={action.unavailableReason}>
        {/* span: a disabled button emits no events, so the tooltip needs a
            wrapper that does. */}
        <span>
          <IconButton size="small" aria-label={name} disabled>
            {icon}
          </IconButton>
        </span>
      </Tooltip>
    )
  }
  if (action.href) {
    return (
      <Tooltip title={action.label}>
        <AppLink
          componentVariant="icon-button"
          size="small"
          aria-label={name}
          href={action.href}
          target="_blank"
          rel="noreferrer"
        >
          {icon}
        </AppLink>
      </Tooltip>
    )
  }
  if (action.to) {
    return (
      <Tooltip title={action.label}>
        <AppLink
          componentVariant="icon-button"
          size="small"
          aria-label={name}
          href={action.to}
        >
          {icon}
        </AppLink>
      </Tooltip>
    )
  }
  return (
    <Tooltip title={action.label}>
      <IconButton size="small" aria-label={name} onClick={action.onClick}>
        {icon}
      </IconButton>
    </Tooltip>
  )
}

/**
 * The trailing ACTIONS column, identical on every grid list.
 *
 * Deliberately NOT MUI's `type: 'actions'`. That type renders each
 * `GridActionsCellItem` as its own icon and moves the ones marked `showInMenu`
 * into a menu it owns — which is how the three lists ended up with two, three
 * and five inline icons respectively, each a different width, and how the
 * screens table (which cannot use it at all) grew a second implementation.
 * One `renderCell` gives every list the same cluster and the same width.
 */
export function artifactActionsColumn(
  render: (row: any) => ReactNode,
  options: { width?: number } = {},
): GridColDef {
  return {
    field: 'actions',
    headerName: 'Actions',
    width: options.width ?? 110,
    align: 'right',
    headerAlign: 'right',
    sortable: false,
    filterable: false,
    hideable: false,
    disableColumnMenu: true,
    renderCell: ({ row }: any) => render(row),
  }
}

export interface ArtifactTableProps extends DataTableProps {
  /** Row click → the artifact's detail view. */
  onOpen?: (id: string, row: any) => void
}

/**
 * The grid every FLAT artifact list uses — layouts, components, templates.
 *
 * Screens is the deliberate exception and keeps its own tree; it adopts
 * {@link ArtifactRowActions} so the two still read alike, which is the part a
 * reader actually compares.
 */
export function ArtifactTable(props: ArtifactTableProps) {
  const { onOpen, sx, ...rest } = props
  return (
    <DataTableComponent
      getRowId={(row: any) => row.$id}
      // The three properties that make a row a NAVIGATION target rather than a
      // selectable record. `disableRowSelectionOnClick` alone is not enough —
      // it stops the click selecting, and leaves the checkbox column and the
      // "n rows selected" footer behind.
      rowSelection={false}
      checkboxSelection={false}
      disableRowSelectionOnClick
      onRowClick={
        onOpen ? ({ id, row }) => onOpen(String(id), row) : undefined
      }
      sx={[
        { '& .MuiDataGrid-row': { cursor: onOpen ? 'pointer' : 'default' } },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      pagination
      // The console's ONE footer (AGL-693): same options, same default, same
      // label. `initialState` is a default and not a lock — a caller that
      // owns its page size (layouts bounds its listener by it) still passes
      // its own through `rest`, which is spread after this.
      pageSizeOptions={TABLE_PAGE_SIZE_OPTIONS}
      initialState={{
        pagination: {
          paginationModel: { pageSize: TABLE_PAGE_SIZE_DEFAULT },
        },
      }}
      slotProps={{
        pagination: { labelRowsPerPage: TABLE_ROWS_PER_PAGE_LABEL },
      }}
      {...rest}
    />
  )
}
ArtifactTable.displayName = 'ArtifactTable'

export default ArtifactTable
