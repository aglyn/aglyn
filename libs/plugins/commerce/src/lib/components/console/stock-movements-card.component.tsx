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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { pluginDocsHelp } from '@aglyn/aglyn'
import * as CommerceModel from '../../model'
import {
  STOCK_MOVEMENT_COLUMN_SORTS,
  STOCK_MOVEMENT_FILTER_FIELDS,
  STOCK_MOVEMENT_FILTER_HEADERS,
  STOCK_MOVEMENT_QUERY,
  STOCK_MOVEMENT_REASON_LABEL,
  STOCK_MOVEMENT_SELECT_FIELDS,
} from '../../constants/stock-movement-query'

export interface StockMovementsCardProps {
  hostId: string
}

/**
 * How many products the card reads to NAME its rows and offer the Product
 * filter's choices. A picker's reach, not the ledger's: the ledger itself is
 * paged by its query and reaches every movement whatever this holds.
 */
const PRODUCT_NAMES_CEILING = 500
/** A site's locations, which the plan caps well under this. */
const LOCATION_CEILING = 25

const movementsHelp = pluginDocsHelp('commerce', {
  anchor: '#stock-movements',
  title: 'Stock movements',
  excerpt:
    'Every change to a tracked count — sales, returns, cancellations and ' +
    'hand adjustments — newest first, with the reason each one was made.',
})

const REASON_OPTIONS = Object.entries(STOCK_MOVEMENT_REASON_LABEL).map(([value, label]) => ({
  value,
  label,
}))

/** The columns the grid draws; every other declared field is a hidden filter column. */
const VISIBLE_COLUMNS = ['atMs', 'productId', 'delta', 'reason', 'source']

type MovementRow = CommerceModel.InventoryAdjustment & { $id: string }

/** What the Source column reads: the order, the location and who counted. */
const movementSource = (row: MovementRow): string =>
  [
    row.orderId ? `order ${row.orderId}` : null,
    row.locationId ? `at ${row.locationId}` : null,
    row.source ? `counted by ${row.source}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * Product (a name read from the product) and Source (composed from three
 * fields) sort the page on screen (AGL-3680); When, Change and Reason are the
 * query's order (`STOCK_MOVEMENT_COLUMN_SORTS`).
 */
const MOVEMENT_PAGE_SORTS = {
  productId: (row: MovementRow & { productName?: string }) => row.productName ?? row.productId,
  source: (row: MovementRow) => movementSource(row) || null,
}
const MOVEMENT_PAGE_SORT_HEADERS = { productId: 'Product', source: 'Source' }

/**
 * Stock movements (AGL-2341) — the adjustment history that had no history
 * view.
 *
 * `hosts/{hostId}/inventoryAdjustments` has three writers: the products
 * hub's "Adjust stock" dialog, `decrementVariantStock` (the sale, whether the
 * checkout webhook or the POS sold it), and the restock in `cancel-order.ts`.
 * The hub's own comment calls the collection "adjustment history".
 *
 * Its only reader was arithmetic: `cancel-order.ts` projects `appliedDelta`
 * off the `reason: 'sale'` rows to cap what a cancellation may put back. No
 * surface displayed a single one of them. A merchant whose count disagreed
 * with the shelf had no way to see what moved it, when, or why — and the one
 * number that reconciles the discrepancy was written on every adjustment and
 * unreachable.
 *
 * `delta` is what the merchant's history says moved; `appliedDelta` is what
 * the count could actually give up when the floor in `adjustVariantInventory`
 * absorbed part of it, which happens on a backorder product selling past
 * zero. They differ rarely and they differ importantly — three sold out of a
 * count of zero is exactly the state a merchant is trying to explain — so
 * both are shown when they disagree and only `delta` when they do not.
 *
 * ## Every filter is on the query (AGL-3321)
 *
 * The ledger used to read its hundred newest movements and filter those, so
 * "Damaged" searched a hundred rows and answered "none" about a ledger full
 * of older ones. Now the Filters panel's clauses are the query's `where`s —
 * see `STOCK_MOVEMENT_QUERY` for what each one costs — and the footer pages
 * the query's answer, so page three of "Damaged" is the third page of damage
 * the ledger holds, however far back it goes.
 */
export function StockMovementsCard(props: StockMovementsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()

  // Names, so a row reads as "Desk lamp" rather than a 20-character id, and
  // the Product filter's choices.
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'products'),
        PRODUCT_NAMES_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: locationDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'locations'),
        LOCATION_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const products = useMemo(
    () => ceilingedWindow<any>(productDocs ?? undefined, PRODUCT_NAMES_CEILING).rows,
    [productDocs],
  )
  const productNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const product of products) {
      names.set(product.$id, product.name ?? product.$id)
    }
    return names
  }, [products])

  const filterOptions = useMemo(
    () => ({
      productId: [...productNames]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      reason: REASON_OPTIONS,
      locationId: ceilingedWindow<any>(locationDocs ?? undefined, LOCATION_CEILING).rows.map(
        (location: any) => ({ value: location.$id, label: location.name ?? location.$id }),
      ),
    }),
    [productNames, locationDocs],
  )

  const gridFilter = useListGridFilter({ selectFields: STOCK_MOVEMENT_SELECT_FIELDS })
  // Every header sorts (AGL-3680); newest first until one is clicked.
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(STOCK_MOVEMENT_COLUMN_SORTS[0])
  const {
    rows: movementRows,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
    status,
  } = useListQuery<MovementRow>({
    collection: collection(firestore, 'hosts', hostId, 'inventoryAdjustments'),
    declaration: STOCK_MOVEMENT_QUERY,
    request: { clauses: gridFilter.clauses, sort: askedSort },
    deps: [firestore, hostId],
    idField: '$id',
  })
  const movements = useMemo(
    () =>
      movementRows.map((row) => ({
        ...row,
        productName: productNames.get(row.productId) ?? row.productId,
      })),
    [movementRows, productNames],
  )
  const columnSort = useListColumnSort({
    sorts: STOCK_MOVEMENT_COLUMN_SORTS,
    defaultSort: STOCK_MOVEMENT_COLUMN_SORTS[0],
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: plan.orderBy,
    rows: movements,
    pageSorts: MOVEMENT_PAGE_SORTS,
    headers: MOVEMENT_PAGE_SORT_HEADERS,
  })

  const columns = useMemo(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'atMs',
            headerName: 'When',
            width: 190,
            renderCell: ({ row }: { row: MovementRow }) =>
              row.atMs ? new Date(Number(row.atMs)).toLocaleString() : '—',
          },
          {
            field: 'productId',
            headerName: 'Product',
            flex: 1,
            minWidth: 180,
            renderCell: ({ row }: { row: MovementRow & { productName: string } }) => (
              <span>
                {row.productName}
                {row.variantId ? (
                  <Typography variant="caption" color="text.secondary">
                    {` · ${row.variantId}`}
                  </Typography>
                ) : null}
              </span>
            ),
          },
          {
            field: 'delta',
            headerName: 'Change',
            type: 'number',
            width: 150,
            align: 'right',
            headerAlign: 'right',
            renderCell: ({ row }: { row: MovementRow }) => {
              const delta = Number(row.delta ?? 0)
              const applied = Number(row.appliedDelta ?? delta)
              return (
                <span>
                  {/*
                   * The sign is carried explicitly. "3" and "-3" are the same
                   * width and opposite facts, and a merchant scanning a column
                   * for the movement that broke their count reads the sign
                   * before the number.
                   */}
                  <Typography
                    variant="body2"
                    color={delta < 0 ? 'error.main' : 'success.main'}
                    component="span"
                  >
                    {delta > 0 ? `+${delta}` : String(delta)}
                  </Typography>
                  {applied !== delta ? (
                    <Typography variant="caption" color="text.secondary">
                      {` (${applied > 0 ? `+${applied}` : applied} applied)`}
                    </Typography>
                  ) : null}
                </span>
              )
            },
          },
          {
            field: 'reason',
            headerName: 'Reason',
            width: 150,
            renderCell: ({ row }: { row: MovementRow }) =>
              STOCK_MOVEMENT_REASON_LABEL[row.reason] ?? row.reason,
          },
          {
            field: 'source',
            headerName: 'Source',
            flex: 1,
            minWidth: 160,
            renderCell: ({ row }: { row: MovementRow }) => (
              <Typography variant="caption" color="text.secondary">
                {movementSource(row) || '—'}
              </Typography>
            ),
          },
        ] as GridColDef[],
        STOCK_MOVEMENT_FILTER_FIELDS,
        filterOptions,
        STOCK_MOVEMENT_FILTER_HEADERS,
      ),
    [filterOptions],
  )

  const filtering = gridFilter.clauses.length > 0
  // The ledger is empty only when an UNFILTERED first page came back empty;
  // a filter that matches nothing keeps the grid, its chips and its panel.
  const empty =
    status === 'success' &&
    !filtering &&
    askedSort === STOCK_MOVEMENT_COLUMN_SORTS[0] &&
    page === 0 &&
    movements.length === 0

  return (
    <CardDisplay header="Stock movements" help={movementsHelp} contentGutterX contentGutterY>
      <Stack spacing={2}>
        {empty ? (
          <Typography variant="body2" color="text.secondary">
            {'No stock movements recorded yet. Sales, returns, cancellations ' +
              'and hand adjustments all land here.'}
          </Typography>
        ) : (
          <>
            <ListFilterChips
              fields={STOCK_MOVEMENT_FILTER_FIELDS}
              headers={STOCK_MOVEMENT_FILTER_HEADERS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
              options={filterOptions}
            />
            <ListQueryNotices
              refused={listQueryRefusals(plan.refused, {
                fields: STOCK_MOVEMENT_FILTER_FIELDS,
                headers: STOCK_MOVEMENT_FILTER_HEADERS,
                options: filterOptions,
              })}
              notices={[...plan.notices, ...columnSort.notices]}
            />
            <ListTable
              aria-label="Stock movements"
              rows={columnSort.rows}
              columns={columns}
              /*
               * The grid must NOT also filter or sort on its own. The query
               * answers the filters, and every header order is the query's
               * or the page's (`columnSort`).
               */
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              columnSort={columnSort}
              // `ListPagination` below pages the query.
              hideFooter
              noRowsLabel="No stock movements match these filters"
              initialState={{
                columns: {
                  columnVisibilityModel: hiddenFilterVisibility(
                    STOCK_MOVEMENT_FILTER_FIELDS,
                    VISIBLE_COLUMNS,
                  ),
                },
              }}
            />
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={movements.length}
              hasMore={hasMore}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
StockMovementsCard.displayName = 'StockMovementsCard'

export default StockMovementsCard
