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

import { AppLink } from './app-link'
import { MdiIcon } from './mdi-icon/mdi-icon'
import {
  DataTableComponent,
  type DataTableProps,
} from './data-table.component'
import { IconButton, Stack, Tooltip } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import type { ReactNode } from 'react'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from './row-actions-menu.component'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../const/table-pagination'

/**
 * ONE row grammar for every artifact list (AGL-2501).
 *
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
 *
 * A screen is the only artifact of the four with a route the public can reach,
 * so it is the only one whose quick action says "live". Layouts, components
 * and templates render inside something else and have no address to open, so
 * theirs is a **Preview** into the console's own canvas render.
 *
 * The quick action is ALSO the menu's first entry — see
 * {@link quickActionMenuItem}. The icon alone is a glyph with a tooltip; the
 * menu is where every action on the row is spelled out, and an action missing
 * from it reads as an action the row does not have.
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
export interface ListQuickAction {
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

export interface ListRowActionsProps {
  /** The artifact's name — every control is labelled with it, because these
   * Repeat once per row and "More actions" alone says nothing about which. */
  label: string
  quick?: ListQuickAction | null
  items: RowActionsMenuItem[]
}

/**
 * The quick action, restated as the menu's first entry.
 *
 * The icon and the menu are two ways into ONE action, not two features: the
 * icon is a bare glyph, so a reader who does not recognize it has the overflow
 * as the place every action is named. Deriving the item from the same
 * {@link ListQuickAction} is what keeps the two in step — availability,
 * destination and the reason it is refused are read once and cannot drift.
 */
function quickActionMenuItem(
  quick: ListQuickAction,
): RowActionsMenuItem {
  return {
    key: 'quick',
    label: quick.label,
    icon: <MdiIcon path={quick.icon} size={0.8} />,
    // `href` is off-site and opens a new tab; `to` is an in-app route.
    href: quick.href ?? quick.to,
    external: Boolean(quick.href),
    onClick: quick.href || quick.to ? undefined : quick.onClick,
    disabled: Boolean(quick.unavailableReason),
    disabledReason: quick.unavailableReason,
  }
}

/** The trailing cluster: one quick action, then the overflow menu. */
export function ListRowActions(props: ListRowActionsProps) {
  const { label, quick, items } = props
  const menuItems = quick ? [quickActionMenuItem(quick), ...items] : items
  return (
    <Stack
      direction="row"
      spacing={0.5}
      /*
        `height: '100%'` is what actually centres these (AGL-2501). A DataGrid
        cell is a flex box, but `renderCell` content is auto-height inside it —
        so at the taller `TABLE_ROW_HEIGHT` these icons ride at the top of the
        row while the text beside them is centred. `alignItems` alone cannot
        fix it: there is no spare height to distribute until the child claims
        the row.
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
      {quick ? <ListQuickButton label={label} action={quick} /> : null}
      <RowActionsMenu label={label} items={menuItems} />
    </Stack>
  )
}
ListRowActions.displayName = 'ListRowActions'

function ListQuickButton(props: {
  label: string
  action: ListQuickAction
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
export function listActionsColumn(
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

export interface ListTableProps extends DataTableProps {
  /** Row click → the artifact's detail view. */
  onOpen?: (id: string, row: any) => void
}

/**
 * The grid every FLAT artifact list uses — layouts, components, templates.
 *
 * Screens is the deliberate exception and keeps its own tree; it adopts
 * {@link ListRowActions} so the two still read alike, which is the part a
 * reader actually compares.
 */
export function ListTable(props: ListTableProps) {
  const { onOpen, sx, initialState, hideFooter, rows, ...rest } = props
  /*==========================================
   * A HIDDEN FOOTER STILL PAGED THE ROWS.
   *
   * `hideFooter` is how a caller says "something else owns the page" — a
   * server-paged staff list, a cursor feed, a card whose `ListPagination`
   * sits under the grid. It hides the CONTROL and nothing else: the free
   * DataGrid always paginates, so the grid went on slicing at the shared
   * default and rows eleven onward were drawn by nothing and reachable by
   * nothing. The outer footer then described the rows it was HANDED, so it
   * reported a page two rows longer than the one on screen and offered no
   * way to see the difference.
   *
   * Eight lists pass `hideFooter`, and every one of them was losing rows past
   * the tenth. It went unnoticed because a list has to hold more than ten
   * rows to show a symptom, and most of these do not yet.
   *
   * So when the footer is hidden the grid takes ONE page as tall as the rows
   * it was given. CONTROLLED rather than `initialState`, because a
   * server-paged list hands over a different number of rows on every page and
   * initial state is read once. A floor of one because MUI rejects a page
   * size of zero, and an empty grid has nothing to slice anyway.
   *=========================================*/
  const rowCount = rows?.length ?? 0
  const unpaged = hideFooter
    ? {
        paginationModel: { page: 0, pageSize: Math.max(rowCount, 1) },
        // A controlled model with no handler logs a MUI warning, and the
        // grid must not move off page zero in any case: the page is not
        // this component's to change while somebody else owns the footer.
        onPaginationModelChange: () => undefined,
        // Keeps the size out of the "not preset in pageSizeOptions" warning.
        // Nothing renders it — the footer carrying the menu is hidden.
        pageSizeOptions: [Math.max(rowCount, 1)],
      }
    : {}
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
      /*
       * The list GROWS; the PAGE scrolls.
       *
       * `DataTableComponent` gives its wrapper a fixed `height: 400`, which
       * is right for a grid sitting in a pane of its own and wrong for a
       * card in a column of cards: the table got its own scrollbar, the card
       * stopped at 400px whatever it held, and the last row was cut through
       * the middle. Two scroll regions on one page is the thing to avoid —
       * a reader scrolling the page expects the page to move.
       *
       * `autoHeight` sizes the grid to its rows; clearing the wrapper's
       * height is what lets the card follow it. Caller `sx` is spread after,
       * so a list that genuinely wants a viewport can still take one.
       */
      autoHeight
      sx={[
        { height: 'auto' },
        { '& .MuiDataGrid-row': { cursor: onOpen ? 'pointer' : 'default' } },
        /*
          A cell whose content is taller than one line sets the row's height,
          and every OTHER cell then draws its content at the top of it — so a
          two-line date column leaves the counts beside it riding high while
          `ListRowActions`, which claims `height: '100%'` for itself, sits
          centred. One row, three vertical positions.

          Centring the cell itself fixes every column at once, including the
          ones a caller renders with a bare `<Typography>`; `alignItems`
          alone cannot, because an auto-height child has no spare height to
          distribute until something claims the row. `justifyContent` is
          deliberately not set here — a column's own `align` is what decides
          its horizontal placement, and overriding it would silently undo
          every right-aligned figure.
         */
        {
          '& .MuiDataGrid-cell': {
            display: 'flex',
            alignItems: 'center',
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      /*
       * The column menu can hide a column; only the toolbar can bring it
       * back.
       *
       * Every column here is hideable, `Manage columns` lives in the toolbar,
       * and the toolbar was off — so hiding the last column left a grid with
       * no columns and no control that could restore one. Not a rare misuse
       * either: the per-column menu offers `Hide column` on every column, and
       * the way out was never on screen.
       *
       * The Actions column is the reason the grid was not left completely
       * blank — `listActionsColumn` marks it `hideable: false` — and "one
       * unhideable column" is not a recovery path.
       */
      showToolbar
      pagination
      // The console's ONE footer (AGL-2501): same options, same default, same
      // label.
      pageSizeOptions={TABLE_PAGE_SIZE_OPTIONS}
      /*
       * MERGED, not replaced. `initialState` used to ride in through `rest`,
       * so a caller that set anything in it — a column visibility model, a
       * sort — silently dropped the shared page size along with it. The two
       * keys a caller is likely to set are spread individually so that a page
       * size and a hidden column can coexist.
       */
      initialState={{
        ...initialState,
        pagination: {
          paginationModel: { pageSize: TABLE_PAGE_SIZE_DEFAULT },
          ...initialState?.pagination,
        },
        columns: { ...initialState?.columns },
      }}
      slotProps={{
        pagination: { labelRowsPerPage: TABLE_ROWS_PER_PAGE_LABEL },
      }}
      rows={rows}
      hideFooter={hideFooter}
      {...rest}
      /*
       * AFTER `rest`, deliberately. "The footer is hidden, so every row I was
       * handed is on screen" is an invariant of this component, not a default
       * a call site may talk it out of — a caller that could re-slice here
       * would reintroduce exactly the rows nobody can reach.
       */
      {...unpaged}
    />
  )
}
ListTable.displayName = 'ListTable'

export default ListTable
