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

import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Link, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import { POD_ORDER_STATUS_LABELS, type PodOrderView } from '../model/print-on-demand'
import { formatMoney, POD_STATUS_TONE, usePodFetch } from './pod-api'

/**
 * What commerce's `orderDetail` zone hands a widget, restated: the site and
 * the order. Only the id is read.
 */
export interface OrderPodPartsProps {
  hostId: string
  order: { id: string }
}

const ACTION_LABELS: Record<PodOrderView['actions'][number], string> = {
  send: 'Send now',
  retry: 'Send again',
  confirm: 'Confirm for production',
  refresh: 'Check for updates',
  cancel: 'Cancel at the service',
}

/**
 * Where an order's print-on-demand lines stand (AGL-3641): which service is
 * making them, its status, what it charged against what the buyer paid, the
 * parcels it shipped, and what the member can do — confirm a draft, send a
 * failed order again, cancel. Draws nothing for an order no service fills.
 */
export function OrderPodParts(props: OrderPodPartsProps) {
  const { hostId, order } = props
  const request = usePodFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [parts, setParts] = useState<PodOrderView[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const answer = await request<{ parts: PodOrderView[] }>(POD_API_ROUTES.order, { query: { hostId, orderId: order.id } })
      setParts(answer.parts)
    } catch {
      setParts([])
    }
  }, [hostId, order.id, request])

  useEffect(() => {
    void load()
  }, [load])

  if (!parts.length) return null

  const act = async (part: PodOrderView, action: PodOrderView['actions'][number]) => {
    setBusy(true)
    try {
      const answer = await request<{ part: PodOrderView | null }>(POD_API_ROUTES.orderAction, {
        body: { hostId, orderId: order.id, provider: part.provider, action },
      })
      if (answer.part) setParts((current) => current.map((entry) => (entry.id === part.id ? (answer.part as PodOrderView) : entry)))
    } catch (cause) {
      const payload = (cause as { payload?: { part?: PodOrderView | null } }).payload
      if (payload?.part) setParts((current) => current.map((entry) => (entry.id === part.id ? (payload.part as PodOrderView) : entry)))
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2}>
      {parts.map((part) => {
        const cost = part.costs
        const sameCurrency = cost && cost.currency === part.retailCurrency
        return (
          <Stack key={part.id} spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">{part.providerLabel}</Typography>
              <StatusChip label={POD_ORDER_STATUS_LABELS[part.status]} tone={POD_STATUS_TONE[part.status]} />
              {part.testMode ? <StatusChip label="Test order — never made" tone="warning" variant="outlined" /> : null}
              {part.dashboardUrl ? (
                <Link href={part.dashboardUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                  {`Open in ${part.providerLabel}`}
                </Link>
              ) : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {part.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}
            </Typography>
            {cost ? (
              <Typography variant="body2">
                {`${part.providerLabel} charged ${formatMoney(cost.totalMinor, cost.currency)} (items ${formatMoney(cost.itemsMinor, cost.currency)}, shipping ${formatMoney(cost.shippingMinor, cost.currency)}, tax ${formatMoney(cost.taxMinor, cost.currency)}). ` +
                  `The buyer paid ${formatMoney(part.retailMinor, part.retailCurrency)} for these items` +
                  (sameCurrency ? `, a margin of ${formatMoney(part.retailMinor - cost.totalMinor, cost.currency)} before your own shipping charge and fees.` : '.')}
              </Typography>
            ) : null}
            {part.shipments.map((shipment) => (
              <Typography key={shipment.id} variant="body2">
                {`${shipment.carrier} `}
                {shipment.trackingUrl ? (
                  <Link href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer">
                    {shipment.trackingNumber}
                  </Link>
                ) : (
                  shipment.trackingNumber
                )}
                {shipment.deliveredAtMs ? ' — delivered' : shipment.recorded ? ' — on the order' : ' — not yet on the order'}
              </Typography>
            ))}
            {part.lastError ? <Alert severity={part.status === 'failed' ? 'error' : 'warning'}>{part.lastError}</Alert> : null}
            {part.actions.length ? (
              <Stack direction="row" spacing={1}>
                {part.actions.map((action) => (
                  <Button
                    key={action}
                    size="small"
                    disabled={busy}
                    color={action === 'cancel' ? 'error' : 'primary'}
                    variant={action === 'confirm' || action === 'retry' ? 'contained' : 'text'}
                    onClick={() => void act(part, action)}
                  >
                    {ACTION_LABELS[action]}
                  </Button>
                ))}
              </Stack>
            ) : null}
          </Stack>
        )
      })}
    </Stack>
  )
}

export default OrderPodParts
