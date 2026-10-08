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
import { CardDisplay } from '@aglyn/shared-ui-jsx/components/card-display'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx/contexts/confirmation.context'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { RowActionsMenu } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Avatar,
  Button,
  CircularProgress,
  FormControlLabel,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import {
  POD_ORDER_STATUS_LABELS,
  type PodConnectionView,
  type PodOrderView,
  type PodProductLinkView,
} from '../model/print-on-demand'
import { CatalogImportDialog } from './catalog-import-dialog.component'
import { ConnectDialog } from './connect-dialog.component'
import { formatDate, formatMoney, POD_STATUS_TONE, usePodConnections, usePodFetch, type PodProviderOffer } from './pod-api'

/**
 * What commerce's `commerceSettings` zone hands a widget, restated here
 * because a plugin never imports another (AGL-3641): the site.
 */
export interface PrintOnDemandCardProps {
  hostId: string
  orgId?: string
}

const help = (excerpt: string, anchor: '#connect' | '#import-products' | '#orders' | '#shipments-and-tracking') =>
  pluginDocsHelp('printOnDemand', { anchor, excerpt })

const PAGE_SIZE = 10

function itemCount(part: PodOrderView): string {
  const count = part.lines.reduce((sum, line) => sum + line.quantity, 0)
  return `${count} item${count === 1 ? '' : 's'}`
}

/**
 * Print on demand in the store's settings (AGL-3641): the merchant's own
 * Printful and Printify connections, the products imported from them, and
 * the orders sent to them. Draws nothing where the deployment or the site
 * cannot hold a connection.
 */
export function PrintOnDemandCard(props: PrintOnDemandCardProps) {
  const { hostId } = props
  const state = usePodConnections(hostId)
  const { enqueueSnackbar } = useSnackbar()
  const [connectOpen, setConnectOpen] = useState(false)
  const [importing, setImporting] = useState<PodConnectionView | null>(null)
  const [listsKey, setListsKey] = useState(0)

  if (state.loading || !state.available) return null
  const offers: PodProviderOffer[] = state.providers.filter(
    (offer) => !state.connections.some((connection) => connection.provider === offer.id),
  )

  return (
    <Stack spacing={2}>
      <CardDisplay
        variant="outlined"
        header="Print on demand"
        subheader="Sell products Printful or Printify make and ship for you, from your own account."
        help={help(
          'Connect your own Printful or Printify account, import its products, and paid orders are sent to it to make and ship, with tracking written back to the order.',
          '#connect',
        )}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: offers.length ? (
            <Button size="small" variant="contained" onClick={() => setConnectOpen(true)}>
              {offers.length === 1 ? `Connect ${offers[0].label}` : 'Connect'}
            </Button>
          ) : null,
        }}
      >
        {state.connections.length ? (
          <Stack spacing={2}>
            {state.connections.map((connection) => (
              <ConnectionSection
                key={connection.provider}
                hostId={hostId}
                connection={connection}
                storeCurrency={state.storeCurrency}
                onChange={() => void state.refresh()}
                onImport={() => setImporting(connection)}
              />
            ))}
          </Stack>
        ) : (
          <EmptyStateComponent
            compact
            label="No print-on-demand service is connected"
            description="Connect your own Printful or Printify account with a token you make there. You pay the service directly for what it makes; nothing is added to its prices."
          />
        )}
      </CardDisplay>
      {state.connections.length ? (
        <>
          <ImportedProducts key={`products-${listsKey}`} hostId={hostId} storeCurrency={state.storeCurrency} />
          <SentOrders key={`orders-${listsKey}`} hostId={hostId} />
        </>
      ) : null}
      {connectOpen && offers.length ? (
        <ConnectDialog
          hostId={hostId}
          open
          offers={offers}
          onClose={() => setConnectOpen(false)}
          onConnected={(connection, notice) => {
            setConnectOpen(false)
            enqueueSnackbar(notice ?? `${connection.providerLabel} is connected. Import products to start selling them.`, {
              variant: notice ? 'warning' : 'success',
              persist: false,
            })
            void state.refresh()
          }}
        />
      ) : null}
      {importing ? (
        <CatalogImportDialog
          hostId={hostId}
          open
          connection={importing}
          onClose={() => setImporting(null)}
          onImported={() => setListsKey((key) => key + 1)}
        />
      ) : null}
    </Stack>
  )
}

function ConnectionSection(props: {
  hostId: string
  connection: PodConnectionView
  storeCurrency: string
  onChange: () => void
  onImport: () => void
}) {
  const { hostId, connection, storeCurrency, onChange, onImport } = props
  const request = usePodFetch()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = connection.providerLabel

  const save = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await request(POD_API_ROUTES.settings, { body: { hostId, provider: connection.provider, ...body } })
      onChange()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${label}?`,
      description:
        `New orders are no longer sent to ${label}, and orders already sent stop being followed here. ` +
        `Imported products stay in your store; fill their orders yourself or connect ${label} again.`,
      confirmationText: 'Disconnect',
      confirmationButtonProps: { color: 'error' },
    }).then(
      () => true,
      () => false,
    )
    if (!accepted) return
    setBusy(true)
    try {
      await request(POD_API_ROUTES.disconnect, { body: { hostId, provider: connection.provider } })
      enqueueSnackbar(`${label} is disconnected.`, { variant: 'success', persist: false })
      onChange()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      variant="outlined"
      header={`${label} — ${connection.storeName}`}
      subheader={`Prices in ${connection.currency}. Connected ${formatDate(connection.connectedAtMs)}.`}
      help={help(
        connection.webhooks === 'registered'
          ? `${label} tells the store about every shipment as it happens.`
          : `${label} is asked about each order every 15 minutes, so a shipment reaches the order within the hour.`,
        '#shipments-and-tracking',
      )}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <StatusChip
              label={connection.webhooks === 'registered' ? 'Live updates' : 'Checked every 15 min'}
              tone={connection.webhooks === 'registered' ? 'success' : 'info'}
              variant="outlined"
            />
            <Button size="small" variant="contained" disabled={busy} onClick={onImport}>
              Import products
            </Button>
            <RowActionsMenu
              label={`${label} connection`}
              items={[{ key: 'disconnect', label: 'Disconnect', destructive: true, onClick: () => void disconnect() }]}
            />
          </Stack>
        ),
      }}
    >
      <Stack spacing={1}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {connection.currency !== storeCurrency ? (
          <Alert severity="warning">
            {`${label} prices in ${connection.currency} and your store sells in ${storeCurrency}. Products cannot be imported until both use the same currency.`}
          </Alert>
        ) : null}
        {connection.webhookDetail ? <Alert severity="info">{connection.webhookDetail}</Alert> : null}
        <FormControlLabel
          control={
            <Switch
              checked={connection.submitMode === 'automatic'}
              disabled={busy}
              onChange={(event) => void save({ submitMode: event.target.checked ? 'automatic' : 'review' })}
            />
          }
          label={`Send paid orders to ${label} for production automatically`}
        />
        <Typography variant="body2" color="text.secondary" sx={{ pl: 6, mt: -1 }}>
          {connection.submitMode === 'automatic'
            ? `${label} starts making each order as soon as it is paid, and charges your ${label} account.`
            : `Each paid order waits at ${label} as a draft until you confirm it on the order.`}
        </Typography>
        <FormControlLabel
          control={
            <Switch checked={connection.syncPrices} disabled={busy} onChange={(event) => void save({ syncPrices: event.target.checked })} />
          }
          label={`Use ${label}’s retail prices when products update`}
        />
        <Typography variant="body2" color="text.secondary" sx={{ pl: 6, mt: -1 }}>
          {connection.syncPrices
            ? `Each daily update sets your store’s prices to the retail prices at ${label}.`
            : 'Your store keeps the prices you set; updates bring new variants, availability and costs only.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}

/** The products imported from the services, newest first, a page at a time. */
function ImportedProducts(props: { hostId: string; storeCurrency: string }) {
  const { hostId, storeCurrency } = props
  const request = usePodFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [afters, setAfters] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<PodProductLinkView[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (index: number, after: string | null) => {
      setRows(null)
      try {
        const answer = await request<{ links: PodProductLinkView[]; next: string | null }>(POD_API_ROUTES.imported, {
          query: { hostId, pageSize: String(PAGE_SIZE), ...(after ? { after } : {}) },
        })
        setRows(answer.links)
        setNext(answer.next)
        setAfters((current) => {
          const copy = current.slice(0, index + 1)
          copy[index + 1] = answer.next
          return copy
        })
      } catch (cause) {
        setRows([])
        setError((cause as Error).message)
      }
    },
    [hostId, request],
  )

  useEffect(() => {
    void load(0, null)
  }, [load])

  const act = async (link: PodProductLinkView, action: 'resync' | 'unlink') => {
    try {
      if (action === 'unlink') {
        await request(POD_API_ROUTES.unlink, { body: { hostId, linkId: link.id } })
        enqueueSnackbar(`${link.name} is no longer filled by ${link.providerLabel}.`, { variant: 'success', persist: false })
      } else {
        const answer = await request<{ results: Array<{ outcome: string; message?: string }> }>(POD_API_ROUTES.importProducts, {
          body: { hostId, provider: link.provider, productIds: [link.sourceProductId], content: true },
        })
        const result = answer.results[0]
        enqueueSnackbar(result?.outcome === 'failed' ? (result.message ?? 'Not updated.') : `${link.name} is up to date with ${link.providerLabel}.`, {
          variant: result?.outcome === 'failed' ? 'error' : 'success',
          persist: false,
        })
      }
      void load(page, afters[page] ?? null)
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    }
  }

  const costRange = (link: PodProductLinkView) => {
    const costs = link.variants.map((variant) => variant.costMinor).filter((cost): cost is number => cost !== null)
    if (!costs.length) return 'cost not given'
    const low = Math.min(...costs)
    const high = Math.max(...costs)
    return low === high ? `cost ${formatMoney(low, link.costCurrency)}` : `cost ${formatMoney(low, link.costCurrency)}–${formatMoney(high, link.costCurrency)}`
  }

  return (
    <CardDisplay
      variant="outlined"
      header="Imported products"
      help={help('Products brought in from a service. Each updates daily with its variants, availability and cost.', '#import-products')}
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : rows === null ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading imported products…
          </Typography>
        </Stack>
      ) : rows.length || page > 0 ? (
        <>
          <List dense disablePadding>
            {rows.map((link) => (
              <ListItem
                key={link.id}
                divider
                disableGutters
                secondaryAction={
                  <RowActionsMenu
                    label={link.name}
                    items={[
                      { key: 'resync', label: `Update from ${link.providerLabel}`, onClick: () => void act(link, 'resync') },
                      { key: 'unlink', label: `Stop filling through ${link.providerLabel}`, destructive: true, onClick: () => void act(link, 'unlink') },
                    ]}
                  />
                }
              >
                <ListItemAvatar>
                  <Avatar variant="rounded" src={link.thumbnailUrl ?? undefined} alt="">
                    {link.name.slice(0, 1)}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <span>{link.name}</span>
                      <StatusChip label={link.providerLabel} variant="outlined" />
                    </Stack>
                  }
                  secondary={
                    link.lastError ??
                    `${link.variants.length} variant${link.variants.length === 1 ? '' : 's'} · ${costRange(link)} · prices in ${storeCurrency} · updated ${formatDate(link.syncedAtMs)}`
                  }
                  slotProps={{ secondary: { color: link.lastError ? 'error' : 'text.secondary' } }}
                />
              </ListItem>
            ))}
          </List>
          <ListPagination
            page={page}
            pageSize={PAGE_SIZE}
            rowCount={rows.length}
            hasMore={Boolean(next)}
            onPageChange={(target) => {
              setPage(target)
              void load(target, afters[target] ?? null)
            }}
          />
        </>
      ) : (
        <EmptyStateComponent compact label="No products imported yet" description="Use Import products on a connection to choose what to sell." />
      )}
    </CardDisplay>
  )
}

/** The orders sent to the services, newest first, a page at a time. */
function SentOrders(props: { hostId: string }) {
  const { hostId } = props
  const request = usePodFetch()
  const [afters, setAfters] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<PodOrderView[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (index: number, after: string | null) => {
      setRows(null)
      try {
        const answer = await request<{ parts: PodOrderView[]; next: string | null }>(POD_API_ROUTES.orders, {
          query: { hostId, pageSize: String(PAGE_SIZE), ...(after ? { after } : {}) },
        })
        setRows(answer.parts)
        setNext(answer.next)
        setAfters((current) => {
          const copy = current.slice(0, index + 1)
          copy[index + 1] = answer.next
          return copy
        })
      } catch (cause) {
        setRows([])
        setError((cause as Error).message)
      }
    },
    [hostId, request],
  )

  useEffect(() => {
    void load(0, null)
  }, [load])

  return (
    <CardDisplay
      variant="outlined"
      header="Orders sent to services"
      help={help('Every paid order sent to Printful or Printify, where it stands, and what the service charged.', '#orders')}
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : rows === null ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading orders…
          </Typography>
        </Stack>
      ) : rows.length || page > 0 ? (
        <>
          <List dense disablePadding>
            {rows.map((part) => (
              <ListItem key={part.id} divider disableGutters>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>{`Order ${part.orderRef} · ${part.providerLabel}`}</span>
                      <StatusChip label={POD_ORDER_STATUS_LABELS[part.status]} tone={POD_STATUS_TONE[part.status]} />
                      {part.testMode ? <StatusChip label="Test" tone="warning" variant="outlined" /> : null}
                    </Stack>
                  }
                  secondary={
                    part.lastError ??
                    `${itemCount(part)} · cost ${formatMoney(part.costs?.totalMinor, part.costs?.currency ?? part.retailCurrency)} · sold for ${formatMoney(part.retailMinor, part.retailCurrency)} · ${formatDate(part.createdAtMs)}`
                  }
                  slotProps={{ secondary: { color: part.lastError ? 'error' : 'text.secondary' } }}
                />
              </ListItem>
            ))}
          </List>
          <ListPagination
            page={page}
            pageSize={PAGE_SIZE}
            rowCount={rows.length}
            hasMore={Boolean(next)}
            onPageChange={(target) => {
              setPage(target)
              void load(target, afters[target] ?? null)
            }}
          />
        </>
      ) : (
        <EmptyStateComponent compact label="No orders sent yet" description="When an imported product sells, its order appears here." />
      )}
    </CardDisplay>
  )
}

export default PrintOnDemandCard
