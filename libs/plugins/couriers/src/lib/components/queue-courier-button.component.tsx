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

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Link } from '@mui/material'
import { useState } from 'react'
import { useCouriersApi, useCourierConnection, type CouriersApi } from './couriers-api'
import { CourierPanel } from './courier-panel.component'
import type { CourierZoneOrder } from './order-courier-widget.component'

export interface QueueCourierButtonProps {
  hostId: string
  orgId?: string
  order: CourierZoneOrder
  /** Test seam: the API; the routes by default. */
  api?: CouriersApi
}

const ACTIVE = new Set(['requested', 'assigned', 'at_pickup', 'picked_up', 'at_dropoff', 'returning'])
/** Delivery statuses a courier may be sent from: not yet out, or a failed drop going out again. */
const SENDABLE = new Set(['scheduled', 'failed'])

/**
 * A local delivery's row in the Pickup & delivery queue (AGL-3695): "Send a
 * courier" while the drop is waiting, opening the quote and booking in a
 * dialog; the courier's own tracking link while one is on it. Nothing at all
 * on a deployment without couriers or a site with none connected.
 */
export function QueueCourierButton(props: QueueCourierButtonProps) {
  const { hostId, order } = props
  const routes = useCouriersApi(hostId)
  const api = props.api ?? routes
  const delivery = order.fulfillmentMethod === 'local_delivery' ? order.localDelivery : null
  const answer = useCourierConnection(hostId, delivery ? api : null)
  const [open, setOpen] = useState(false)
  if (!delivery || !answer?.available || !answer.connection) return null
  const courier = delivery.courier && ACTIVE.has(delivery.courier.state) ? delivery.courier : null
  if (!courier && !SENDABLE.has(delivery.status) && !open) return null
  return (
    <>
      {courier ? (
        courier.trackingUrl ? (
          <Link href={courier.trackingUrl} target="_blank" rel="noopener noreferrer" variant="body2">
            {`Track ${courier.providerLabel}`}
          </Link>
        ) : (
          <Button size="small" onClick={() => setOpen(true)}>
            {courier.providerLabel}
          </Button>
        )
      ) : (
        <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
          {'Send a courier'}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{`Courier for ${order.number}`}</DialogTitle>
        <DialogContent>
          {open ? (
            <CourierPanel orderId={order.id} api={api} connection={answer.connection} testMode={order.testMode} />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default QueueCourierButton
