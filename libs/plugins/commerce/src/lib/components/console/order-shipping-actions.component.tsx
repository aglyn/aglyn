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

import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button, ListItemText, Menu, MenuItem, Stack } from '@mui/material'
import { useState } from 'react'
import { ORDER_SHIPPING_PRESETS } from '../../transfer/shipping-presets'
import { COMMERCE_ORDERS_TRANSFER, COMMERCE_TRACKING_TRANSFER } from '../../transfer/transfer-keys'

/**
 * The orders still to ship, as the export dialog's filter: orders that ship
 * at all (`requiresShipping`, AGL-3613) that are paid or part-shipped —
 * one indexed query, `(requiresShipping, status, createdAtMs)`.
 */
export const ORDERS_TO_SHIP_FILTER = {
  label: 'orders still to ship',
  value: {
    filters: [
      { path: 'requiresShipping', op: '==', value: true },
      { path: 'status', op: 'in', value: ['paid', 'partially_fulfilled'] },
    ],
    orderBy: { path: 'createdAtMs', direction: 'desc' },
  },
} as const

export interface OrderShippingActionsProps {
  hostId: string
}

/**
 * The orders card's shipping actions, for its header (AGL-3613): Export for
 * shipping — the orders still to ship, laid out for Pirate Ship, Shippo,
 * EasyPost or any tool — and Import tracking, which records each parcel in a
 * label tool's file as a shipment. Each shows only when the transfer
 * launcher's `can` admits the person; off the console shell, nothing.
 */
export function OrderShippingActions(props: OrderShippingActionsProps) {
  const { hostId } = props
  const transfer = useTransferLauncher()
  const { data: user } = useUser()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!transfer) return null
  const canExport = transfer.can('export', { resource: COMMERCE_ORDERS_TRANSFER, scope: 'host', hostId })
  const canImport = transfer.can('import', { resource: COMMERCE_TRACKING_TRANSFER, scope: 'host', hostId })
  if (!canExport && !canImport) return null

  const exportFor = async (preset: string) => {
    setAnchor(null)
    // Orders written before AGL-3613 carry no `requiresShipping`; stamping
    // the open ones first is what lets the query find them. Best effort: the
    // export still opens, and shows what is already stamped.
    try {
      await authorizedFetch(user as never, '/api/commerce/orders-shipping-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId }),
      })
    } catch {
      // The export below is still right for every order written since.
    }
    transfer.openExport({
      resource: COMMERCE_ORDERS_TRANSFER,
      scope: 'host',
      hostId,
      title: 'Export orders for shipping',
      preset,
      filter: { label: ORDERS_TO_SHIP_FILTER.label, value: ORDERS_TO_SHIP_FILTER.value },
    })
  }

  return (
    <Stack direction="row" spacing={1}>
      {canImport ? (
        <Button
          size="small"
          onClick={() =>
            transfer.openImport({
              resource: COMMERCE_TRACKING_TRANSFER,
              scope: 'host',
              hostId,
              title: 'Import tracking numbers',
            })
          }
        >
          {'Import tracking'}
        </Button>
      ) : null}
      {canExport ? (
        <>
          <Button
            size="small"
            aria-haspopup="menu"
            aria-expanded={anchor ? 'true' : undefined}
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            {'Export for shipping'}
          </Button>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {ORDER_SHIPPING_PRESETS.map((preset) => (
              <MenuItem key={preset.id} onClick={() => void exportFor(preset.id)}>
                <ListItemText primary={preset.label} secondary={preset.description} />
              </MenuItem>
            ))}
          </Menu>
        </>
      ) : null}
    </Stack>
  )
}
OrderShippingActions.displayName = 'OrderShippingActions'

export default OrderShippingActions
