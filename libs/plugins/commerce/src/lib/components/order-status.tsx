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

import * as Aglyn from '@aglyn/aglyn'
import { mdiTruckCheckOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { ORDER_STATUS_COMPONENT_ID } from '../constants/order-status'
import {
  formatOrderMoney,
  type OrderStatusView,
} from '../model'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = ORDER_STATUS_COMPONENT_ID

export interface OrderStatusProps {
  heading?: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'missing'; message: string }
  | { kind: 'ready'; view: OrderStatusView }

function dateLabel(atMs: number | null): string {
  if (!atMs) return ''
  return new Date(atMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * The guest order-status page (AGL-3610): what a buyer sees when they open
 * the "View your order" link in any order email. The commerce page resolver
 * serves it at `/order-status` inside the site's own header and footer; a
 * merchant can also place it on a page of their own design at that address.
 *
 * The order is read AFTER hydration from `?o=&t=` — the page itself is the
 * same for every buyer and may be cached, the order never is — through
 * `/api/commerce/order-status`, which verifies the signed link and returns an
 * allow-listed projection (no email, phone or address).
 */
const OrderStatus = forwardRef<HTMLDivElement, OrderStatusProps>((props, ref) => {
  const { heading, ...rest } = props
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { hostId } = Aglyn.useSite()
  const siteFetch = Aglyn.useSiteFetch()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (!hostId) return
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('o') ?? ''
    const token = params.get('t') ?? ''
    if (!orderId || !token) {
      setState({
        kind: 'missing',
        message: 'Open this page from the link in your order email.',
      })
      return
    }
    let live = true
    siteFetch(
      `/api/commerce/order-status?hostId=${encodeURIComponent(hostId)}` +
        `&o=${encodeURIComponent(orderId)}&t=${encodeURIComponent(token)}`,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!live) return
        if (!response.ok) {
          setState({
            kind: 'missing',
            message: String(payload?.error ?? 'We could not find that order.'),
          })
          return
        }
        setState({ kind: 'ready', view: payload as OrderStatusView })
      })
      .catch(() => {
        if (live) {
          setState({
            kind: 'missing',
            message: 'Your order could not be loaded. Check your connection and try again.',
          })
        }
      })
    return () => {
      live = false
    }
  }, [hostId, siteFetch])

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          { p: 3, border: '1px dashed', borderColor: 'divider', borderRadius: 1 },
          ...nodeSx,
        ]}
      >
        <Typography variant="body2" color="text.secondary">
          {'Order status — a buyer’s order, shipments and tracking render here'}
        </Typography>
      </Box>
    )
  }

  if (state.kind === 'loading') {
    return (
      <Box ref={ref} {...rest} sx={[{ py: 6, textAlign: 'center' }, ...nodeSx]}>
        <CircularProgress size={28} aria-label="Loading your order" />
      </Box>
    )
  }

  if (state.kind === 'missing') {
    return (
      <Box ref={ref} {...rest} sx={[{ maxWidth: 560 }, ...nodeSx]}>
        <Typography variant="h4" component="h1" gutterBottom>
          {heading || 'Your order'}
        </Typography>
        <Alert severity="info">{state.message}</Alert>
      </Box>
    )
  }

  const { view } = state
  const money = (cents: number) => formatOrderMoney(cents, view.currency)
  const activeStep = Math.max(
    0,
    view.steps.reduce((last, step, index) => (step.done ? index : last), 0),
  )
  const cancelled = view.status === 'cancelled'

  return (
    <Box ref={ref} {...rest} sx={[{ maxWidth: 720 }, ...nodeSx]}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          {view.storeName ? (
            <Typography variant="overline" color="text.secondary">
              {view.storeName}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4" component="h1">
              {heading || `Order ${view.number}`}
            </Typography>
            <Chip
              label={view.statusLabel}
              color={cancelled || view.status === 'refunded' ? 'default' : 'primary'}
              size="small"
            />
          </Stack>
          {view.createdAtMs ? (
            <Typography variant="body2" color="text.secondary">
              {`Placed ${dateLabel(view.createdAtMs)}`}
            </Typography>
          ) : null}
        </Stack>

        <Stepper activeStep={activeStep} alternativeLabel>
          {view.steps.map((step) => (
            <Step key={step.key} completed={step.done}>
              <StepLabel
                optional={
                  step.atMs ? (
                    <Typography variant="caption" color="text.secondary">
                      {dateLabel(step.atMs)}
                    </Typography>
                  ) : undefined
                }
              >
                {step.label}
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        {view.shipments.length ? (
          <Stack spacing={1.5}>
            <Typography variant="h6" component="h2">
              {view.shipments.length === 1 ? 'Shipment' : 'Shipments'}
            </Typography>
            {view.shipments.map((shipment, index) => (
              <Paper key={shipment.id || index} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <Typography variant="subtitle2">
                      {[
                        view.shipments.length > 1 ? `Package ${index + 1}` : 'Package',
                        dateLabel(shipment.atMs) ? `shipped ${dateLabel(shipment.atMs)}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                    {shipment.trackingUrl ? (
                      <Button
                        size="small"
                        variant="outlined"
                        href={shipment.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {'Track package'}
                      </Button>
                    ) : null}
                  </Stack>
                  {shipment.trackingNumber ? (
                    <Typography variant="body2" color="text.secondary">
                      {[shipment.carrier, shipment.trackingNumber].filter(Boolean).join(' ')}
                    </Typography>
                  ) : null}
                  <Typography variant="body2">
                    {shipment.lines.map((line) => `${line.quantity}× ${line.name}`).join(', ')}
                  </Typography>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : null}

        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            {'Items'}
          </Typography>
          {view.lines.map((line, index) => (
            <Stack key={index} direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
              <Box>
                <Typography
                  variant="body2"
                  sx={line.refunded ? { textDecoration: 'line-through' } : undefined}
                >
                  {`${line.quantity}× ${line.name}`}
                  {line.variantLabel ? ` (${line.variantLabel})` : ''}
                </Typography>
                {line.refunded ? (
                  <Typography variant="caption" color="text.secondary">
                    {'Refunded'}
                  </Typography>
                ) : !cancelled && line.shippedQuantity > 0 && line.shippedQuantity < line.quantity ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${line.shippedQuantity} of ${line.quantity} shipped`}
                  </Typography>
                ) : null}
              </Box>
              <Typography variant="body2">{money(line.amountCents)}</Typography>
            </Stack>
          ))}
          <Divider />
          {(
            [
              ['Subtotal', view.totals.itemsCents],
              ['Discount', -view.totals.discountCents],
              ['Shipping', view.totals.shippingCents],
              ['Tax', view.totals.taxCents],
            ] as Array<[string, number]>
          )
            .filter(([label, cents]) => label === 'Subtotal' || cents !== 0)
            .map(([label, cents]) => (
              <Stack key={label} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {money(cents)}
                </Typography>
              </Stack>
            ))}
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="subtitle1">{'Total'}</Typography>
            <Typography variant="subtitle1">{money(view.totals.totalCents)}</Typography>
          </Stack>
          {view.totals.refundedCents > 0 ? (
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">
                {'Refunded'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {money(-view.totals.refundedCents)}
              </Typography>
            </Stack>
          ) : null}
        </Stack>

        {view.actions.length ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {view.actions.map((action) => (
              <Button key={action.id} variant="outlined" href={action.url}>
                {action.label}
              </Button>
            ))}
          </Stack>
        ) : null}

        <Typography variant="body2" color="text.secondary">
          {'Questions about your order? Reply to your order email'}
          {view.storeName ? ` or contact ${view.storeName}` : ''}
          {'.'}
        </Typography>
        <Link href="/" variant="body2">
          {'Continue shopping'}
        </Link>
      </Stack>
    </Box>
  )
})
OrderStatus.displayName = 'OrderStatus'

export const schema: Aglyn.ComponentSchema<OrderStatusProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Order status',
  description:
    'A buyer’s order, shipments and tracking, opened from the link in their order emails.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiTruckCheckOutline.path, sx: { color: 'success.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the order. Defaults to the order number.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Order status',
    pluginId: BUNDLE_ID,
    description: 'The buyer’s order status, for the /order-status page',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiTruckCheckOutline.path, sx: { color: 'success.main' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default OrderStatus
