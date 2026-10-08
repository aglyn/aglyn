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
import { INVENTORY_PROVIDERS, type InventoryOrderStatus } from '../model/inventory-sync'
import { useInventorySyncApi, type InventoryOrderAnswer, type InventorySyncApi } from './inventory-sync-api'

/**
 * The props the commerce plugin's `orderDetail` zone hands a widget, restated
 * here — a plugin never imports another — down to the fields this widget
 * reads.
 */
export interface OrderInventoryWidgetProps {
  hostId: string
  orgId?: string
  order: { id: string }
  /** Test seam: the API; the routes by default. */
  api?: InventorySyncApi
}

const STATUS: Readonly<Record<InventoryOrderStatus, { label: string; tone: StatusTone }>> = {
  queued: { label: 'Waiting to send', tone: 'info' },
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Not sent', tone: 'error' },
  skipped: { label: 'Not sent', tone: 'neutral' },
  canceled: { label: 'Canceled', tone: 'neutral' },
}

/**
 * THE INVENTORY SYSTEM ON ONE ORDER (AGL-3642): whether the order reached the
 * store's connected Cin7 Core, inFlow or Brightpearl account, under which
 * number and reference, and why not when it did not — with Send again for
 * one that failed. Draws nothing when the order was never queued for one.
 */
export function OrderInventoryWidget(props: OrderInventoryWidgetProps) {
  const routesApi = useInventorySyncApi(props.hostId)
  const api = props.api ?? routesApi
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<InventoryOrderAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.order(props.order.id).then(
      (next) => live && setAnswer(next),
      () => live && setAnswer({ connection: null, order: null }),
    )
    return () => {
      live = false
    }
  }, [api, props.order.id])

  const handOff = answer?.order
  if (!handOff) return null
  const label = INVENTORY_PROVIDERS[handOff.provider].label
  const status = STATUS[handOff.status]
  const canSend =
    handOff.status === 'failed' &&
    answer?.connection?.provider === handOff.provider &&
    answer.connection.status !== 'reconnect'

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const sent = await api.send(handOff.recordId)
      setAnswer((current) => (current ? { ...current, order: sent.order ?? current.order } : current))
      if (sent.order?.status === 'sent') enqueueSnackbar(`Sent to ${label}.`, { variant: 'success', persist: false })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {label}
        </Typography>
        {canSend ? (
          <Button variant="outlined" disabled={busy} onClick={() => void send()}>
            Send again
          </Button>
        ) : null}
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <StatusChip label={status.label} tone={status.tone} />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
            {[handOff.externalNumber ? `${label} ${handOff.externalNumber}` : null, `ref. ${handOff.reference}`]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Stack>
        {handOff.lines.length ? (
          <Typography variant="body2" color="text.secondary">
            {handOff.lines.map((line) => `${line.quantity} × ${line.name} (${line.sku})`).join(' · ')}
          </Typography>
        ) : null}
        {handOff.note ? (
          <Alert severity={handOff.status === 'failed' ? 'error' : handOff.status === 'sent' ? 'warning' : 'info'}>
            {handOff.note}
          </Alert>
        ) : null}
      </Stack>
    </Box>
  )
}
OrderInventoryWidget.displayName = 'OrderInventoryWidget'

export default OrderInventoryWidget
