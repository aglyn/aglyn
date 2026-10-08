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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { QUEUE_POLL_MS } from '../constants'
import {
  DELIVERY_SERVICES,
  formatMoney,
  type DeliveryOrderAction,
  type DeliveryOrderStatus,
  type DeliveryOrderView,
  type DeliveryQueueAnswer,
} from '../model/delivery-apps'
import { useDeliveryAppsApi, type DeliveryAppsApi } from './delivery-apps-api'

/** What the register's `posOrders` zone hands a widget. */
export interface DeliveryQueueProps {
  hostId: string
  orgId?: string
  registerId?: string | null
  /** Test seam: the API; the routes by default. */
  api?: DeliveryAppsApi
  /** Test seam: how often the queue is asked again. */
  pollMs?: number
}

const STATUS: Readonly<Record<DeliveryOrderStatus, { label: string; tone: StatusTone }>> = {
  new: { label: 'New', tone: 'warning' },
  accepted: { label: 'Making', tone: 'info' },
  ready: { label: 'Ready', tone: 'success' },
  picked_up: { label: 'Picked up', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  cancelled: { label: 'Canceled', tone: 'error' },
}

/** Why a cashier turns an order down, in the words the service is sent. */
const REJECT_REASONS = [
  'An item is out of stock',
  'The kitchen is too busy',
  'The store is closing',
  'The store cannot make this order',
] as const

const time = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null)

/**
 * The register's delivery orders (AGL-3644), above the till: each open
 * DoorDash, Uber Eats or Grubhub order with what to make and the one next
 * step — accept or reject, ready, picked up — and the latest finished ones
 * folded beneath. Asks again every few seconds. Draws nothing until the site
 * has a store connected, or for anyone the register's gate turns away.
 */
export function DeliveryQueue(props: DeliveryQueueProps) {
  const routesApi = useDeliveryAppsApi(props.hostId)
  const api = props.api ?? routesApi
  const pollMs = props.pollMs ?? QUEUE_POLL_MS
  const { enqueueSnackbar } = useSnackbar()
  const [queue, setQueue] = useState<DeliveryQueueAnswer | null>(null)
  const [showRecent, setShowRecent] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<DeliveryOrderView | null>(null)
  const seen = useRef<Set<string> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const answer = await api.queue()
      // A new order since the last look is announced once, the first look aside.
      const fresh = answer.open.filter((order) => order.status === 'new' && seen.current && !seen.current.has(order.id))
      seen.current = new Set(answer.open.map((order) => order.id))
      if (fresh.length) {
        enqueueSnackbar(
          fresh.length === 1
            ? `New ${DELIVERY_SERVICES[fresh[0].service].label} order ${fresh[0].externalRef}`
            : `${fresh.length} new delivery orders`,
          { variant: 'info', persist: false },
        )
      }
      setQueue(answer)
    } catch {
      // Turned away, or no service here: the register shows nothing.
      setQueue((current) => current ?? { connected: false, open: [], recent: [] })
    }
  }, [api, enqueueSnackbar])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(timer)
  }, [refresh, pollMs])

  const act = async (order: DeliveryOrderView, action: DeliveryOrderAction, reason?: string) => {
    setBusy(order.id)
    try {
      const answer = await api.act(order.id, action, reason)
      if (answer.message) enqueueSnackbar(answer.message, { variant: 'info', persist: false })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  if (!queue?.connected) return null
  const waiting = queue.open.filter((order) => order.status === 'new').length

  return (
    <Box sx={{ mb: 2 }}>
      <CardDisplay
        variant="outlined"
        header={
          <Badge badgeContent={waiting} color="warning">
            <Box component="span" sx={{ pr: waiting ? 1.5 : 0 }}>
              Delivery orders
            </Box>
          </Badge>
        }
        subheader={queue.open.length ? null : 'No delivery orders open.'}
        help={pluginDocsHelp('deliveryApps', {
          anchor: '#taking-orders',
          excerpt: 'Accept or reject each order, mark it ready, and mark it picked up when the courier collects it.',
        })}
        contentGutterX
        HeaderProps={{
          action: queue.recent.length ? (
            <Button size="small" onClick={() => setShowRecent((value) => !value)}>
              {showRecent ? 'Hide finished' : 'Finished'}
            </Button>
          ) : null,
        }}
      >
        <Stack divider={<Divider flexItem />} spacing={1.5} sx={{ pb: queue.open.length ? 2 : 0 }}>
          {queue.open.map((order) => (
            <QueueOrder
              key={order.id}
              order={order}
              busy={busy === order.id}
              onAct={(action) => (action === 'reject' ? setRejecting(order) : void act(order, action))}
            />
          ))}
        </Stack>
        <Collapse in={showRecent} unmountOnExit>
          <Stack divider={<Divider flexItem />} spacing={1} sx={{ pb: 2 }}>
            {queue.recent.map((order) => (
              <Stack key={order.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <StatusChip label={STATUS[order.status].label} tone={STATUS[order.status].tone} variant="outlined" />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {`${DELIVERY_SERVICES[order.service].label} ${order.externalRef}${order.customerName ? ` · ${order.customerName}` : ''}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {order.displayRef ?? formatMoney(order.totalCents, order.currency)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </CardDisplay>
      <RejectDialog
        order={rejecting}
        onClose={(reason) => {
          const order = rejecting
          setRejecting(null)
          if (order && reason) void act(order, 'reject', reason)
        }}
      />
    </Box>
  )
}
DeliveryQueue.displayName = 'DeliveryQueue'

function QueueOrder(props: { order: DeliveryOrderView; busy: boolean; onAct: (action: DeliveryOrderAction) => void }) {
  const { order, busy, onAct } = props
  const info = DELIVERY_SERVICES[order.service]
  const pickup = time(order.pickupAtMs)
  const status = STATUS[order.status]
  const next: Array<{ action: DeliveryOrderAction; label: string; primary?: boolean; color?: 'error' }> =
    order.status === 'new'
      ? [
          { action: 'accept', label: 'Accept', primary: true },
          { action: 'reject', label: 'Reject', color: 'error' },
        ]
      : order.status === 'accepted' && order.pending !== 'accept'
        ? info.readySignal
          ? [
              { action: 'ready', label: 'Ready for pickup', primary: true },
              { action: 'picked_up', label: 'Picked up' },
            ]
          : [{ action: 'picked_up', label: 'Picked up', primary: true }]
        : order.status === 'ready'
          ? [{ action: 'picked_up', label: 'Picked up', primary: true }]
          : []
  return (
    <Stack spacing={1} data-testid={`delivery-order-${order.id}`}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <StatusChip label={status.label} tone={status.tone} />
        {order.testMode ? <StatusChip label="Test" tone="info" variant="outlined" /> : null}
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          {`${info.label} ${order.externalRef}${order.customerName ? ` · ${order.customerName}` : ''}`}
        </Typography>
        <Typography variant="subtitle1">{formatMoney(order.totalCents, order.currency)}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {[
          `Placed ${time(order.placedAtMs)}`,
          pickup ? `${order.handoff === 'customer' ? 'Customer collects' : 'Courier'} at ${pickup}` : null,
          order.displayRef ? `Order ${order.displayRef}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {order.lines.map((line, index) => (
          <Typography component="li" variant="body2" key={index}>
            {`${line.quantity} × ${line.name}`}
            {line.options.length ? (
              <Typography component="span" variant="body2" color="text.secondary">{` — ${line.options.join(', ')}`}</Typography>
            ) : null}
            {line.instructions ? (
              <Typography component="span" variant="body2" color="text.secondary">{` · “${line.instructions}”`}</Typography>
            ) : null}
          </Typography>
        ))}
      </Box>
      {order.instructions ? <Alert severity="info">{order.instructions}</Alert> : null}
      {order.oversold > 0 ? (
        <Alert severity="warning">{`${order.oversold} sold beyond what was in stock.`}</Alert>
      ) : null}
      {order.refundedCents > 0 ? (
        <Typography variant="body2" color="text.secondary">
          {`${formatMoney(order.refundedCents, order.currency)} refunded by ${info.label}`}
        </Typography>
      ) : null}
      {order.error ? (
        <Alert
          severity={order.pending ? 'warning' : 'error'}
          action={
            order.pending ? (
              <Button color="inherit" size="small" disabled={busy} onClick={() => onAct('retry')}>
                Send again
              </Button>
            ) : undefined
          }
        >
          {order.error}
        </Alert>
      ) : null}
      {next.length ? (
        <Stack direction="row" spacing={1}>
          {next.map((step) => (
            <Button
              key={step.action}
              size="large"
              variant={step.primary ? 'contained' : 'outlined'}
              color={step.color ?? 'primary'}
              disabled={busy}
              onClick={() => onAct(step.action)}
            >
              {step.label}
            </Button>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

function RejectDialog(props: { order: DeliveryOrderView | null; onClose: (reason: string | null) => void }) {
  const { order, onClose } = props
  const [reason, setReason] = useState<string>(REJECT_REASONS[0])
  useEffect(() => {
    if (order) setReason(REJECT_REASONS[0])
  }, [order])
  return (
    <Dialog open={Boolean(order)} onClose={() => onClose(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{order ? `Reject ${DELIVERY_SERVICES[order.service].label} ${order.externalRef}?` : 'Reject order?'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          {'The service tells the customer and refunds them. Nothing is taken off your shelf.'}
        </Typography>
        <TextField select fullWidth label="Reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          {REJECT_REASONS.map((entry) => (
            <MenuItem key={entry} value={entry}>
              {entry}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(null)}>Keep it</Button>
        <Button color="error" variant="contained" onClick={() => onClose(reason)}>
          Reject
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default DeliveryQueue
