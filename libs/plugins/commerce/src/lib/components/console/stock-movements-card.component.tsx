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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  Alert,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import * as CommerceModel from '../../model'

export interface StockMovementsCardProps {
  hostId: string
}

/**
 * How many rows the listener holds.
 *
 * Ordered by `atMs` descending, which is a SINGLE-FIELD index Firestore
 * maintains automatically — no composite, so nothing here can drift from
 * `cloud/firebase-firestore.indexes.json`. Filtering by product happens over
 * this window rather than in the query for exactly that reason: an equality
 * filter plus this ordering is a composite index, and an index that has to be
 * deployed by hand is an index the feature ships without.
 */
const WINDOW = 100

const movementsHelp = pluginDocsHelp('commerce', {
  anchor: '#stock-movements',
  title: 'Stock movements',
  excerpt:
    'Every change to a tracked count — sales, returns, cancellations and ' +
    'hand adjustments — newest first, with the reason each one was made.',
})

/** The stored key is a closed set; these are what a merchant reads. */
const REASON_LABEL: Record<CommerceModel.InventoryAdjustmentReason, string> = {
  sale: 'Sale',
  refund: 'Refund return',
  restock: 'Restock',
  correction: 'Correction',
  damage: 'Damaged',
  cancellation: 'Order canceled',
}

type MovementRow = CommerceModel.InventoryAdjustment & { $id: string }

/**
 * Stock movements (AGL-2341) — the adjustment history that had no history
 * view.
 *
 * `hosts/{hostId}/inventoryAdjustments` has five writers: the products hub's
 * "Adjust stock" dialog, the sale path in `billing-webhook.ts`, the POS in
 * `pos-order.ts`, and the restock in `cancel-order.ts`. The hub's own comment
 * calls the collection "adjustment history".
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
 */
export function StockMovementsCard(props: StockMovementsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const [productFilter, setProductFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')

  const { data: movementDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'inventoryAdjustments'),
        orderBy('atMs', 'desc'),
        /*
         * `WINDOW + 1` is a PROBE (AGL-2501). One document beyond the ceiling
         * turns "there are older movements than these" into a fact for the
         * price of a single read. The comparison it replaces —
         * `length >= WINDOW` — is wrong at exactly the count that equals the
         * ceiling, which is the one ledger size where a merchant is told
         * rows are missing and none are. The probe row is sliced off below
         * and never rendered.
         */
        limit(WINDOW + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Names, so a row reads as "Desk lamp" rather than a 20-character id. The
  // products hub above runs this exact query, so the SDK shares one listener.
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'products'), limit(500)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const productNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const product of productDocs ?? []) {
      names.set(product.$id, product.name ?? product.$id)
    }
    return names
  }, [productDocs])

  /** Read beyond the ceiling — so the ledger holds more than was read. */
  const truncated = (movementDocs?.length ?? 0) > WINDOW
  /** The window itself, probe row removed. */
  const windowRows = useMemo(
    () => ((movementDocs ?? []) as MovementRow[]).slice(0, WINDOW),
    [movementDocs],
  )

  const movements: MovementRow[] = useMemo(
    () =>
      [...windowRows]
        // The query already orders, but a cached snapshot can arrive before
        // the server's and the sort is what makes "newest first" a promise
        // rather than a hope.
        .sort((a, b) => Number(b.atMs ?? 0) - Number(a.atMs ?? 0))
        .filter(
          (row) => productFilter === 'all' || row.productId === productFilter,
        )
        .filter((row) => reasonFilter === 'all' || row.reason === reasonFilter),
    [windowRows, productFilter, reasonFilter],
  )

  /*
   * The page is a SLICE of the window, and the window stays where it is.
   *
   * Paging the QUERY would be the cheaper read and the wrong control here,
   * because both filters above run in the browser: on a ten-row server page
   * "Damaged" would search ten movements instead of a hundred and answer "no
   * stock movements" about a ledger full of them. Moving those filters to the
   * server is what would earn a query-level page, and it cannot be done
   * without composite indexes this feature would then ship without — see
   * `WINDOW`. So the read is unchanged and the wall of a hundred rows becomes
   * a footer over them.
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // A filter narrows the list under the reader's feet, and page four of the
  // unfiltered ledger is not a position in the filtered one — MUI renders an
  // out-of-range page as an empty table with no explanation, which reads as
  // the filter having matched nothing.
  useEffect(() => setPage(0), [productFilter, reasonFilter])
  const shown = useMemo(
    () => movements.slice(page * pageSize, page * pageSize + pageSize),
    [movements, page, pageSize],
  )

  /** Products that actually appear in the window — filtering to an empty
   * option is a dead end, and the whole catalog is not the answer here. */
  const filterableProducts = useMemo(() => {
    const ids = new Set<string>()
    for (const row of windowRows) {
      if (row.productId) ids.add(row.productId)
    }
    return [...ids].sort((a, b) =>
      (productNames.get(a) ?? a).localeCompare(productNames.get(b) ?? b),
    )
  }, [windowRows, productNames])

  return (
    <CardDisplay header="Stock movements" help={movementsHelp} contentGutterX contentGutterY>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2}>
          <TextField
            label="Product"
            size="small"
            select
            value={productFilter}
            onChange={(event) => setProductFilter(event.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="all">{'All products'}</MenuItem>
            {filterableProducts.map((productId) => (
              <MenuItem key={productId} value={productId}>
                {productNames.get(productId) ?? productId}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Reason"
            size="small"
            select
            value={reasonFilter}
            onChange={(event) => setReasonFilter(event.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="all">{'Every reason'}</MenuItem>
            {Object.entries(REASON_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {movements.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No stock movements recorded yet. Sales, returns, cancellations ' +
              'and hand adjustments all land here.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'When'}</TableCell>
                <TableCell>{'Product'}</TableCell>
                <TableCell align="right">{'Change'}</TableCell>
                <TableCell>{'Reason'}</TableCell>
                <TableCell>{'Source'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((row) => {
                const delta = Number(row.delta ?? 0)
                const applied = Number(row.appliedDelta ?? delta)
                return (
                  <TableRow key={row.$id}>
                    <TableCell>
                      {row.atMs
                        ? new Date(Number(row.atMs)).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {productNames.get(row.productId) ?? row.productId}
                      {row.variantId ? (
                        <Typography variant="caption" color="text.secondary">
                          {` · ${row.variantId}`}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">
                      {/*
                       * The sign is carried explicitly. "3" and "-3" are the
                       * same width and opposite facts, and a merchant
                       * scanning a column for the movement that broke their
                       * count reads the sign before the number.
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
                    </TableCell>
                    <TableCell>
                      {REASON_LABEL[row.reason] ?? row.reason}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          row.orderId ? `order ${row.orderId}` : null,
                          row.locationId ? `at ${row.locationId}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {movements.length === 0 ? null : (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={shown.length}
            // The movements matching the filters, which this card genuinely
            // holds. What it does not know is how many are older than the
            // window, and the notice below says so rather than letting the
            // count line imply a ledger total it cannot see.
            count={movements.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
        {truncated ? (
          <Alert severity="info">
            {`Paging the ${WINDOW} most recent movements. Older rows are ` +
              'kept and reachable through a data export.'}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
StockMovementsCard.displayName = 'StockMovementsCard'

export default StockMovementsCard
