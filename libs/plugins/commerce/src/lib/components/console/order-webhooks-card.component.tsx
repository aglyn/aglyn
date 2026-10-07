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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useFirestoreCollection, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import * as Webhooks from '../../model/order-webhooks'

export interface OrderWebhooksCardProps {
  hostId: string
}

interface WebhookEventOption {
  event: string
  label: string
  description: string
}

interface WebhooksStatus {
  configured: boolean
  maxEndpoints: number
  events: WebhookEventOption[]
}

type EndpointRow = Webhooks.OrderWebhookEndpoint & { $id: string }
type DeliveryRow = Webhooks.OrderWebhookDelivery & { $id: string }

const ROUTE = '/api/commerce/order-webhooks'

/** POSTs one action to the webhooks route; answers the body or throws its error. */
export async function callOrderWebhooks(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
  body: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await authorizedFetch(user, ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostId, ...body }),
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>
  if (!response.ok) throw Object.assign(new Error(String(payload.error ?? 'Request failed')), { status: response.status })
  return payload
}

/**
 * Order webhooks (AGL-3611): the store's endpoints for order and return
 * events, each with its signing secret, a test event and a delivery log. Shown
 * only to the people who may manage them — the route answers who — and only
 * where the deployment can sign.
 */
export function OrderWebhooksCard(props: OrderWebhooksCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [status, setStatus] = useState<WebhooksStatus | null>(null)
  const [editing, setEditing] = useState<EndpointRow | 'new' | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [logFor, setLogFor] = useState<EndpointRow | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    callOrderWebhooks(user, hostId, { action: 'status' })
      .then((payload) => {
        if (active) setStatus(payload as WebhooksStatus)
      })
      .catch(() => {
        // Not an admin of the whole workspace, or the route is down: the
        // card is not this person's to use.
        if (active) setStatus(null)
      })
    return () => {
      active = false
    }
  }, [user, hostId])

  const { data: endpointDocs } = useFirestoreCollection<EndpointRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'orderWebhooks'),
        orderBy('createdAtMs', 'desc'),
        limit(Webhooks.ORDER_WEBHOOK_MAX_ENDPOINTS),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const endpoints = endpointDocs ?? []

  const run = useCallback(
    async (body: Record<string, unknown>, success?: string) => {
      setBusy(true)
      try {
        const payload = await callOrderWebhooks(user, hostId, body)
        if (success) enqueueSnackbar(success, { variant: 'success' })
        return payload
      } catch (error) {
        enqueueSnackbar(String((error as Error).message), { variant: 'error' })
        return null
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const handleTest = useCallback(
    async (endpoint: EndpointRow) => {
      const payload = await run({ action: 'test', endpointId: endpoint.$id })
      if (!payload) return
      enqueueSnackbar(
        payload.delivered ? 'Test event delivered' : `Test event not delivered: ${payload.attempt?.error ?? 'no answer'}`,
        { variant: payload.delivered ? 'success' : 'warning' },
      )
    },
    [run, enqueueSnackbar],
  )

  const handleRoll = useCallback(
    async (endpoint: EndpointRow) => {
      const confirmed = await confirm({
        title: 'Roll the signing secret?',
        description:
          'A new secret signs every event from now on. Update your endpoint before ' +
          'the next order, or it will reject what it is sent.',
        confirmationText: 'Roll secret',
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const payload = await run({ action: 'roll-secret', endpointId: endpoint.$id })
      if (payload?.secret) setSecret(String(payload.secret))
    },
    [confirm, run],
  )

  const handleDelete = useCallback(
    async (endpoint: EndpointRow) => {
      const confirmed = await confirm({
        title: 'Delete this endpoint?',
        description: `${endpoint.url} stops receiving order events. Its delivery log is kept for 30 days.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await run({ action: 'delete', endpointId: endpoint.$id }, 'Endpoint deleted')
    },
    [confirm, run],
  )

  if (!status?.configured) return null
  const labelFor = (event: string) => status.events.find((entry) => entry.event === event)?.label ?? event
  const atMax = endpoints.length >= status.maxEndpoints

  return (
    <CardDisplay
      header={'Order webhooks'}
      help={pluginDocsHelp('ordersAndReturns', { anchor: '#order-webhooks' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button size="small" disabled={atMax || busy} onClick={() => setEditing('new')}>
            {'Add endpoint'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        {endpoints.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Send order and return events to your own systems — a warehouse, an ERP or a ' +
              'script. Each event is signed so your endpoint can check it came from this store.'}
          </Typography>
        ) : (
          endpoints.map((endpoint) => (
            <Stack key={endpoint.$id} spacing={1} data-testid="order-webhook-endpoint">
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                  {endpoint.description ? `${endpoint.description} · ${endpoint.url}` : endpoint.url}
                </Typography>
                <Chip
                  size="small"
                  label={endpoint.enabled ? 'On' : 'Paused'}
                  color={endpoint.enabled ? 'success' : 'default'}
                  variant="outlined"
                />
                {endpoint.lastDeliveryStatus ? (
                  <Chip
                    size="small"
                    label={`Last: ${Webhooks.ORDER_WEBHOOK_DELIVERY_STATUS_LABELS[endpoint.lastDeliveryStatus]}`}
                    color={Webhooks.ORDER_WEBHOOK_DELIVERY_STATUS_COLOR[endpoint.lastDeliveryStatus]}
                    variant="outlined"
                  />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {`${endpoint.events.map(labelFor).join(', ')} · secret ends ${endpoint.secretHint}`}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button size="small" disabled={busy || !endpoint.enabled} onClick={() => handleTest(endpoint)}>
                  {'Send test event'}
                </Button>
                <Button size="small" onClick={() => setLogFor(endpoint)}>
                  {'Deliveries'}
                </Button>
                <Button size="small" disabled={busy} onClick={() => setEditing(endpoint)}>
                  {'Edit'}
                </Button>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => run({ action: 'update', endpointId: endpoint.$id, enabled: !endpoint.enabled })}
                >
                  {endpoint.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button size="small" disabled={busy} onClick={() => handleRoll(endpoint)}>
                  {'Roll secret'}
                </Button>
                <Button size="small" color="error" disabled={busy} onClick={() => handleDelete(endpoint)}>
                  {'Delete'}
                </Button>
              </Stack>
            </Stack>
          ))
        )}
        <Typography variant="caption" color="text.secondary">
          {`${endpoints.length}/${status.maxEndpoints} endpoints. A failed delivery is retried for about a day.`}
        </Typography>
      </Stack>
      {editing ? (
        <EndpointDialog
          endpoint={editing === 'new' ? null : editing}
          events={status.events}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const payload =
              editing === 'new'
                ? await run({ action: 'create', ...values })
                : await run({ action: 'update', endpointId: editing.$id, ...values }, 'Endpoint saved')
            if (!payload) return
            setEditing(null)
            if (payload.secret) setSecret(String(payload.secret))
          }}
        />
      ) : null}
      {secret ? <SecretDialog secret={secret} onClose={() => setSecret(null)} /> : null}
      {logFor ? (
        <DeliveriesDialog
          hostId={hostId}
          endpoint={logFor}
          labelFor={labelFor}
          busy={busy}
          onResend={async (delivery) => {
            const payload = await run({ action: 'resend', deliveryId: delivery.$id })
            if (payload) {
              enqueueSnackbar(payload.delivered ? 'Delivered' : `Not delivered: ${payload.attempt?.error ?? 'no answer'}`, {
                variant: payload.delivered ? 'success' : 'warning',
              })
            }
          }}
          onClose={() => setLogFor(null)}
        />
      ) : null}
    </CardDisplay>
  )
}
OrderWebhooksCard.displayName = 'OrderWebhooksCard'

interface EndpointDialogProps {
  endpoint: EndpointRow | null
  events: WebhookEventOption[]
  busy: boolean
  onClose: () => void
  onSave: (values: { url: string; description: string; events: string[] }) => void | Promise<void>
}

function EndpointDialog(props: EndpointDialogProps) {
  const { endpoint, events, busy, onClose, onSave } = props
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const [description, setDescription] = useState(endpoint?.description ?? '')
  const [chosen, setChosen] = useState<string[]>(endpoint?.events ?? events.map((entry) => entry.event))
  const toggle = (event: string) =>
    setChosen((current) => (current.includes(event) ? current.filter((entry) => entry !== event) : [...current, event]))
  const valid = /^https:\/\//i.test(url.trim()) && chosen.length > 0
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{endpoint ? 'Edit endpoint' : 'Add endpoint'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Endpoint URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/aglyn-webhooks"
            helperText="An https address on a public server. Redirects are not followed."
            fullWidth
            autoFocus
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Warehouse"
            fullWidth
          />
          <FormGroup>
            <Typography variant="subtitle2">{'Events'}</Typography>
            {events.map((entry) => (
              <FormControlLabel
                key={entry.event}
                control={<Checkbox checked={chosen.includes(entry.event)} onChange={() => toggle(entry.event)} />}
                label={
                  <Stack>
                    <Typography variant="body2">{`${entry.label} (${entry.event})`}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entry.description}
                    </Typography>
                  </Stack>
                }
              />
            ))}
          </FormGroup>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button
          variant="contained"
          disabled={!valid || busy}
          onClick={() => onSave({ url: url.trim(), description: description.trim(), events: chosen })}
        >
          {endpoint ? 'Save' : 'Add endpoint'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function SecretDialog(props: { secret: string; onClose: () => void }) {
  const { secret, onClose } = props
  const { enqueueSnackbar } = useSnackbar()
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{'Signing secret'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">{'Copy it now. It is not shown again; roll a new one if it is lost.'}</Alert>
          <TextField value={secret} fullWidth slotProps={{ input: { readOnly: true } }} label="Secret" />
          <Typography variant="body2" color="text.secondary">
            {`Each request carries an ${Webhooks.ORDER_WEBHOOK_SIGNATURE_HEADER} header, t=<timestamp>,v1=<signature>. ` +
              'The signature is the HMAC-SHA256, in hex, of the timestamp, a period and the raw body, ' +
              `keyed with this secret. ${Webhooks.ORDER_WEBHOOK_EVENT_ID_HEADER} is the same on every retry.`}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(secret)
              .then(() => enqueueSnackbar('Secret copied', { variant: 'success' }))
          }}
        >
          {'Copy'}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {'Done'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface DeliveriesDialogProps {
  hostId: string
  endpoint: EndpointRow
  labelFor: (event: string) => string
  busy: boolean
  onResend: (delivery: DeliveryRow) => void | Promise<void>
  onClose: () => void
}

/** The endpoint's delivery log, newest first, filtered by a Firestore query. */
export function DeliveriesDialog(props: DeliveriesDialogProps) {
  const { hostId, endpoint, labelFor, busy, onResend, onClose } = props
  const firestore = useFirestore()
  const [statusFilter, setStatusFilter] = useState<Webhooks.OrderWebhookDeliveryStatus | ''>('')
  const [openBody, setOpenBody] = useState<string | null>(null)
  const { data: deliveryDocs } = useFirestoreCollection<DeliveryRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'orderWebhookDeliveries'),
        where('endpointId', '==', endpoint.$id),
        ...(statusFilter ? [where('status', '==', statusFilter)] : []),
        orderBy('createdAtMs', 'desc'),
        limit(25),
      ),
    [firestore, hostId, endpoint.$id, statusFilter],
    { idField: '$id' },
  )
  const deliveries = deliveryDocs ?? []
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{`Deliveries · ${endpoint.url}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as Webhooks.OrderWebhookDeliveryStatus | '')}
            sx={{ maxWidth: 200 }}
          >
            <MenuItem value="">{'All'}</MenuItem>
            {(Object.keys(Webhooks.ORDER_WEBHOOK_DELIVERY_STATUS_LABELS) as Webhooks.OrderWebhookDeliveryStatus[]).map((key) => (
              <MenuItem key={key} value={key}>
                {Webhooks.ORDER_WEBHOOK_DELIVERY_STATUS_LABELS[key]}
              </MenuItem>
            ))}
          </TextField>
          {deliveries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No deliveries in the last 30 days.'}
            </Typography>
          ) : (
            deliveries.map((delivery) => {
              const last = delivery.attempts?.[delivery.attempts.length - 1]
              return (
                <Stack key={delivery.$id} spacing={0.5} data-testid="order-webhook-delivery">
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {`${delivery.test ? 'Test event' : labelFor(delivery.event)} · ${new Date(delivery.createdAtMs).toLocaleString()}`}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={Webhooks.ORDER_WEBHOOK_DELIVERY_STATUS_LABELS[delivery.status]}
                      color={Webhooks.ORDER_WEBHOOK_DELIVERY_STATUS_COLOR[delivery.status]}
                    />
                    <Button size="small" onClick={() => setOpenBody(openBody === delivery.$id ? null : delivery.$id)}>
                      {openBody === delivery.$id ? 'Hide body' : 'Body'}
                    </Button>
                    <Button size="small" disabled={busy} onClick={() => onResend(delivery)}>
                      {'Resend'}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {`${delivery.attempts?.length ?? 0} attempt${delivery.attempts?.length === 1 ? '' : 's'}` +
                      (last ? ` · last ${last.httpStatus ?? 'no answer'}${last.error ? ` — ${last.error}` : ''}` : '')}
                  </Typography>
                  {openBody === delivery.$id ? (
                    <TextField
                      value={delivery.body}
                      multiline
                      maxRows={12}
                      fullWidth
                      slotProps={{ input: { readOnly: true } }}
                    />
                  ) : null}
                </Stack>
              )
            })
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default OrderWebhooksCard
