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
  INVENTORY_PROVIDERS,
  type InventoryConnectionSettings,
  type InventoryConnectionStatus,
  type InventoryConnectionView,
  type InventoryLocation,
  type InventoryLogEntry,
  type InventoryOrderView,
  type InventoryProviderId,
} from '../model/inventory-sync'
import { useInventorySyncApi, type InventoryConnectionAnswer, type InventorySyncApi } from './inventory-sync-api'

/** What the `commerceSettings` zone hands a widget. */
export interface InventorySyncCardProps {
  hostId: string
  orgId?: string
  /** Test seam: the API; the routes by default. */
  api?: InventorySyncApi
}

const STATUS: Readonly<Record<InventoryConnectionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Syncing', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  reconnect: { label: 'Connect again', tone: 'warning' },
}

const LOG_KIND: Readonly<Record<InventoryLogEntry['kind'], { label: string; tone: StatusTone }>> = {
  connected: { label: 'Connected', tone: 'info' },
  order: { label: 'Order', tone: 'success' },
  stock: { label: 'Stock', tone: 'info' },
  products: { label: 'Products', tone: 'info' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  error: { label: 'Error', tone: 'error' },
}

/** What Brightpearl's redirect back says, as a sentence. */
const RETURN_OUTCOME: Readonly<Record<string, { message: string; variant: 'success' | 'error' | 'warning' }>> = {
  connected: { message: 'Brightpearl is connected. Choose what to sync.', variant: 'success' },
  declined: { message: 'The connection was not allowed.', variant: 'warning' },
  expired: { message: 'That took too long. Connect again.', variant: 'warning' },
  failed: { message: 'Brightpearl could not be connected. Try again in a minute.', variant: 'error' },
  unavailable: { message: 'Brightpearl cannot be connected here.', variant: 'error' },
}

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

type HelpAnchor = '#connect-a-system' | '#stock-counts' | '#products' | '#orders' | '#activity'
const help = (excerpt: string, anchor: HelpAnchor) => pluginDocsHelp('inventorySync', { anchor, excerpt })

/**
 * INVENTORY AND ERP (AGL-3642): a store's connection to Cin7 Core, inFlow or
 * Brightpearl — one card per system the deployment offers until one is
 * connected, then that system's card alone, its state and actions in its
 * header, its settings in its body, then the orders that need the merchant
 * and the activity. Draws nothing where the deployment offers no system, or
 * the member cannot read the store's settings.
 */
export function InventorySyncCard(props: InventorySyncCardProps) {
  const routesApi = useInventorySyncApi(props.hostId)
  const api = props.api ?? routesApi
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<{ loading: boolean; answer: InventoryConnectionAnswer | null }>({
    loading: true,
    answer: null,
  })

  const refresh = useCallback(async () => {
    try {
      setState({ loading: false, answer: await api.connection() })
    } catch {
      setState({ loading: false, answer: null })
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Brightpearl's redirect back lands here with its outcome in the address.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const outcome = url.searchParams.get('inventorySync')
    if (!outcome) return
    const said = RETURN_OUTCOME[outcome]
    if (said) enqueueSnackbar(said.message, { variant: said.variant, persist: false })
    url.searchParams.delete('inventorySync')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [enqueueSnackbar])

  const answer = state.answer
  if (state.loading || !answer) return null
  const connection = answer.connection
  if (!connection && !answer.offered.length) return null
  const setConnection = (next: InventoryConnectionView | null) =>
    setState((current) => ({ ...current, answer: current.answer ? { ...current.answer, connection: next } : null }))

  if (connection) {
    return (
      <ConnectedCard
        api={api}
        connection={connection}
        offered={answer.offered.some((offer) => offer.id === connection.provider)}
        canImport={answer.capabilities?.importProducts === true}
        onChange={setConnection}
        onReplace={(next) => setState({ loading: false, answer: next })}
      />
    )
  }
  return (
    <Stack spacing={2}>
      {answer.offered.map((offer) => (
        <ConnectCard key={offer.id} api={api} provider={offer.id} onConnected={(next) => setState({ loading: false, answer: next })} />
      ))}
    </Stack>
  )
}
InventorySyncCard.displayName = 'InventorySyncCard'

/** Hook for one card's busy flag, error and snackbar. */
function useRun() {
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    }
  }
  return { busy, error, setError, run }
}

/** A system not yet connected: its keys, or Brightpearl's account code, and Connect. */
function ConnectCard(props: {
  api: InventorySyncApi
  provider: InventoryProviderId
  onConnected: (answer: InventoryConnectionAnswer) => void
}) {
  const { api, provider, onConnected } = props
  const info = INVENTORY_PROVIDERS[provider]
  const { busy, error, setError, run } = useRun()
  const [fields, setFields] = useState<Record<string, string>>({})
  const ready =
    info.auth === 'oauth'
      ? Boolean(fields['accountCode']?.trim())
      : info.keyFields.every((field) => fields[field.name]?.trim())

  const connect = () =>
    run(async () => {
      if (info.auth === 'oauth') {
        const url = await api.connectOAuth(fields['accountCode'].trim(), `${window.location.pathname}${window.location.search}`)
        window.location.assign(url)
        return null
      }
      onConnected(await api.connectKeys(provider, Object.fromEntries(info.keyFields.map((field) => [field.name, fields[field.name].trim()]))))
      return `${info.label} is connected. Choose what to sync.`
    })

  return (
    <CardDisplay
      variant="outlined"
      header={info.label}
      subheader={info.summary}
      help={help(`Connect your own ${info.label} account to keep stock, products and orders in step.`, '#connect-a-system')}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button size="small" variant="contained" disabled={busy || !ready} onClick={() => void connect()}>
            {`Connect ${info.label}`}
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {info.auth === 'oauth'
            ? `Enter your Brightpearl account code, then sign in to Brightpearl to allow access. ${PLATFORM_BRAND_NAME} never sees your password.`
            : `Paste the keys from your own ${info.label} account. They are stored encrypted and never shown again.`}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {info.auth === 'oauth' ? (
            <TextField
              size="small"
              label="Account code"
              value={fields['accountCode'] ?? ''}
              disabled={busy}
              onChange={(event) => setFields({ accountCode: event.target.value })}
              helperText="The name in your Brightpearl address."
              sx={{ minWidth: 240 }}
            />
          ) : (
            info.keyFields.map((field) => (
              <TextField
                key={field.name}
                size="small"
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                label={field.label}
                value={fields[field.name] ?? ''}
                disabled={busy}
                onChange={(event) => setFields((current) => ({ ...current, [field.name]: event.target.value }))}
                helperText={field.helper}
                sx={{ minWidth: 240 }}
              />
            ))
          )}
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

function ConnectedCard(props: {
  api: InventorySyncApi
  connection: InventoryConnectionView
  offered: boolean
  canImport: boolean
  onChange: (connection: InventoryConnectionView | null) => void
  onReplace: (answer: InventoryConnectionAnswer) => void
}) {
  const { api, connection, offered, canImport, onChange } = props
  const info = INVENTORY_PROVIDERS[connection.provider]
  const { confirm } = useConfirmationContext()
  const { busy, error, setError, run } = useRun()
  const [refreshKey, setRefreshKey] = useState(0)

  const update = (settings: InventoryConnectionSettings, done: string | null = 'Saved.') =>
    run(async () => {
      onChange(await api.update(settings))
      setRefreshKey((key) => key + 1)
      return done
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${info.label}?`,
      description:
        `Nothing more is synced, orders not yet sent stay unsent, and the stored keys and activity are deleted. ` +
        `What ${info.label} already has stays there, and so do the store's products and counts.`,
      confirmationText: 'Disconnect',
      confirmationButtonProps: { color: 'error' },
    }).then(
      () => true,
      () => false,
    )
    if (!accepted) return
    await run(async () => {
      await api.disconnect()
      props.onReplace(await api.connection())
      return `${info.label} is disconnected.`
    })
  }

  const actions = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      <StatusChip label={STATUS[connection.status].label} tone={STATUS[connection.status].tone} />
      {connection.status === 'active' ? (
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = await api.syncNow()
              if (next) onChange(next)
              setRefreshKey((key) => key + 1)
              return next && !next.lastError ? 'Synced.' : null
            })
          }
        >
          Sync now
        </Button>
      ) : null}
      {connection.status !== 'reconnect' ? (
        <Button size="small" disabled={busy} onClick={() => update({ paused: connection.status === 'active' }, null)}>
          {connection.status === 'active' ? 'Pause' : 'Resume'}
        </Button>
      ) : null}
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  )

  return (
    <Stack spacing={2}>
      {connection.status === 'reconnect' && offered ? (
        <ConnectCard api={props.api} provider={connection.provider} onConnected={props.onReplace} />
      ) : null}
      <CardDisplay
        variant="outlined"
        header={info.label}
        subheader={connection.accountName ? `Account: ${connection.accountName}` : info.summary}
        help={help(`Keep stock, products and orders in step with ${info.label}.`, '#connect-a-system')}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: actions }}
      >
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          {connection.lastError ? (
            <Alert severity={connection.status === 'reconnect' ? 'error' : 'warning'}>{connection.lastError}</Alert>
          ) : null}
          <SyncSettings api={api} connection={connection} canImport={canImport} busy={busy} onUpdate={update} />
        </Stack>
      </CardDisplay>
      <AttentionOrders key={`attention-${refreshKey}`} api={api} provider={connection.provider} />
      <InventoryActivity key={`log-${refreshKey}`} api={api} provider={connection.provider} />
    </Stack>
  )
}

function SyncSettings(props: {
  api: InventorySyncApi
  connection: InventoryConnectionView
  canImport: boolean
  busy: boolean
  onUpdate: (settings: InventoryConnectionSettings, done?: string | null) => void
}) {
  const { api, connection, canImport, busy, onUpdate } = props
  const info = INVENTORY_PROVIDERS[connection.provider]
  const locked = busy || connection.status === 'reconnect'
  const [locations, setLocations] = useState<InventoryLocation[] | null>(null)
  const [customer, setCustomer] = useState(connection.orderCustomer)
  const [taxRule, setTaxRule] = useState(connection.taxRule)

  useEffect(() => {
    if (connection.status === 'reconnect') return
    let live = true
    api.locations().then(
      (list) => live && setLocations(list),
      () => live && setLocations([]),
    )
    return () => {
      live = false
    }
  }, [api, connection.status])

  const stock = connection.stock
  const products = connection.products
  const locationName = (id: string | null) =>
    id ? (locations?.find((location) => location.id === id)?.name ?? id) : `All ${info.locationLabel.toLowerCase()}s`

  return (
    <Stack spacing={2}>
      <Stack spacing={1}>
        <Typography variant="subtitle2">Stock counts</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            select
            size="small"
            label="Which counts are right"
            value={connection.stockSource}
            disabled={locked}
            onChange={(event) => onUpdate({ stockSource: event.target.value as InventoryConnectionSettings['stockSource'] })}
            helperText={
              connection.stockSource === 'system'
                ? `The store's counts follow ${info.label}'s.`
                : connection.stockSource === 'store'
                  ? `${info.label}'s counts follow the store's.`
                  : 'Counts are left alone on both sides.'
            }
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="system">{info.label}</MenuItem>
            <MenuItem value="store">The store</MenuItem>
            <MenuItem value="off">Don’t sync counts</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label={info.locationLabel}
            value={connection.locationId ?? ''}
            disabled={locked || locations === null}
            onChange={(event) => onUpdate({ locationId: event.target.value || null })}
            helperText={`Where stock is counted and orders ship from.`}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">{`All ${info.locationLabel.toLowerCase()}s`}</MenuItem>
            {(locations ?? []).map((location) => (
              <MenuItem key={location.id} value={location.id}>
                {location.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {stock.syncedAtMs
            ? [
                `${stock.skus} SKUs at ${locationName(connection.locationId)}, synced ${formatTime(stock.syncedAtMs)}`,
                stock.direction === 'system'
                  ? `${stock.updated} store counts changed, ${stock.unknown} not in the store${stock.untracked ? `, ${stock.untracked} not tracked` : ''}${stock.perLocation ? `, ${stock.perLocation} counted per location and left alone` : ''}`
                  : stock.direction === 'store'
                    ? `${stock.updated} counts adjusted in ${info.label}, ${stock.unknown} store SKUs not in ${info.label}`
                    : null,
                stock.failed ? `${stock.failed} failed` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Not synced yet.'}
        </Typography>
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle2">Products</Typography>
        <TextField
          select
          size="small"
          label="Products"
          value={connection.productSync}
          disabled={locked}
          onChange={(event) => onUpdate({ productSync: event.target.value as InventoryConnectionSettings['productSync'] })}
          helperText={
            connection.productSync === 'import'
              ? `${info.label}'s products are added to the store as drafts and kept in step.`
              : connection.productSync === 'export'
                ? `Store products with a SKU ${info.label} lacks are made there.`
                : 'Products are matched by SKU; nothing is made on either side.'
          }
          sx={{ maxWidth: 360 }}
        >
          {canImport || connection.productSync === 'import' ? (
            <MenuItem value="import">{`Import from ${info.label}`}</MenuItem>
          ) : null}
          {info.exportsProducts ? <MenuItem value="export">{`Make store products in ${info.label}`}</MenuItem> : null}
          <MenuItem value="off">Match by SKU only</MenuItem>
        </TextField>
        {products.syncedAtMs && connection.productSync !== 'off' ? (
          <Typography variant="body2" color="text.secondary">
            {[
              `Synced ${formatTime(products.syncedAtMs)}`,
              `${products.created} made`,
              connection.productSync === 'import' ? `${products.updated} updated` : null,
              products.failed ? `${products.failed} failed` : null,
              products.more ? 'more on the next run' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        ) : null}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle2">Orders</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={connection.sendOrders}
              disabled={locked}
              onChange={(event) =>
                onUpdate(
                  { sendOrders: event.target.checked },
                  event.target.checked ? `Saved. Paid orders go to ${info.label} from now on.` : 'Saved.',
                )
              }
            />
          }
          label={`Send paid orders to ${info.label}`}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            size="small"
            label={info.customerLabel}
            value={customer}
            disabled={locked}
            onChange={(event) => setCustomer(event.target.value)}
            helperText={info.customerHelper}
            error={connection.sendOrders && !connection.orderCustomer}
            sx={{ minWidth: 260 }}
          />
          {customer.trim() !== connection.orderCustomer ? (
            <Button size="small" disabled={locked} onClick={() => onUpdate({ orderCustomer: customer.trim() })}>
              Save
            </Button>
          ) : null}
          {connection.provider === 'cin7-core' ? (
            <>
              <TextField
                size="small"
                label="Tax rule"
                value={taxRule}
                disabled={locked}
                onChange={(event) => setTaxRule(event.target.value)}
                helperText="Optional. As named in Cin7 Core; empty uses the customer's."
                sx={{ minWidth: 220 }}
              />
              {taxRule.trim() !== connection.taxRule ? (
                <Button size="small" disabled={locked} onClick={() => onUpdate({ taxRule: taxRule.trim() })}>
                  Save
                </Button>
              ) : null}
            </>
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {`${connection.totals.ordersSent} orders sent${connection.totals.ordersFailed ? ` · ${connection.totals.ordersFailed} not sent` : ''}`}
        </Typography>
      </Stack>
    </Stack>
  )
}

/** Orders that could not be sent, each with its reason and Send again. */
function AttentionOrders(props: { api: InventorySyncApi; provider: InventoryProviderId }) {
  const { api, provider } = props
  const { enqueueSnackbar } = useSnackbar()
  const [rows, setRows] = useState<InventoryOrderView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.failedOrders().then(
      (answer) => live && setRows(answer.orders ?? []),
      () => live && setRows([]),
    )
    return () => {
      live = false
    }
  }, [api])

  if (!rows?.length) return null
  const label = INVENTORY_PROVIDERS[provider].label

  const send = async (row: InventoryOrderView) => {
    setBusy(row.recordId)
    setError(null)
    try {
      const answer = await api.send(row.recordId)
      if (answer.order?.status === 'sent') {
        setRows((current) => (current ?? []).filter((entry) => entry.recordId !== row.recordId))
        enqueueSnackbar(`${row.displayRef} sent to ${label}.`, { variant: 'success', persist: false })
      } else if (answer.order) {
        setRows((current) => (current ?? []).map((entry) => (entry.recordId === row.recordId ? answer.order! : entry)))
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <CardDisplay
      variant="outlined"
      header="Orders not sent"
      help={help(`Paid orders ${label} has not taken, each with its reason.`, '#orders')}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        <List dense disablePadding>
          {rows.map((row) => (
            <ListItem
              key={row.recordId}
              divider
              disableGutters
              sx={{ alignItems: 'flex-start' }}
              secondaryAction={
                <Button size="small" disabled={busy !== null} onClick={() => void send(row)}>
                  Send again
                </Button>
              }
            >
              <ListItemText primary={row.displayRef} secondary={row.note ?? 'Not sent.'} sx={{ pr: 12 }} />
            </ListItem>
          ))}
        </List>
      </Stack>
    </CardDisplay>
  )
}

/**
 * A connection's activity, newest first: the shared paged list and its
 * footer. The store keeps a connection's latest rows only, so one read is the
 * whole list and it pages in memory.
 */
function InventoryActivity(props: { api: InventorySyncApi; provider: InventoryProviderId }) {
  const { api, provider } = props
  const [rows, setRows] = useState<InventoryLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pagination = useClientPagination(rows ?? [])

  useEffect(() => {
    let live = true
    api.log().then(
      (answer) => live && setRows(answer.entries ?? []),
      (cause) => live && setError((cause as Error).message),
    )
    return () => {
      live = false
    }
  }, [api])

  return (
    <CardDisplay
      variant="outlined"
      header={`${INVENTORY_PROVIDERS[provider].label} activity`}
      help={help('Orders sent, stock and product syncs, cancellations and errors, newest first.', '#activity')}
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

export default InventorySyncCard
