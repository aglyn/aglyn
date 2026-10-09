'use client'

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
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { CopyField } from '@aglyn/shared-ui-jsx/components/copy-field.component'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useClientPagination } from '@aglyn/shared-ui-jsx/hooks/use-client-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  CircularProgress,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  AMAZON_SHIPPING_SPEEDS,
  NETWORK_PROVIDERS,
  type NetworkConnectionSettings,
  type NetworkConnectionStatus,
  type NetworkConnectionView,
  type NetworkLogEntry,
  type NetworkProviderId,
} from '../model/networks'
import {
  useFulfillmentNetworksApi,
  type FulfillmentNetworksApi,
  type NetworkOffer,
  type NetworkWebhookSetup,
} from './fulfillment-networks-api'

/** What the `commerceSettings` zone hands a widget. */
export interface FulfillmentNetworksCardProps {
  hostId: string
  orgId?: string
  /** Test seam: the API; the routes by default. */
  api?: FulfillmentNetworksApi
}

const STATUS: Readonly<Record<NetworkConnectionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Sending orders', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  reconnect: { label: 'Connect again', tone: 'warning' },
}

const LOG_KIND: Readonly<Record<NetworkLogEntry['kind'], { label: string; tone: StatusTone }>> = {
  connected: { label: 'Connected', tone: 'info' },
  sent: { label: 'Sent', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  stock: { label: 'Stock', tone: 'info' },
  error: { label: 'Error', tone: 'error' },
}

/** What the redirect back from a network says, as a sentence. */
const RETURN_OUTCOME: Readonly<Record<string, { message: string; variant: 'success' | 'error' | 'warning' }>> = {
  connected: { message: 'Connected. Paid orders go to it from now on.', variant: 'success' },
  declined: { message: 'The connection was not allowed.', variant: 'warning' },
  expired: { message: 'That took too long. Connect again.', variant: 'warning' },
  failed: { message: 'The connection could not be made. Try again in a minute.', variant: 'error' },
  unavailable: { message: 'That network cannot be connected here.', variant: 'error' },
}

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

type HelpAnchor = '#connect-a-network' | '#settings' | '#stock-counts' | '#activity'
const help = (excerpt: string, anchor: HelpAnchor) => pluginDocsHelp('fulfillmentNetworks', { anchor, excerpt })

/**
 * FULFILLMENT NETWORKS (AGL-3634): a store's connections to ShipBob,
 * ShipMonk (AGL-3697) and Amazon Multi-Channel Fulfillment — one card per network the deployment
 * offers, its state and actions in its header, its settings in its body, and
 * its activity under it. Draws nothing where the deployment offers no
 * network, or the member cannot read the store's settings.
 */
export function FulfillmentNetworksCard(props: FulfillmentNetworksCardProps) {
  const routesApi = useFulfillmentNetworksApi(props.hostId)
  const api = props.api ?? routesApi
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<{ loading: boolean; offered: NetworkOffer[]; connections: NetworkConnectionView[] }>({
    loading: true,
    offered: [],
    connections: [],
  })

  const refresh = useCallback(async () => {
    try {
      const answer = await api.list()
      setState({ loading: false, offered: answer.offered ?? [], connections: answer.connections ?? [] })
    } catch {
      setState({ loading: false, offered: [], connections: [] })
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The network's redirect back lands here with its outcome in the address.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const outcome = url.searchParams.get('fulfillmentNetwork')
    if (!outcome) return
    const said = RETURN_OUTCOME[outcome]
    if (said) enqueueSnackbar(said.message, { variant: said.variant, persist: false })
    url.searchParams.delete('fulfillmentNetwork')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [enqueueSnackbar])

  const replace = useCallback((provider: NetworkProviderId, connection: NetworkConnectionView | null) => {
    setState((current) => ({
      ...current,
      connections: connection
        ? [...current.connections.filter((entry) => entry.provider !== provider), connection]
        : current.connections.filter((entry) => entry.provider !== provider),
    }))
  }, [])

  if (state.loading) return null
  // A connection whose network is no longer offered (its app was removed) is
  // still shown, so it can be disconnected.
  const shown = [
    ...new Set([...state.offered.map((offer) => offer.id), ...state.connections.map((entry) => entry.provider)]),
  ]
  if (!shown.length) return null

  return (
    <Stack spacing={2}>
      {shown.map((provider) => (
        <NetworkCard
          key={provider}
          api={api}
          provider={provider}
          offer={state.offered.find((offer) => offer.id === provider) ?? null}
          connection={state.connections.find((entry) => entry.provider === provider) ?? null}
          onChange={(connection) => replace(provider, connection)}
        />
      ))}
    </Stack>
  )
}
FulfillmentNetworksCard.displayName = 'FulfillmentNetworksCard'

function NetworkCard(props: {
  api: FulfillmentNetworksApi
  provider: NetworkProviderId
  offer: NetworkOffer | null
  connection: NetworkConnectionView | null
  onChange: (connection: NetworkConnectionView | null) => void
}) {
  const { api, provider, offer, connection, onChange } = props
  const info = NETWORK_PROVIDERS[provider]
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logKey, setLogKey] = useState(0)
  const apiKeyNetwork = info.auth === 'api-key'
  const [keyFormOpen, setKeyFormOpen] = useState(false)
  const [webhook, setWebhook] = useState<NetworkWebhookSetup | null>(null)

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    try {
      const done = await work()
      if (done) enqueueSnackbar(done, { variant: 'success', persist: false })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
      setLogKey((key) => key + 1)
    }
  }

  const connectKey = (input: { apiKey: string; storeId: string }) =>
    run(async () => {
      const answer = await api.connectKey(provider, input)
      onChange(answer.connection)
      setKeyFormOpen(false)
      if (answer.webhook) setWebhook(answer.webhook)
      return `Connected to ${info.label}. Paid orders go to it from now on.`
    })

  const rotateWebhookSecret = async () => {
    const accepted = await confirm({
      title: `New ${info.label} webhook secret?`,
      description: `The current secret stops working at once. Put the new one in ${info.label}'s webhook settings, or its updates are refused until you do; orders are still read back every 15 minutes.`,
      confirmationText: 'Make a new secret',
    }).then(
      () => true,
      () => false,
    )
    if (!accepted) return
    await run(async () => {
      setWebhook(await api.rotateWebhookSecret(provider))
      onChange(connection ? { ...connection, webhookSecretSet: true } : null)
      return null
    })
  }

  const connect = () =>
    run(async () => {
      const url = await api.connect(provider, `${window.location.pathname}${window.location.search}`)
      window.location.assign(url)
      return null
    })

  const update = (settings: NetworkConnectionSettings, done: string | null = null) =>
    run(async () => {
      onChange(await api.update(provider, settings))
      return done
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${info.label}?`,
      description:
        `Paid orders stop going to ${info.label}, and the stored access and activity are deleted. ` +
        `Orders ${info.label} already has stay with it: check them in your ${info.label} account, and ship anything it has not shipped another way.`,
      confirmationText: 'Disconnect',
      confirmationButtonProps: { color: 'error' },
    }).then(
      () => true,
      () => false,
    )
    if (!accepted) return
    await run(async () => {
      await api.disconnect(provider)
      onChange(null)
      return `${info.label} is disconnected.`
    })
  }

  const actions = connection ? (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      {connection.sandbox ? <StatusChip label="Sandbox" tone="info" variant="outlined" /> : null}
      <StatusChip label={STATUS[connection.status].label} tone={STATUS[connection.status].tone} />
      {connection.status === 'active' ? (
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = await api.syncNow(provider)
              if (next) onChange(next)
              return next && !next.lastError ? 'Synced.' : null
            })
          }
        >
          Sync now
        </Button>
      ) : null}
      {apiKeyNetwork && connection.status !== 'reconnect' ? (
        <Button size="small" disabled={busy} onClick={() => void rotateWebhookSecret()}>
          {connection.webhookSecretSet ? 'New webhook secret' : 'Set up webhooks'}
        </Button>
      ) : null}
      {connection.status !== 'reconnect' ? (
        <Button size="small" disabled={busy} onClick={() => update({ paused: connection.status === 'active' })}>
          {connection.status === 'active' ? 'Pause' : 'Resume'}
        </Button>
      ) : offer ? (
        <Button
          size="small"
          variant="contained"
          disabled={busy}
          onClick={() => (apiKeyNetwork ? setKeyFormOpen(true) : void connect())}
        >
          Connect again
        </Button>
      ) : null}
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  ) : offer ? (
    <Button
      size="small"
      variant="contained"
      disabled={busy || keyFormOpen}
      onClick={() => (apiKeyNetwork ? setKeyFormOpen(true) : void connect())}
    >
      {`Connect ${info.shortLabel}`}
    </Button>
  ) : null

  return (
    <>
      <CardDisplay
        variant="outlined"
        header={info.label}
        subheader={info.summary}
        help={help(`Send paid orders to ${info.label} and get its shipments back on the order.`, '#connect-a-network')}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: actions }}
      >
        <Stack spacing={1.5}>
          {error ? (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          {webhook ? <WebhookSetup provider={provider} webhook={webhook} onDone={() => setWebhook(null)} /> : null}
          {apiKeyNetwork && keyFormOpen ? (
            <ApiKeyForm
              provider={provider}
              busy={busy}
              storeId={connection?.storeId ?? ''}
              onSubmit={(input) => void connectKey(input)}
              onCancel={() => setKeyFormOpen(false)}
            />
          ) : null}
          {connection ? (
            <ConnectionDetails connection={connection} busy={busy} onUpdate={update} />
          ) : keyFormOpen ? null : (
            <Typography variant="body2" color="text.secondary">
              {`${
                apiKeyNetwork
                  ? `Not connected. Connect with the API key of your own ${info.label} API store; ${PLATFORM_BRAND_NAME} keeps it encrypted and never shows it again.`
                  : `Not connected. Sign in to your own ${info.label} account to connect it; ${PLATFORM_BRAND_NAME} never sees your password.`
              }${offer?.sandbox ? ` This deployment connects to the ${info.label} sandbox, which takes test orders only.` : ''}`}
            </Typography>
          )}
        </Stack>
      </CardDisplay>
      {connection ? <NetworkActivity key={logKey} api={api} provider={provider} /> : null}
    </>
  )
}

function ConnectionDetails(props: {
  connection: NetworkConnectionView
  busy: boolean
  onUpdate: (settings: NetworkConnectionSettings, done?: string | null) => void
}) {
  const { connection, busy, onUpdate } = props
  const info = NETWORK_PROVIDERS[connection.provider]
  const [method, setMethod] = useState(connection.shippingMethod)
  const inventory = connection.inventory
  const locked = busy || connection.status === 'reconnect'
  return (
    <Stack spacing={1.5}>
      {connection.lastError ? (
        <Alert severity={connection.status === 'reconnect' ? 'error' : 'warning'}>{connection.lastError}</Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {[
          connection.accountName ? `Account: ${connection.accountName}` : null,
          `${connection.totals.sent} orders sent`,
          `${connection.totals.shipped} parcels shipped`,
          connection.totals.canceled ? `${connection.totals.canceled} canceled` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          select
          size="small"
          label="Sending"
          value={connection.routing}
          disabled={locked}
          onChange={(event) =>
            onUpdate({ routing: event.target.value as NetworkConnectionSettings['routing'] }, 'Saved.')
          }
          helperText={
            connection.routing === 'automatic'
              ? 'Every paid order with a shipping address.'
              : 'Only orders you send from the order.'
          }
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="automatic">Automatic</MenuItem>
          <MenuItem value="manual">Manual</MenuItem>
        </TextField>
        {connection.provider === 'shipbob' || connection.provider === 'shipmonk' ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label={connection.provider === 'shipmonk' ? 'Shipping service' : 'Ship option'}
              value={method}
              disabled={locked}
              onChange={(event) => setMethod(event.target.value)}
              helperText={
                connection.provider === 'shipmonk'
                  ? 'Must match a shipping mapping in your ShipMonk account.'
                  : 'As named in your ShipBob account.'
              }
              sx={{ minWidth: 220 }}
            />
            {method.trim() && method !== connection.shippingMethod ? (
              <Button size="small" disabled={locked} onClick={() => onUpdate({ shippingMethod: method.trim() }, 'Saved.')}>
                Save
              </Button>
            ) : null}
          </Stack>
        ) : (
          <>
            <TextField
              select
              size="small"
              label="Marketplace"
              value={connection.marketplaceId ?? ''}
              disabled={locked || !connection.marketplaces.length}
              onChange={(event) => onUpdate({ marketplaceId: event.target.value }, 'Saved. Stock is counted again now.')}
              helperText={connection.marketplaceId ? 'Its FBA inventory ships your orders.' : 'Choose where your FBA inventory is.'}
              error={!connection.marketplaceId}
              sx={{ minWidth: 220 }}
            >
              {connection.marketplaces.map((marketplace) => (
                <MenuItem key={marketplace.id} value={marketplace.id}>
                  {marketplace.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Shipping speed"
              value={connection.shippingSpeed}
              disabled={locked}
              onChange={(event) =>
                onUpdate({ shippingSpeed: event.target.value as NetworkConnectionSettings['shippingSpeed'] }, 'Saved.')
              }
              helperText="Amazon bills you for the speed chosen."
              sx={{ minWidth: 180 }}
            >
              {AMAZON_SHIPPING_SPEEDS.map((speed) => (
                <MenuItem key={speed} value={speed}>
                  {speed}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
      </Stack>
      {connection.provider === 'shipmonk' ? (
        <Typography variant="body2" color="text.secondary">
          {connection.webhookSecretSet
            ? 'ShipMonk webhooks are verified with your signing secret; orders are also read back every 15 minutes.'
            : 'Orders are read back from ShipMonk every 15 minutes. Set up webhooks to hear about shipments sooner.'}
        </Typography>
      ) : null}
      <FormControlLabel
        control={
          <Switch
            checked={connection.syncInventory}
            disabled={locked}
            onChange={(event) =>
              onUpdate(
                { syncInventory: event.target.checked },
                event.target.checked ? `Saved. Your counts follow ${info.shortLabel}’s from the next sync.` : 'Saved.',
              )
            }
          />
        }
        label={`Keep stock counts in step with ${info.shortLabel}`}
      />
      <Typography variant="body2" color="text.secondary">
        {inventory.syncedAtMs
          ? [
              `${inventory.skus} SKUs at ${info.shortLabel}, counted ${formatTime(inventory.syncedAtMs)}`,
              connection.syncInventory
                ? `${inventory.updated} of your counts changed, ${inventory.unknown} not in your store${
                    inventory.untracked ? `, ${inventory.untracked} not tracked` : ''
                  }${inventory.perLocation ? `, ${inventory.perLocation} counted per location and left alone` : ''}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : `Stock at ${info.shortLabel} has not been counted yet.`}
      </Typography>
    </Stack>
  )
}

/**
 * The key form of a network that takes the merchant's own API key (ShipMonk,
 * AGL-3697): the key and the API store it belongs to. The key is sent once and
 * never shown again; the field is a password field so it is not left on screen.
 */
function ApiKeyForm(props: {
  provider: NetworkProviderId
  busy: boolean
  storeId: string
  onSubmit: (input: { apiKey: string; storeId: string }) => void
  onCancel: () => void
}) {
  const { provider, busy, onSubmit, onCancel } = props
  const info = NETWORK_PROVIDERS[provider]
  const [apiKey, setApiKey] = useState('')
  const [storeId, setStoreId] = useState(props.storeId)
  const ready = apiKey.trim().length >= 8 && /^[1-9][0-9]{0,11}$/.test(storeId.trim())
  return (
    <Stack
      component="form"
      spacing={1.5}
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit({ apiKey: apiKey.trim(), storeId: storeId.trim() })
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {`In ${info.label}, open Account Settings, then Integration API Keys. Create a key for your API store and copy it with the store's id.`}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          size="small"
          type="password"
          label="API key"
          autoComplete="off"
          value={apiKey}
          disabled={busy}
          onChange={(event) => setApiKey(event.target.value)}
          sx={{ minWidth: 260 }}
        />
        <TextField
          size="small"
          label="Store id"
          value={storeId}
          disabled={busy}
          onChange={(event) => setStoreId(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          sx={{ minWidth: 160 }}
        />
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button type="submit" size="small" variant="contained" disabled={busy || !ready}>
          Connect
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  )
}

/**
 * Where ShipMonk sends its webhooks and the secret it signs them with, shown
 * ONCE after a connect or a new secret: the merchant gives both to ShipMonk
 * (its webhook integration settings, or ShipMonk support).
 */
function WebhookSetup(props: { provider: NetworkProviderId; webhook: NetworkWebhookSetup; onDone: () => void }) {
  const info = NETWORK_PROVIDERS[props.provider]
  const { enqueueSnackbar } = useSnackbar()
  const copied = () => enqueueSnackbar('Copied.', { variant: 'success', persist: false })
  return (
    <Alert severity="info" onClose={props.onDone}>
      <Stack spacing={1.5}>
        <Typography variant="body2">
          {`To hear about shipments as soon as they leave, add a webhook in ${info.label} with this address and signing secret. The secret is shown only now.`}
        </Typography>
        {props.webhook.url ? <CopyField label="Webhook address" value={props.webhook.url} onCopied={copied} /> : null}
        <CopyField label="Signing secret" value={props.webhook.secret} onCopied={copied} />
      </Stack>
    </Alert>
  )
}

/**
 * A connection's activity, newest first: the shared paged list and its
 * footer. The store keeps a connection's latest rows only, so one read is the
 * whole list and it pages in memory.
 */
function NetworkActivity(props: { api: FulfillmentNetworksApi; provider: NetworkProviderId }) {
  const { api, provider } = props
  const [rows, setRows] = useState<NetworkLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pagination = useClientPagination(rows ?? [])

  useEffect(() => {
    let live = true
    api.log(provider).then(
      (answer) => live && setRows(answer.entries ?? []),
      (cause) => live && setError((cause as Error).message),
    )
    return () => {
      live = false
    }
  }, [api, provider])

  return (
    <CardDisplay
      variant="outlined"
      header={`${NETWORK_PROVIDERS[provider].label} activity`}
      help={help('Orders sent, parcels shipped, cancellations, stock syncs and errors, newest first.', '#activity')}
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : rows === null ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading activity…
          </Typography>
        </Stack>
      ) : rows.length ? (
        <>
          <List dense disablePadding>
            {pagination.pageItems.map((row) => (
              <ListItem key={row.id} divider disableGutters sx={{ alignItems: 'flex-start' }}>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <StatusChip label={LOG_KIND[row.kind]?.label ?? row.kind} tone={LOG_KIND[row.kind]?.tone ?? 'neutral'} variant="outlined" />
                      <span>{row.message}</span>
                    </Stack>
                  }
                  secondary={formatTime(row.atMs)}
                />
              </ListItem>
            ))}
          </List>
          <ListPagination {...pagination.paginationProps} />
        </>
      ) : (
        <EmptyStateComponent compact label="Nothing has happened yet." />
      )}
    </CardDisplay>
  )
}

export default FulfillmentNetworksCard
