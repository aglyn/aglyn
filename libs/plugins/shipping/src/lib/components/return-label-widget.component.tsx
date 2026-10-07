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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { BuyLabelDialog, openLabel, type OrderLabelsWidgetProps, type PublicLabel } from './order-labels-widget.component'
import { useShippingAvailability } from './shipping-api'

/**
 * The props the commerce plugin's `returnDetail` zone hands a widget,
 * restated here — a plugin never imports another — down to the fields this
 * widget reads.
 */
export interface ReturnLabelWidgetProps {
  hostId: string
  orgId?: string
  return: {
    id: string
    status: string
    orderId: string
    orderNumber: string
    lines: ReadonlyArray<{ lineItemId: number; name: string; quantity: number }>
    fromAddress: OrderLabelsWidgetProps['order']['shippingAddress']
    returnLabel: { carrier: string; trackingNumber: string } | null
  }
  attachReturnLabel: (label: {
    carrier: string
    trackingNumber: string
    labelUrl: string
    trackingUrl?: string
  }) => Promise<void>
}

/** The return statuses a label can still be bought for: approved, not yet received. */
const LABEL_STATUSES = new Set(['requested', 'approved'])

/**
 * A RETURN LABEL FROM THE RETURN DIALOG (AGL-3612): buys a label from the
 * buyer's address back to the ship-from place, for the units coming back,
 * through the same dialog and server path as a label bought on the order —
 * then hands it to the return through the dialog's own `attachReturnLabel`,
 * so the return keeps its own rules about what it accepts. Renders nothing
 * until the deployment names a provider.
 */
export function ReturnLabelWidget(props: ReturnLabelWidgetProps) {
  const { hostId, attachReturnLabel } = props
  const returned = props.return
  const availability = useShippingAvailability(hostId)
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [attachFailure, setAttachFailure] = useState<string | null>(null)

  // The return's lines, as the label dialog reads an order's: every unit
  // coming back counts as shipped, so a return label may carry all of them.
  const order = useMemo<OrderLabelsWidgetProps['order']>(
    () => ({
      id: returned.orderId,
      number: returned.orderNumber,
      status: returned.status,
      currency: '',
      shippingAddress: returned.fromAddress,
      lines: returned.lines.map((line) => ({
        lineItemId: line.lineItemId,
        name: line.name,
        quantity: line.quantity,
        fulfilledQuantity: line.quantity,
        remainingQuantity: 0,
        requiresShipping: true,
      })),
    }),
    [returned],
  )

  if (!availability.available) return null
  if (returned.returnLabel || !LABEL_STATUSES.has(returned.status) || !returned.fromAddress) return null

  const handleBought = async (label: PublicLabel) => {
    setOpen(false)
    openLabel(label.labelUrl)
    if (!label.labelUrl || !label.trackingNumber) {
      setAttachFailure('The label was bought but has no printable link or tracking number to attach yet.')
      return
    }
    try {
      await attachReturnLabel({
        carrier: label.carrier ?? '',
        trackingNumber: label.trackingNumber,
        labelUrl: label.labelUrl,
        ...(label.trackingUrl ? { trackingUrl: label.trackingUrl } : {}),
      })
      setAttachFailure(null)
      enqueueSnackbar('Return label bought and attached', { variant: 'success' })
    } catch (cause) {
      setAttachFailure((cause as Error).message)
    }
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {'Buy a prepaid label for the buyer to send these items back.'}
        </Typography>
        <Button variant="outlined" onClick={() => setOpen(true)}>
          {'Buy return label'}
        </Button>
      </Stack>
      {attachFailure ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {`The label was bought but not attached to the return: ${attachFailure}`}
        </Alert>
      ) : null}
      {open ? (
        <BuyLabelDialog
          hostId={hostId}
          order={order}
          kind="return"
          onClose={() => setOpen(false)}
          onBought={handleBought}
        />
      ) : null}
    </Box>
  )
}
ReturnLabelWidget.displayName = 'ReturnLabelWidget'

export default ReturnLabelWidget
