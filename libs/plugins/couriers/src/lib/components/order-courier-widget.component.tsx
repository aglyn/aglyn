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

import { Stack, Typography } from '@mui/material'
import { useCouriersApi, useCourierConnection, type CouriersApi } from './couriers-api'
import { CourierPanel } from './courier-panel.component'

/**
 * The props the commerce plugin's `orderDetail` and `localDeliveryRow` zones
 * hand a widget, restated here — a plugin never imports another — down to
 * the fields this plugin reads.
 */
export interface CourierZoneOrder {
  id: string
  number: string
  status: string
  testMode: boolean
  fulfillmentMethod?: string
  localDelivery?: {
    status: string
    courier: {
      providerLabel: string
      state: string
      trackingUrl: string | null
      etaMs: number | null
    } | null
  } | null
}

export interface OrderCourierWidgetProps {
  hostId: string
  orgId?: string
  order: CourierZoneOrder
  /** Test seam: the API; the routes by default. */
  api?: CouriersApi
}

/** Order statuses a courier can be sent for, or followed on. */
const OPEN_ORDER = new Set(['paid', 'partially_fulfilled', 'fulfilled', 'delivered'])

/**
 * The order dialog's Courier section (AGL-3695): on a local delivery, the
 * courier the store sent or can send. Draws nothing on any other order, on a
 * deployment without couriers, or for a site with no courier connected.
 */
export function OrderCourierWidget(props: OrderCourierWidgetProps) {
  const { hostId, order } = props
  const routes = useCouriersApi(hostId)
  const api = props.api ?? routes
  const isDelivery = order.fulfillmentMethod === 'local_delivery' && Boolean(order.localDelivery)
  const answer = useCourierConnection(hostId, isDelivery ? api : null)
  if (!isDelivery || !answer?.available || !answer.connection) return null
  if (!OPEN_ORDER.has(order.status) && !order.localDelivery?.courier) return null
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{'Courier'}</Typography>
      <CourierPanel orderId={order.id} api={api} connection={answer.connection} testMode={order.testMode} />
    </Stack>
  )
}

export default OrderCourierWidget
