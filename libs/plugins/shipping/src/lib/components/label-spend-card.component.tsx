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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { SHIPPING_API_ROUTES } from '../constants/api-routes'
import { formatCents, useShippingFetch } from './shipping-api'

/** What `orgBillingUsage` hands a widget. */
export interface LabelSpendCardProps {
  orgId: string | undefined
}

interface SpendMonth {
  month: string
  labels: number
  chargedCents: number
  creditedCents: number
  debitedCents: number
  invoicedCents: number
}

/**
 * SHIPPING LABELS on Billing → Usage (AGL-3612): what labels cost the
 * workspace each month, how much was taken from the Stripe balance when they
 * were bought and how much rides the monthly invoice, and what voided labels
 * gave back. Draws nothing where labels do not exist, or for a workspace
 * that has never bought one.
 */
export function LabelSpendCard(props: LabelSpendCardProps) {
  const { orgId } = props
  const request = useShippingFetch()
  const [months, setMonths] = useState<SpendMonth[] | null>(null)
  const [markupPct, setMarkupPct] = useState(0)

  useEffect(() => {
    if (!orgId) return
    let live = true
    request<{ available: boolean; months?: SpendMonth[]; markupPct?: number }>(SHIPPING_API_ROUTES.spend, {
      query: { orgId },
    })
      .then((answer) => {
        if (!live || !answer.available) return
        setMonths(answer.months ?? [])
        setMarkupPct(answer.markupPct ?? 0)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [orgId, request])

  if (!months || !months.some((month) => month.labels > 0)) return null

  return (
    <CardDisplay
      header="Shipping labels"
      help={pluginDocsHelp('shipping', {
        title: 'Shipping labels',
        excerpt:
          'What shipping labels cost this workspace each month: how much was taken from your Stripe balance, how much went on the monthly invoice, and what voided labels gave back.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {markupPct > 0
          ? `Labels are charged at the carrier’s price plus ${markupPct}%.`
          : 'Labels are charged at the carrier’s price, with nothing added.'}
      </Typography>
      <ScrollTable size="small">
        <TableHead>
          <TableRow>
            <TableCell>{'Month'}</TableCell>
            <TableCell align="right">{'Labels'}</TableCell>
            <TableCell align="right">{'From Stripe balance'}</TableCell>
            <TableCell align="right">{'On invoice'}</TableCell>
            <TableCell align="right">{'Voided, returned'}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {months.map((month) => (
            <TableRow key={month.month}>
              <TableCell>{month.month}</TableCell>
              <TableCell align="right">{month.labels}</TableCell>
              <TableCell align="right">{formatCents(month.debitedCents)}</TableCell>
              <TableCell align="right">{formatCents(month.invoicedCents)}</TableCell>
              <TableCell align="right">{formatCents(month.creditedCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ScrollTable>
    </CardDisplay>
  )
}
LabelSpendCard.displayName = 'LabelSpendCard'

export default LabelSpendCard
