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

import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { MARKETPLACES, type MarketplaceOrderView } from '../model/marketplaces'
import { useMarketplacesApi, type MarketplacesApi } from './marketplaces-api'

/**
 * The props the commerce plugin's `orderDetail` zone hands a widget, restated
 * here — a plugin never imports another — down to the fields this widget
 * reads.
 */
export interface OrderMarketplaceWidgetProps {
  hostId: string
  orgId?: string
  order: { id: string; number: string; status: string }
  /** Test seam: the API; the routes by default. */
  api?: MarketplacesApi
}

const SHIPMENT: Readonly<Record<MarketplaceOrderView['shipments'][number]['state'], { label: string; tone: StatusTone }>> = {
  pending: { label: 'Sending tracking', tone: 'info' },
  confirmed: { label: 'Tracking sent', tone: 'success' },
  failed: { label: 'Not confirmed', tone: 'error' },
}

const money = (minor: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

/**
 * A MARKETPLACE ORDER (AGL-3638): which marketplace sold it and under which
 * order there, what the marketplace charged for the sale (recorded, never
 * charged by Aglyn), and whether each shipment's tracking reached it — with
 * "Send tracking again" for one it refused. Draws nothing for an order no
 * marketplace sold.
 */
export function OrderMarketplaceWidget(props: OrderMarketplaceWidgetProps) {
  const routesApi = useMarketplacesApi(props.hostId)
  const api = props.api ?? routesApi
  const { enqueueSnackbar } = useSnackbar()
  const [view, setView] = useState<MarketplaceOrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.order(props.order.id).then(
      (next) => live && setView(next),
      () => live && setView(null),
    )
    return () => {
      live = false
    }
  }, [api, props.order.id])

  if (!view) return null
  const label = MARKETPLACES[view.marketplace]?.label ?? view.marketplace
  const failed = view.shipments.some((shipment) => shipment.state === 'failed')

  const retry = async () => {
    setBusy(true)
    setError(null)
    try {
      setView((await api.retry(props.order.id)) ?? view)
      enqueueSnackbar(`Tracking sent to ${label} again.`, { variant: 'success', persist: false })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="subtitle2">{`Sold on ${label}`}</Typography>
          <Typography variant="body2" color="text.secondary">{`Order ${view.displayRef}`}</Typography>
          {view.sandbox ? <StatusChip label="Sandbox" tone="info" variant="outlined" /> : null}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {view.fees === null
            ? `${label}'s fees are not known yet.`
            : `${label}'s fees: ${money(view.feesTotalMinor ?? 0, view.currency)}${
                view.fees.length > 1 ? ` (${view.fees.map((fee) => `${fee.label} ${money(fee.amountMinor, view.currency)}`).join(', ')})` : ''
              }. Recorded for your books; ${label} takes them from your payout.`}
        </Typography>
        {view.shipments.map((shipment) => (
          <Stack key={shipment.fulfillmentId} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <StatusChip label={SHIPMENT[shipment.state].label} tone={SHIPMENT[shipment.state].tone} variant="outlined" />
            <Typography variant="body2">
              {[shipment.carrier, shipment.trackingNumber].filter(Boolean).join(' ') || 'No tracking number'}
            </Typography>
            {shipment.message ? (
              <Typography variant="body2" color="text.secondary">
                {shipment.message}
              </Typography>
            ) : null}
          </Stack>
        ))}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {failed ? (
          <Box>
            <Button size="small" disabled={busy} onClick={() => void retry()}>
              Send tracking again
            </Button>
          </Box>
        ) : null}
      </Stack>
    </Box>
  )
}

export default OrderMarketplaceWidget
