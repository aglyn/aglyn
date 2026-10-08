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
  MARKETPLACES,
  PRICE_ADJUST_MAX,
  PRICE_ADJUST_MIN,
  STOCK_BUFFER_MAX,
  UNTRACKED_QUANTITY_MAX,
  type ListingMode,
  type ListingProblemView,
  type MarketplaceConnectionStatus,
  type MarketplaceConnectionView,
  type MarketplaceId,
  type MarketplaceLogEntry,
} from '../model/marketplaces'
import {
  useMarketplacesApi,
  type MarketplaceOffer,
  type MarketplacesApi,
  type MarketplaceSettingsChange,
} from './marketplaces-api'

/** What the `commerceSettings` zone hands a widget. */
export interface MarketplacesCardProps {
  hostId: string
  orgId?: string
  /** Test seam: the API; the routes by default. */
  api?: MarketplacesApi
}

const STATUS: Readonly<Record<MarketplaceConnectionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Syncing', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  reconnect: { label: 'Connect again', tone: 'warning' },
}

const LOG_KIND: Readonly<Record<MarketplaceLogEntry['kind'], { label: string; tone: StatusTone }>> = {
  connected: { label: 'Connected', tone: 'info' },
  listings: { label: 'Listings', tone: 'info' },
  order_imported: { label: 'Order', tone: 'success' },
  order_skipped: { label: 'Not imported', tone: 'neutral' },
  order_canceled: { label: 'Canceled', tone: 'neutral' },
  shipment_confirmed: { label: 'Tracking sent', tone: 'success' },
  error: { label: 'Error', tone: 'error' },
}

const LISTING_MODES: Readonly<Record<ListingMode, { label: string; help: string }>> = {
  off: { label: 'Leave listings alone', help: 'Orders still come in; listing stock is yours to keep up there.' },
  link: { label: 'Keep matching listings in step', help: 'Listings whose seller SKU matches a product follow its stock.' },
  publish: { label: 'Keep in step and publish the rest', help: 'Products with no listing there are published too.' },
}

/** What the redirect back from a marketplace says, as a sentence. */
const RETURN_OUTCOME: Readonly<Record<string, { message: string; variant: 'success' | 'error' | 'warning' }>> = {
  connected: { message: 'Connected. Orders come in and listings sync from now on.', variant: 'success' },
  declined: { message: 'The connection was not allowed.', variant: 'warning' },
  expired: { message: 'That took too long. Connect again.', variant: 'warning' },
  failed: { message: 'The connection could not be made. Try again in a minute.', variant: 'error' },
  unavailable: { message: 'That marketplace cannot be connected here.', variant: 'error' },
}

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

type HelpAnchor = '#connect-a-marketplace' | '#listings' | '#orders' | '#activity'
const help = (excerpt: string, anchor: HelpAnchor) => pluginDocsHelp('marketplaces', { anchor, excerpt })

/**
 * MARKETPLACES (AGL-3638): a store's connections to Amazon, eBay, Etsy,
 * TikTok Shop, Walmart and Faire — one card per marketplace the deployment
 * offers, its state and actions in its header, its settings in its body, and
 * its activity and listings to look at under it. Draws nothing where the
 * deployment offers no marketplace, or the member cannot read the store's
 * settings.
 */
export function MarketplacesCard(props: MarketplacesCardProps) {
  const routesApi = useMarketplacesApi(props.hostId)
  const api = props.api ?? routesApi
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<{ loading: boolean; offered: MarketplaceOffer[]; connections: MarketplaceConnectionView[] }>({
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

  // The marketplace's redirect back lands here with its outcome in the address.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const outcome = url.searchParams.get('marketplaceConnect')
    if (!outcome) return
    const said = RETURN_OUTCOME[outcome]
    if (said) enqueueSnackbar(said.message, { variant: said.variant, persist: false })
    url.searchParams.delete('marketplaceConnect')
    url.searchParams.delete('marketplace')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [enqueueSnackbar])

  const replace = useCallback((marketplace: MarketplaceId, connection: MarketplaceConnectionView | null) => {
    setState((current) => ({
      ...current,
      connections: connection
        ? [...current.connections.filter((entry) => entry.marketplace !== marketplace), connection]
        : current.connections.filter((entry) => entry.marketplace !== marketplace),
    }))
  }, [])

  if (state.loading) return null
  // A connection whose marketplace is no longer offered is still shown, so it can be disconnected.
  const shown = [...new Set([...state.offered.map((offer) => offer.id), ...state.connections.map((entry) => entry.marketplace)])]
  if (!shown.length) return null

  return (
    <Stack spacing={2}>
      {shown.map((marketplace) => (
        <MarketplaceCard
          key={marketplace}
          api={api}
          marketplace={marketplace}
          offer={state.offered.find((offer) => offer.id === marketplace) ?? null}
          connection={state.connections.find((entry) => entry.marketplace === marketplace) ?? null}
          onChange={(connection) => replace(marketplace, connection)}
        />
      ))}
    </Stack>
  )
}
MarketplacesCard.displayName = 'MarketplacesCard'

function MarketplaceCard(props: {
  api: MarketplacesApi
  marketplace: MarketplaceId
  offer: MarketplaceOffer | null
  connection: MarketplaceConnectionView | null
  onChange: (connection: MarketplaceConnectionView | null) => void
}) {
  const { api, marketplace, offer, connection, onChange } = props
  const info = MARKETPLACES[marketplace]
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activityKey, setActivityKey] = useState(0)

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
      setActivityKey((key) => key + 1)
    }
  }

  const connect = () =>
    run(async () => {
      const url = await api.connect(marketplace, `${window.location.pathname}${window.location.search}`)
      window.location.assign(url)
      return null
    })

  const update = (settings: MarketplaceSettingsChange, done: string | null = 'Saved.') =>
    run(async () => {
      onChange(await api.update(marketplace, settings))
      return done
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${info.label}?`,
      description:
        `Orders stop coming in from ${info.label}, listings stop following your stock, and the stored access is deleted. ` +
        `Orders already imported stay in your store. Your listings stay on ${info.label} with the stock they last showed, ` +
        'so end or update them there.',
      confirmationText: 'Disconnect',
      confirmationButtonProps: { color: 'error' },
    }).then(
      () => true,
      () => false,
    )
    if (!accepted) return
    await run(async () => {
      await api.disconnect(marketplace)
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
              const next = await api.syncNow(marketplace)
              if (next) onChange(next)
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
      ) : offer ? (
        <Button size="small" variant="contained" disabled={busy} onClick={() => void connect()}>
          Connect again
        </Button>
      ) : null}
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  ) : offer ? (
    <Button size="small" variant="contained" disabled={busy} onClick={() => void connect()}>
      {`Connect ${info.label}`}
    </Button>
  ) : null

  return (
    <>
      <CardDisplay
        variant="outlined"
        header={info.label}
        subheader={`Listings follow your stock, and ${info.label} orders come in as your orders.`}
        help={help(`Connect your own ${info.accountNoun} and sell from one stock count.`, '#connect-a-marketplace')}
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
          {connection ? (
            <ConnectionDetails connection={connection} busy={busy} onUpdate={update} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {`Not connected. Sign in to your own ${info.accountNoun} to connect it; ${PLATFORM_BRAND_NAME} never sees your password.${
                offer?.sandbox ? ` This deployment connects to the ${info.label} sandbox, where nothing real sells.` : ''
              }`}
            </Typography>
          )}
        </Stack>
      </CardDisplay>
      {connection ? <MarketplaceActivityCard key={activityKey} api={api} marketplace={marketplace} /> : null}
    </>
  )
}

/** A whole-number field saved when it loses focus with a changed, valid value. */
function NumberSetting(props: {
  label: string
  value: number
  min: number
  max: number
  helperText: string
  disabled: boolean
  onSave: (value: number) => void
}) {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])
  const number = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(number) && number >= props.min && number <= props.max
  return (
    <TextField
      size="small"
      type="number"
      label={props.label}
      value={text}
      disabled={props.disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (valid && number !== props.value) props.onSave(number)
      }}
      error={!valid}
      helperText={valid ? props.helperText : `A whole number from ${props.min} to ${props.max}.`}
      slotProps={{ htmlInput: { min: props.min, max: props.max, step: 1 } }}
      sx={{ minWidth: 180, maxWidth: 240 }}
    />
  )
}

function ConnectionDetails(props: {
  connection: MarketplaceConnectionView
  busy: boolean
  onUpdate: (settings: MarketplaceSettingsChange, done?: string | null) => void
}) {
  const { connection, busy, onUpdate } = props
  const info = MARKETPLACES[connection.marketplace]
  const { settings, listings } = connection
  const locked = busy || connection.status === 'reconnect'
  const modes = (Object.keys(LISTING_MODES) as ListingMode[]).filter((mode) => mode !== 'publish' || info.canPublish)
  return (
    <Stack spacing={1.5}>
      {connection.lastError ? (
        <Alert severity={connection.status === 'reconnect' ? 'error' : 'warning'}>{connection.lastError}</Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {[
          connection.accountName ? `Account: ${connection.accountName}` : null,
          `${connection.orders.imported} orders imported`,
          `${connection.shipments.confirmed} shipments confirmed`,
          connection.shipments.failed ? `${connection.shipments.failed} not confirmed` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      {connection.sites.length > 1 || (connection.marketplace === 'amazon' && connection.sites.length) ? (
        <TextField
          select
          size="small"
          label="Marketplace"
          value={settings.marketplaceId ?? ''}
          disabled={locked}
          onChange={(event) => onUpdate({ marketplaceId: event.target.value }, 'Saved. Listings sync to it now.')}
          helperText={settings.marketplaceId ? 'Listings and orders are for this marketplace.' : 'Choose where you sell.'}
          error={!settings.marketplaceId}
          sx={{ maxWidth: 320 }}
        >
          {connection.sites.map((site) => (
            <MenuItem key={site.id} value={site.id}>
              {site.currency ? `${site.name} (${site.currency})` : site.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <FormControlLabel
        control={
          <Switch
            checked={settings.importOrders}
            disabled={locked}
            onChange={(event) => onUpdate({ importOrders: event.target.checked })}
          />
        }
        label={`Bring ${info.label} orders into the store`}
      />
      <FormControlLabel
        control={
          <Switch
            checked={settings.confirmShipments}
            disabled={locked}
            onChange={(event) => onUpdate({ confirmShipments: event.target.checked })}
          />
        }
        label={`Send tracking to ${info.label} when you ship one`}
      />
      <TextField
        select
        size="small"
        label="Listings"
        value={settings.listingMode}
        disabled={locked}
        onChange={(event) => onUpdate({ listingMode: event.target.value as ListingMode })}
        helperText={LISTING_MODES[settings.listingMode].help}
        sx={{ maxWidth: 360 }}
      >
        {modes.map((mode) => (
          <MenuItem key={mode} value={mode}>
            {LISTING_MODES[mode].label}
          </MenuItem>
        ))}
      </TextField>
      {settings.listingMode !== 'off' ? (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
            <NumberSetting
              label="Units kept back"
              value={settings.stockBuffer}
              min={0}
              max={STOCK_BUFFER_MAX}
              helperText={`Held back from ${info.label} on every product.`}
              disabled={locked}
              onSave={(value) => onUpdate({ stockBuffer: value })}
            />
            <NumberSetting
              label="Untracked products show"
              value={settings.untrackedQuantity}
              min={0}
              max={UNTRACKED_QUANTITY_MAX}
              helperText="For products that do not count stock."
              disabled={locked}
              onSave={(value) => onUpdate({ untrackedQuantity: value })}
            />
          </Stack>
          {info.canSyncPrices ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.syncPrices}
                    disabled={locked}
                    onChange={(event) => onUpdate({ syncPrices: event.target.checked })}
                  />
                }
                label="Send prices too"
              />
              {settings.syncPrices ? (
                <NumberSetting
                  label="Price adjustment (%)"
                  value={settings.priceAdjustPercent}
                  min={PRICE_ADJUST_MIN}
                  max={PRICE_ADJUST_MAX}
                  helperText={`Added to your price on ${info.label}, for its fees.`}
                  disabled={locked}
                  onSave={(value) => onUpdate({ priceAdjustPercent: value })}
                />
              ) : null}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {`${info.label} prices are wholesale and set on ${info.label}; only stock is sent.`}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {listings.syncedAtMs
              ? [
                  `${listings.offers} products checked ${formatTime(listings.syncedAtMs)}`,
                  `${listings.updated} updated`,
                  listings.created ? `${listings.created} published` : null,
                  `${listings.unchanged} already right`,
                  listings.notListed ? `${listings.notListed} with no listing` : null,
                  listings.failed ? `${listings.failed} refused` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Listings have not synced yet.'}
          </Typography>
        </>
      ) : null}
    </Stack>
  )
}

/**
 * A connection's activity, newest first, and the listings to look at: the
 * shared paged lists and their footers. The store keeps a connection's latest
 * rows only, so one read is the whole list and it pages in memory.
 */
function MarketplaceActivityCard(props: { api: MarketplacesApi; marketplace: MarketplaceId }) {
  const { api, marketplace } = props
  const info = MARKETPLACES[marketplace]
  const [rows, setRows] = useState<MarketplaceLogEntry[] | null>(null)
  const [problems, setProblems] = useState<ListingProblemView[]>([])
  const [error, setError] = useState<string | null>(null)
  const pagination = useClientPagination(rows ?? [])
  const problemPages = useClientPagination(problems)

  useEffect(() => {
    let live = true
    api.activity(marketplace).then(
      (answer) => {
        if (!live) return
        setRows(answer.entries ?? [])
        setProblems(answer.problems ?? [])
      },
      (cause) => live && setError((cause as Error).message),
    )
    return () => {
      live = false
    }
  }, [api, marketplace])

  return (
    <>
      {problems.length ? (
        <CardDisplay
          variant="outlined"
          header={`${info.label} listings to look at`}
          help={help('Listings the marketplace refused, and products with no listing under their SKU.', '#listings')}
          contentGutterX
          contentGutterY
        >
          <List dense disablePadding>
            {problemPages.pageItems.map((problem) => (
              <ListItem key={problem.offerId} divider disableGutters sx={{ alignItems: 'flex-start' }}>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <StatusChip
                        label={problem.outcome === 'failed' ? 'Refused' : 'No listing'}
                        tone={problem.outcome === 'failed' ? 'error' : 'neutral'}
                        variant="outlined"
                      />
                      <span>{problem.title}</span>
                    </Stack>
                  }
                  secondary={
                    problem.outcome === 'failed'
                      ? `SKU ${problem.sku}: ${problem.message ?? 'refused'}`
                      : `SKU ${problem.sku}: no ${info.label} listing has this SKU.`
                  }
                />
              </ListItem>
            ))}
          </List>
          <ListPagination {...problemPages.paginationProps} />
        </CardDisplay>
      ) : null}
      <CardDisplay
        variant="outlined"
        header={`${info.label} activity`}
        help={help('Orders imported, tracking sent, listing syncs and errors, newest first.', '#activity')}
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
    </>
  )
}

export default MarketplacesCard
