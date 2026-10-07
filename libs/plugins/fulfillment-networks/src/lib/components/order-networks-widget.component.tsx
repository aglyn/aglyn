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

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  NETWORK_PROVIDERS,
  type NetworkOrderStatus,
  type NetworkOrderView,
  type NetworkProviderId,
} from '../model/networks'
import {
  useFulfillmentNetworksApi,
  type FulfillmentNetworksApi,
  type NetworkOrderAnswer,
} from './fulfillment-networks-api'

/**
 * The props the commerce plugin's `orderDetail` zone hands a widget, restated
 * here — a plugin never imports another — down to the fields this widget
 * reads.
 */
export interface OrderNetworksWidgetProps {
  hostId: string
  orgId?: string
  order: {
    id: string
    number: string
    status: string
    lines: ReadonlyArray<{ lineItemId: number; name: string; remainingQuantity: number; requiresShipping: boolean }>
  }
  /** Test seam: the API; the routes by default. */
  api?: FulfillmentNetworksApi
}

const STATUS: Readonly<Record<NetworkOrderStatus, { label: string; tone: StatusTone }>> = {
  queued: { label: 'Waiting to send', tone: 'info' },
  accepted: { label: 'With the network', tone: 'info' },
  partially_shipped: { label: 'Partly shipped', tone: 'warning' },
  shipped: { label: 'Shipped', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  failed: { label: 'Not sent', tone: 'error' },
  skipped: { label: 'Not sent', tone: 'neutral' },
}

const TRACKING: Readonly<Record<string, string>> = {
  pre_transit: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Delivery problem',
  returned: 'Returned',
}

/** Statuses in which the network holds units it can still be asked to cancel. */
const CANCELABLE: ReadonlySet<NetworkOrderStatus> = new Set(['queued', 'accepted', 'partially_shipped'])
/** Statuses after which the order may be sent to the network again. */
const SENDABLE_AGAIN: ReadonlySet<NetworkOrderStatus> = new Set(['canceled', 'failed', 'skipped'])
/** Order statuses a network may still be sent lines of. */
const OPEN_ORDER = new Set(['paid', 'partially_fulfilled'])

/**
 * FULFILLMENT NETWORKS ON ONE ORDER (AGL-3634): where the order stands with
 * each network the store connected — what was sent, what shipped with which
 * tracking, and why anything was not sent — with "Send to" and "Cancel at"
 * beside it. Draws nothing when the store connected no network.
 */
export function OrderNetworksWidget(props: OrderNetworksWidgetProps) {
  const { hostId, order } = props
  const routesApi = useFulfillmentNetworksApi(hostId)
  const api = props.api ?? routesApi
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [answer, setAnswer] = useState<NetworkOrderAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.order(order.id).then(
      (next) => live && setAnswer(next),
      () => live && setAnswer({ connections: [], routings: [] }),
    )
    return () => {
      live = false
    }
  }, [api, order.id])

  const run = useCallback(
    async (work: () => Promise<NetworkOrderAnswer>, done: string) => {
      setBusy(true)
      setError(null)
      try {
        setAnswer(await work())
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar],
  )

  if (!answer || (!answer.connections.length && !answer.routings.length)) return null

  const unshipped = order.lines.some((line) => line.requiresShipping && line.remainingQuantity > 0)
  const routingOf = (provider: NetworkProviderId) => answer.routings.find((routing) => routing.provider === provider)
  const sendable = answer.connections.filter((connection) => {
    if (connection.status === 'reconnect' || !unshipped || !OPEN_ORDER.has(order.status)) return false
    const routing = routingOf(connection.provider)
    return !routing || SENDABLE_AGAIN.has(routing.status)
  })

  const cancel = async (provider: NetworkProviderId) => {
    const label = NETWORK_PROVIDERS[provider].label
    const accepted = await confirm({
      title: `Cancel at ${label}?`,
      description: `${label} is asked to stop this order. If it has already started packing it may be too late, and anything that ships still comes back to the order.`,
      confirmationText: 'Cancel at network',
      cancellationText: 'Keep it',
      confirmationButtonProps: { color: 'error' },
    }).then(
      () => true,
      () => false,
    )
    if (accepted) await run(() => api.cancel(order.id, provider), `Asked ${label} to cancel.`)
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Fulfillment networks
        </Typography>
        {sendable.map((connection) => (
          <Button
            key={connection.provider}
            variant="outlined"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.send(order.id, connection.provider),
                `Sent to ${NETWORK_PROVIDERS[connection.provider].label}.`,
              )
            }
          >
            {`Send to ${NETWORK_PROVIDERS[connection.provider].shortLabel}`}
          </Button>
        ))}
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        {answer.routings.length ? (
          answer.routings.map((routing) => (
            <RoutingRow key={routing.provider} routing={routing} busy={busy} onCancel={() => void cancel(routing.provider)} />
          ))
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Not sent to a network yet.'}
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
OrderNetworksWidget.displayName = 'OrderNetworksWidget'

function RoutingRow(props: { routing: NetworkOrderView; busy: boolean; onCancel: () => void }) {
  const { routing, busy, onCancel } = props
  const info = NETWORK_PROVIDERS[routing.provider]
  const status = STATUS[routing.status]
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <StatusChip label={status.label} tone={status.tone} />
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
          {[info.label, routing.reference ? `ref. ${routing.reference}` : null].filter(Boolean).join(' · ')}
        </Typography>
        {CANCELABLE.has(routing.status) && !routing.cancelRequested ? (
          <Button size="small" color="error" disabled={busy} onClick={onCancel}>
            {`Cancel at ${info.shortLabel}`}
          </Button>
        ) : null}
        {routing.cancelRequested ? <StatusChip label="Cancel requested" tone="warning" variant="outlined" /> : null}
      </Stack>
      {routing.lines.length ? (
        <Typography variant="body2" color="text.secondary">
          {routing.lines
            .map(
              (line) =>
                `${line.quantity} × ${line.name}${line.shippedQuantity ? ` (${line.shippedQuantity} shipped)` : ''}`,
            )
            .join(' · ')}
        </Typography>
      ) : null}
      {routing.shipments.map((shipment) => (
        <Typography key={shipment.id} variant="body2" color="text.secondary">
          {[shipment.carrier, shipment.trackingStatus ? (TRACKING[shipment.trackingStatus] ?? null) : null]
            .filter(Boolean)
            .join(' · ')}
          {shipment.trackingNumber ? ' · ' : ''}
          {shipment.trackingNumber && shipment.trackingUrl ? (
            <Link href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer">
              {shipment.trackingNumber}
            </Link>
          ) : (
            shipment.trackingNumber
          )}
        </Typography>
      ))}
      {routing.note ? (
        <Alert severity={routing.status === 'failed' ? 'error' : routing.status === 'skipped' ? 'info' : 'warning'}>
          {routing.note}
        </Alert>
      ) : null}
    </Stack>
  )
}

export default OrderNetworksWidget
