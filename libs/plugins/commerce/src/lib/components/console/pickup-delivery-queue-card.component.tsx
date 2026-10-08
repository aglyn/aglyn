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
import {
  LOCAL_FULFILLMENT_QUEUE_TABS,
  localFulfillmentQueueQuery,
} from '../../constants/local-fulfillment-list-query'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  Button,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollection, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import OrderDetailDialog from './order-detail-dialog.component'
import { nextLocalFulfillmentSteps, useLocalFulfillmentStep } from './order-local-fulfillment-panel.component'

export interface PickupDeliveryQueueCardProps {
  hostId: string
}

/**
 * The pickup and local delivery queue (AGL-3624): what to prepare, what is
 * waiting at the counter, and what the store's driver takes out, per
 * location, soonest first — each tab ONE Firestore query on the fields every
 * pickup and delivery writer stamps (`constants/local-fulfillment-list-query`),
 * which the native Aglyn app runs too. A row's next step is one click; the
 * order opens for anything more.
 *
 * Draws nothing for a store with no pickup location and no local delivery
 * switched on, so a store that only ships never sees it.
 */
export function PickupDeliveryQueueCard(props: PickupDeliveryQueueCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const [tab, setTab] = useState<CommerceModel.OrderFulfillmentKey>('pickup_preparing')
  const [locationId, setLocationId] = useState('')
  const [open, setOpen] = useState<(CommerceModel.HostOrder & { $id: string }) | null>(null)
  const { run, busy } = useLocalFulfillmentStep(hostId)

  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: settings } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const pickupOn = (locationDocs ?? []).some(
    (location: any) => CommerceModel.normalizePickupSettings(location?.pickup).enabled,
  )
  const deliveryOn = Boolean(
    CommerceModel.normalizeLocalDeliverySettings(settings?.localDelivery).enabled,
  )
  const tabs = LOCAL_FULFILLMENT_QUEUE_TABS.filter((entry) =>
    entry.method === 'pickup' ? pickupOn : deliveryOn,
  )
  const active = tabs.some((entry) => entry.key === tab) ? tab : (tabs[0]?.key ?? tab)
  const plan = useMemo(() => localFulfillmentQueueQuery(active, locationId || null), [active, locationId])
  const anyOn = tabs.length > 0
  const { data: rows, status } = useFirestoreCollection<any>(
    () =>
      anyOn
        ? query(
            collection(firestore, 'hosts', hostId, 'orders'),
            ...plan.where.map((clause) => where(clause.field, clause.op, clause.value as never)),
            orderBy(plan.orderBy.field, plan.orderBy.direction),
            limit(plan.limit),
          )
        : null,
    [firestore, hostId, plan, anyOn],
    { idField: '$id' },
  )

  if (!tabs.length) return null
  const orders = (rows ?? []).map((row: any) => ({
    ...CommerceModel.liftLegacyOrder(row),
    $id: String(row.$id),
  })) as Array<CommerceModel.HostOrder & { $id: string }>
  const locations = [...(locationDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  return (
    <CardDisplay
      header={'Pickup & delivery'}
      help={pluginDocsHelp('commerce', { anchor: '#pickup-and-local-delivery' })}
      HeaderProps={{
        action:
          locations.length > 1 ? (
            <TextField
              select
              label="Location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              size="small"
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">{'All locations'}</MenuItem>
              {locations.map((location: any) => (
                <MenuItem key={location.$id} value={location.$id}>
                  {location.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null,
      }}
      contentGutterX
      contentGutterY
    >
      <Tabs
        value={active}
        onChange={(_event, value) => setTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {tabs.map((entry) => (
          <Tab key={entry.key} value={entry.key} label={entry.label} />
        ))}
      </Tabs>
      <Stack spacing={1} sx={{ pt: 1.5 }}>
        {status === 'loading' ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : orders.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing here right now.'}
          </Typography>
        ) : (
          orders.map((order) => {
            const units = (order.lineItems ?? []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
            const when =
              order.fulfillmentMethod === 'local_delivery'
                ? (order.localDelivery?.windowLabel ?? '')
                : order.createdAtMs
                  ? `Ordered ${new Date(order.createdAtMs).toLocaleString()}`
                  : ''
            const where =
              order.fulfillmentMethod === 'pickup'
                ? (order.pickup?.locationName ?? '')
                : [order.shippingAddress?.line1, order.localDelivery?.postalCode].filter(Boolean).join(', ')
            return (
              <Stack
                key={order.$id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {`${CommerceModel.formatOrderNumber(order, order.$id)} · ${
                      order.customerName || order.customerEmail || 'Guest buyer'
                    } · ${units} item${units === 1 ? '' : 's'}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {[when, where].filter(Boolean).join(' · ')}
                  </Typography>
                </Stack>
                {nextLocalFulfillmentSteps(order)
                  .filter((entry) => entry.primary)
                  .map((entry) => (
                    <Button
                      key={entry.step}
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void run(order.$id, entry.step)}
                    >
                      {entry.label}
                    </Button>
                  ))}
                <Button size="small" onClick={() => setOpen(order)}>
                  {'Open'}
                </Button>
              </Stack>
            )
          })
        )}
      </Stack>
      {open ? <OrderDetailDialog hostId={hostId} order={open} onClose={() => setOpen(null)} /> : null}
    </CardDisplay>
  )
}
PickupDeliveryQueueCard.displayName = 'PickupDeliveryQueueCard'

export default PickupDeliveryQueueCard
