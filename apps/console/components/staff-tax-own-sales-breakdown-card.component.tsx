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
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { sortListRows } from '@aglyn/shared-util-tools/list-query/list-column-sort'
import {
  Chip,
  Stack,
  TableBody,
  TableCell,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import {
  taxReturnFilingJurisdiction,
  taxReturnOwnSalesBreakdown,
  type TaxReturnOwnSalesBreakdownRow,
  type TaxReturnPayload,
} from '../utils/tx-return-webfile'
import { TAX_RETURN_COPY } from '../utils/tax-return-view'
import StaffTableHead from './staff-table-head.component'

/**
 * WHAT THE FILING FIGURES ARE MADE OF (AGL-4038).
 *
 * The figures beside this card add the operator's own sales outside its
 * invoices — the device shop, its own stores — to the invoices' own. This
 * card lists every one of them by source and jurisdiction, so a preparer can
 * check the sum before typing it anywhere: the rows marked "In the figures"
 * add up to the figures exactly, and the rest are the operator's own sales
 * elsewhere. Every column sorts (AGL-3680).
 */
interface Column {
  label: string
  numeric?: boolean
  value: (row: TaxReturnOwnSalesBreakdownRow) => string | number | null
}

const money = (dollars: string | null) => (dollars === null ? '—' : `$${dollars}`)

const COLUMNS: Column[] = [
  { label: 'Source', value: (row) => row.source },
  { label: 'Jurisdiction', value: (row) => row.jurisdiction },
  { label: 'Sales', numeric: true, value: (row) => row.transactionCount },
  { label: 'Total sales', numeric: true, value: (row) => Number(row.totalSalesDollars) },
  { label: 'Taxable sales', numeric: true, value: (row) => Number(row.taxableSalesDollars) },
  { label: 'Tax collected', numeric: true, value: (row) => Number(row.taxCollectedDollars) },
  {
    label: 'Refunded in period',
    numeric: true,
    value: (row) => (row.refundedSalesDollars === null ? null : Number(row.refundedSalesDollars)),
  },
]

export interface StaffTaxOwnSalesBreakdownCardProps {
  payload: TaxReturnPayload | null
}

export function StaffTaxOwnSalesBreakdownCard({ payload }: StaffTaxOwnSalesBreakdownCardProps) {
  const filing = taxReturnFilingJurisdiction(payload)
  const breakdown = useMemo(() => taxReturnOwnSalesBreakdown(payload), [payload])
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null)
  const rows = useMemo(
    () =>
      sort
        ? sortListRows(breakdown, (row) => COLUMNS[sort.column].value(row), sort.direction)
        : breakdown,
    [breakdown, sort],
  )
  // Ascending, descending, then the return's own order again.
  const sortBy = (column: number) =>
    setSort((current) =>
      current?.column !== column
        ? { column, direction: 'asc' }
        : current.direction === 'asc'
          ? { column, direction: 'desc' }
          : null,
    )
  const cells = (row: TaxReturnOwnSalesBreakdownRow) => [
    row.source,
    row.jurisdiction === 'unknown' ? 'Not stated' : row.jurisdiction,
    String(row.transactionCount),
    money(row.totalSalesDollars),
    money(row.taxableSalesDollars),
    money(row.taxCollectedDollars),
    row.refundedSalesDollars === null ? 'On the refunds card' : money(row.refundedSalesDollars),
  ]
  return (
    <CardDisplay
      header={TAX_RETURN_COPY.breakdownHeader(filing.form === 'tx-webfile')}
      help={docsHelp('salesTaxReturn', {
        anchor: '#what-the-figures-are-made-of',
        excerpt:
          'The invoices and every kind of the operator’s own sales outside them, by source and jurisdiction. The filing jurisdiction’s rows add up to the figures.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {TAX_RETURN_COPY.breakdownIntro(filing.code)}
      </Typography>
      <ScrollTable size="small">
        <StaffTableHead>
          <TableRow>
            {COLUMNS.map((column, index) => {
              const direction = sort?.column === index ? sort.direction : null
              return (
                <TableCell
                  key={column.label}
                  sortDirection={direction ?? false}
                  {...(column.numeric ? { align: 'right' as const } : {})}
                >
                  <TableSortLabel
                    active={direction !== null}
                    direction={direction ?? 'asc'}
                    onClick={() => sortBy(index)}
                  >
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              )
            })}
          </TableRow>
        </StaffTableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMNS.length}>
                <Typography variant="body2" color="text.secondary">
                  {payload ? TAX_RETURN_COPY.breakdownEmpty : '—'}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                {cells(row).map((text, index) => (
                  <TableCell
                    key={COLUMNS[index].label}
                    {...(COLUMNS[index].numeric ? { align: 'right' as const } : {})}
                    sx={{
                      // Tabular figures, so columns of cents line up.
                      ...(COLUMNS[index].numeric ? { fontVariantNumeric: 'tabular-nums' } : {}),
                      ...(row.inFigures && index === 3 ? { fontWeight: 'fontWeightMedium' } : {}),
                    }}
                  >
                    {index === 0 ? (
                      <Stack
                        useFlexGap
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="body2">{text}</Typography>
                        {row.inFigures ? (
                          <Chip size="small" color="primary" variant="outlined" label="In the figures" />
                        ) : null}
                      </Stack>
                    ) : (
                      text
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </ScrollTable>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {TAX_RETURN_COPY.breakdownFootnote}
      </Typography>
    </CardDisplay>
  )
}

export default StaffTaxOwnSalesBreakdownCard
