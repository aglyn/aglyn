'use client'

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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { TAX_ENGINES_API_ROUTES } from '../constants/api-routes'
import type { TaxEngineTransactionView } from '../model/tax-engines'
import { useTaxEnginesFetch } from './tax-engines-api'

/**
 * What commerce's `orderDetail` zone hands a widget, restated: the site and
 * the order. Only the id is read.
 */
export interface OrderTaxRecordProps {
  hostId: string
  order: { id: string; currency?: string }
}

const STATUS: Record<TaxEngineTransactionView['status'], { label: string; color: 'success' | 'warning' | 'error' | 'default' }> = {
  committed: { label: 'Recorded', color: 'success' },
  pending: { label: 'Recording', color: 'warning' },
  failed: { label: 'Not recorded', color: 'error' },
  voided: { label: 'Voided', color: 'default' },
}

function money(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  } catch {
    return (cents / 100).toFixed(2)
  }
}

/**
 * Where an order stands with the connected tax service (AGL-3631): recorded,
 * still on its way, refused — with the service's own sentence and a retry —
 * or voided, plus what refunds reversed. Draws nothing for an order that was
 * never sent to one.
 */
export function OrderTaxRecord(props: OrderTaxRecordProps) {
  const { hostId, order } = props
  const request = useTaxEnginesFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [transaction, setTransaction] = useState<TaxEngineTransactionView | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const answer = await request<{ transaction: TaxEngineTransactionView | null }>(
        TAX_ENGINES_API_ROUTES.orderTransaction,
        { query: { hostId, orderId: order.id } },
      )
      setTransaction(answer.transaction)
    } catch {
      setTransaction(null)
    }
  }, [hostId, order.id, request])

  useEffect(() => {
    void load()
  }, [load])

  if (!transaction) return null
  const status = STATUS[transaction.status]

  const handleRetry = async () => {
    setBusy(true)
    try {
      const answer = await request<{ transaction: TaxEngineTransactionView }>(
        TAX_ENGINES_API_ROUTES.orderTransactionRetry,
        { body: { hostId, orderId: order.id } },
      )
      setTransaction(answer.transaction)
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{transaction.providerLabel}</Typography>
        <Chip size="small" color={status.color} label={status.label} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {`Tax of ${money(transaction.taxCents, order.currency)} recorded under ${transaction.code}` +
          (transaction.refunds > 0
            ? `; ${transaction.refunds} refund${transaction.refunds === 1 ? '' : 's'} of ${money(
                transaction.refundedCents,
                order.currency,
              )} reversed.`
            : '.')}
      </Typography>
      {transaction.fallbackReason ? (
        <Alert severity="warning">
          {`${transaction.providerLabel} ${
            transaction.fallbackReason === 'timeout' ? 'did not answer in time' : 'could not price this sale'
          } at checkout, so it was taxed at the store’s own rates. The tax recorded is what the buyer paid.`}
        </Alert>
      ) : null}
      {transaction.lastError ? <Alert severity={transaction.status === 'failed' ? 'error' : 'warning'}>{transaction.lastError}</Alert> : null}
      {transaction.status === 'failed' || transaction.status === 'pending' ? (
        <Button size="small" disabled={busy} onClick={handleRetry} sx={{ alignSelf: 'flex-start' }}>
          {'Record it again'}
        </Button>
      ) : null}
    </Stack>
  )
}

export default OrderTaxRecord
