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

import * as CommerceModel from '../../model'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Divider, Stack, TextField, Typography } from '@mui/material'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useCallback, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/**
 * The pickup or local delivery of one order (AGL-3624), and the next step
 * the store can take with it, posted to `/api/commerce/local-fulfillment`.
 * Shared by the order dialog and the pickup and delivery queue, so both say
 * the same thing and take the same steps.
 */

export type LocalFulfillmentStep =
  | 'ready'
  | 'preparing'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'delivery_failed'

const STEP_DONE: Record<LocalFulfillmentStep, string> = {
  ready: 'Marked ready — the buyer has been told',
  preparing: 'Back to preparing',
  picked_up: 'Marked picked up',
  out_for_delivery: 'Out for delivery — the buyer has been told',
  delivered: 'Marked delivered',
  delivery_failed: 'Delivery marked failed',
}

/** Posts one step. Resolves `true` when the order moved (or already had). */
export function useLocalFulfillmentStep(hostId: string) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (orderId: string, action: LocalFulfillmentStep, extra: Record<string, unknown> = {}) => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user, '/api/commerce/local-fulfillment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, orderId, action, ...extra }),
        })
        const payload: any = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(
            payload?.error ??
              `The update failed (${response.status}) and it is not known whether it landed. Reopen the order to check.`,
            { variant: response.status === 409 ? 'warning' : 'error', allowDuplicate: true },
          )
          return false
        }
        enqueueSnackbar(payload?.already ? 'Already done' : STEP_DONE[action], {
          variant: 'success',
          persist: false,
        })
        return true
      } catch {
        enqueueSnackbar('The request did not complete. Reopen the order to check — retrying is safe.', {
          variant: 'error',
          allowDuplicate: true,
        })
        return false
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar, hostId, user],
  )
  return { run, busy }
}

/** The steps an order can take next, in the order a person takes them. */
export function nextLocalFulfillmentSteps(
  order: Pick<CommerceModel.HostOrder, 'fulfillmentMethod' | 'pickup' | 'localDelivery' | 'status'>,
): Array<{ step: LocalFulfillmentStep; label: string; primary?: boolean }> {
  if (['cancelled', 'refunded', 'pending'].includes(order.status)) return []
  if (order.fulfillmentMethod === 'pickup' && order.pickup) {
    const status = CommerceModel.orderPickupStatus(order.pickup.status)
    if (status === 'preparing') {
      return [
        { step: 'ready', label: 'Mark ready', primary: true },
        { step: 'picked_up', label: 'Picked up' },
      ]
    }
    if (status === 'ready') {
      return [
        { step: 'picked_up', label: 'Picked up', primary: true },
        { step: 'preparing', label: 'Not ready yet' },
      ]
    }
    return []
  }
  if (order.fulfillmentMethod === 'local_delivery' && order.localDelivery) {
    const status = CommerceModel.orderLocalDeliveryStatus(order.localDelivery.status)
    if (status === 'scheduled' || status === 'failed') {
      return [
        { step: 'out_for_delivery', label: 'Out for delivery', primary: true },
        { step: 'delivered', label: 'Delivered' },
      ]
    }
    if (status === 'out_for_delivery') {
      return [
        { step: 'delivered', label: 'Delivered', primary: true },
        { step: 'delivery_failed', label: 'Couldn’t deliver' },
      ]
    }
  }
  return []
}

export function OrderLocalFulfillmentPanel(props: {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
}) {
  const { hostId, orderId, order } = props
  const { run, busy } = useLocalFulfillmentStep(hostId)
  const [failing, setFailing] = useState(false)
  const [reason, setReason] = useState('')
  if (!CommerceModel.orderIsLocallyFulfilled(order)) return null
  const steps = nextLocalFulfillmentSteps(order)
  const take = (step: LocalFulfillmentStep) => {
    if (step === 'delivery_failed' && !failing) return setFailing(true)
    void run(orderId, step, step === 'delivery_failed' && reason.trim() ? { reason: reason.trim() } : {}).then(
      (moved) => {
        if (moved) {
          setFailing(false)
          setReason('')
        }
      },
    )
  }
  const pickup = order.fulfillmentMethod === 'pickup' ? order.pickup : undefined
  const delivery = order.fulfillmentMethod === 'local_delivery' ? order.localDelivery : undefined
  return (
    <>
      <Divider />
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {pickup ? 'Pickup' : 'Local delivery'}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={
              pickup
                ? CommerceModel.ORDER_PICKUP_STATUS_LABELS[CommerceModel.orderPickupStatus(pickup.status)]
                : CommerceModel.ORDER_LOCAL_DELIVERY_STATUS_LABELS[
                    CommerceModel.orderLocalDeliveryStatus(delivery?.status)
                  ]
            }
          />
        </Stack>
        {pickup ? (
          <>
            <Typography variant="body2">
              {pickup.locationName}
              {pickup.address ? ` — ${pickup.address}` : ''}
            </Typography>
            {pickup.pickedUpBy ? (
              <Typography variant="caption" color="text.secondary">{`Collected by ${pickup.pickedUpBy}`}</Typography>
            ) : null}
          </>
        ) : null}
        {delivery ? (
          <>
            <Typography variant="body2">
              {[delivery.windowLabel, delivery.zoneName, delivery.postalCode].filter(Boolean).join(' · ')}
            </Typography>
            {delivery.addressOutsideZone ? (
              <Alert severity="warning">
                {'The address entered at payment is outside your delivery zones. Contact the buyer, or refund the delivery.'}
              </Alert>
            ) : null}
            {delivery.failedReason ? (
              <Typography variant="caption" color="text.secondary">{`Last attempt: ${delivery.failedReason}`}</Typography>
            ) : null}
          </>
        ) : null}
        {failing ? (
          <TextField
            label="What happened (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            size="small"
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        ) : null}
        {steps.length ? (
          <Stack direction="row" spacing={1}>
            {steps.map((entry) => (
              <Button
                key={entry.step}
                size="small"
                variant={entry.primary ? 'contained' : 'text'}
                disabled={busy}
                onClick={() => take(entry.step)}
              >
                {entry.step === 'delivery_failed' && failing ? 'Save' : entry.label}
              </Button>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </>
  )
}
OrderLocalFulfillmentPanel.displayName = 'OrderLocalFulfillmentPanel'

export default OrderLocalFulfillmentPanel
