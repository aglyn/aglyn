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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_STORE_SETTINGS,
  DELIVERY_SERVICES,
  type DeliveryCatalogOption,
  type DeliveryItemMatchView,
  type DeliveryServiceId,
  type DeliveryStoreSettings,
  type DeliveryStoreView,
} from '../model/delivery-apps'
import { useDeliveryAppsApi, type DeliveryAppsApi } from './delivery-apps-api'

/** What the `commerceSettings` zone hands a widget. */
export interface DeliveryAppsCardProps {
  hostId: string
  orgId?: string
  /** Test seam: the API; the routes by default. */
  api?: DeliveryAppsApi
}

type HelpAnchor = '#connect-a-store' | '#the-menu' | '#match-items' | '#taking-orders'
const help = (excerpt: string, anchor: HelpAnchor) => pluginDocsHelp('deliveryApps', { anchor, excerpt })

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

/**
 * DELIVERY APPS (AGL-3644): a store's links to its own DoorDash, Uber Eats
 * and Grubhub stores — one card per service the deployment offers, its state
 * and actions in its header, its settings and item matches in its body.
 * Draws nothing where the deployment offers no service, or the member is not
 * the site's admin.
 */
export function DeliveryAppsCard(props: DeliveryAppsCardProps) {
  const routesApi = useDeliveryAppsApi(props.hostId)
  const api = props.api ?? routesApi
  const [state, setState] = useState<{
    loading: boolean
    offered: Array<{ id: DeliveryServiceId; sandbox: boolean }>
    stores: DeliveryStoreView[]
  }>({ loading: true, offered: [], stores: [] })

  const refresh = useCallback(async () => {
    try {
      const answer = await api.stores()
      setState({ loading: false, offered: answer.offered ?? [], stores: answer.stores ?? [] })
    } catch {
      setState({ loading: false, offered: [], stores: [] })
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const replace = useCallback((service: DeliveryServiceId, store: DeliveryStoreView | null) => {
    setState((current) => ({
      ...current,
      stores: store
        ? [...current.stores.filter((entry) => entry.service !== service), store]
        : current.stores.filter((entry) => entry.service !== service),
    }))
  }, [])

  if (state.loading || !state.offered.length) return null

  return (
    <Stack spacing={2}>
      {state.offered.map((offer) => (
        <ServiceCard
          key={offer.id}
          api={api}
          service={offer.id}
          sandbox={offer.sandbox}
          store={state.stores.find((entry) => entry.service === offer.id) ?? null}
          onChange={(store) => replace(offer.id, store)}
        />
      ))}
    </Stack>
  )
}
DeliveryAppsCard.displayName = 'DeliveryAppsCard'

function ServiceCard(props: {
  api: DeliveryAppsApi
  service: DeliveryServiceId
  sandbox: boolean
  store: DeliveryStoreView | null
  onChange: (store: DeliveryStoreView | null) => void
}) {
  const { api, service, sandbox, store, onChange } = props
  const info = DELIVERY_SERVICES[service]
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storeId, setStoreId] = useState('')
  const [itemsKey, setItemsKey] = useState(0)

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

  const save = (settings: DeliveryStoreSettings) =>
    run(async () => {
      onChange(await api.update(service, settings))
      return 'Saved.'
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${info.label}?`,
      description:
        `New ${info.label} orders stop coming to your register. Orders already taken stay in your store. ` +
        `Turn the integration off in ${info.label} too, or its orders wait there for an answer.`,
      confirmationText: 'Disconnect',
      confirmationButtonProps: { color: 'error' },
    }).then(
      () => true,
      () => false,
    )
    if (!accepted) return
    await run(async () => {
      await api.disconnect(service)
      onChange(null)
      return `${info.label} is disconnected.`
    })
  }

  const actions = store ? (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      {sandbox ? <StatusChip label="Sandbox" tone="info" variant="outlined" /> : null}
      <StatusChip label="Connected" tone="success" />
      <Button
        size="small"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const items = await api.sendMenu(service)
            onChange({ ...store, menu: { publishedAtMs: Date.now(), items, error: null } })
            return `Menu sent to ${info.label}: ${items} item${items === 1 ? '' : 's'}.`
          })
        }
      >
        Send menu
      </Button>
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  ) : sandbox ? (
    <StatusChip label="Sandbox" tone="info" variant="outlined" />
  ) : null

  return (
    <CardDisplay
      variant="outlined"
      header={info.label}
      subheader={`${info.label} orders come to your register to accept, and take their items off the same shelf.`}
      help={help(`Link your own ${info.label} store, and its orders come to your register.`, '#connect-a-store')}
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
        {store ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {`${info.storeIdLabel}: ${store.externalStoreId}`}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={store.settings.autoAccept}
                  disabled={busy}
                  onChange={(event) => void save({ ...store.settings, autoAccept: event.target.checked })}
                />
              }
              label="Accept orders automatically"
            />
            <PrepMinutes
              value={store.settings.prepMinutes}
              disabled={busy}
              onSave={(prepMinutes) => void save({ ...store.settings, prepMinutes })}
            />
            {store.menu.error ? (
              <Alert severity="warning">{store.menu.error}</Alert>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {store.menu.publishedAtMs
                  ? `Menu last sent ${formatTime(store.menu.publishedAtMs)}, ${store.menu.items} item${store.menu.items === 1 ? '' : 's'}.`
                  : `Send your menu to fill ${info.label} from your products, so every order names the product it sold.`}
              </Typography>
            )}
            <ItemMatches key={itemsKey} api={api} service={service} onMatched={() => setItemsKey((key) => key + 1)} />
          </>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {`Not connected. Enter your ${info.storeIdLabel} to send its orders to your register.${
                sandbox ? ` This deployment takes ${info.label} test orders only.` : ''
              }`}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
              <TextField
                size="small"
                label={info.storeIdLabel}
                helperText={info.storeIdHelp}
                value={storeId}
                disabled={busy}
                onChange={(event) => setStoreId(event.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                disabled={busy || !storeId.trim()}
                onClick={() =>
                  run(async () => {
                    onChange(await api.connect(service, storeId.trim(), DEFAULT_STORE_SETTINGS))
                    setStoreId('')
                    return `${info.label} is connected.`
                  })
                }
              >
                Connect
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}

/** The kitchen's minutes, saved when the field loses focus with a changed, valid value. */
function PrepMinutes(props: { value: number; disabled: boolean; onSave: (value: number) => void }) {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])
  const number = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(number) && number >= 5 && number <= 120
  return (
    <TextField
      size="small"
      type="number"
      label="Prep time (minutes)"
      value={text}
      disabled={props.disabled}
      error={!valid}
      helperText={valid ? 'Sent with each order you accept, so the courier arrives when it is ready.' : 'Between 5 and 120.'}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (valid && number !== props.value) props.onSave(number)
      }}
      slotProps={{ htmlInput: { min: 5, max: 120, step: 1 } }}
      sx={{ maxWidth: 260 }}
    />
  )
}

/**
 * The service's items and the product each takes stock from. An item from a
 * menu this plugin sent names its product already; one the merchant built
 * on the service matches by SKU, or by the product chosen here.
 */
function ItemMatches(props: { api: DeliveryAppsApi; service: DeliveryServiceId; onMatched: () => void }) {
  const { api, service, onMatched } = props
  const [items, setItems] = useState<DeliveryItemMatchView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState<DeliveryItemMatchView | null>(null)

  useEffect(() => {
    let live = true
    api.items(service).then(
      (answer) => live && setItems(answer),
      (cause: Error) => live && setError(cause.message),
    )
    return () => {
      live = false
    }
  }, [api, service])

  const clear = async (item: DeliveryItemMatchView) => {
    try {
      await api.match(service, item, null)
      onMatched()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  if (error) return <Alert severity="error">{error}</Alert>
  if (!items?.length) return null
  const waiting = items.filter((item) => !item.productId).length
  return (
    <CardDisplay
      variant="outlined"
      header="Items"
      subheader={
        waiting
          ? `${waiting} item${waiting === 1 ? '' : 's'} sold on ${DELIVERY_SERVICES[service].label} match no product, so their stock is not counted.`
          : 'Each item takes stock from the product it is matched to.'
      }
      help={help('Match an item the service sells to the product it takes stock from.', '#match-items')}
      contentGutterX
    >
      <List dense disablePadding>
        {items.map((item) => (
          <ListItem
            key={item.externalItemId}
            disableGutters
            secondaryAction={
              item.productId ? (
                <Button size="small" onClick={() => void clear(item)}>
                  Clear
                </Button>
              ) : (
                <Button size="small" variant="outlined" onClick={() => setMatching(item)}>
                  Match
                </Button>
              )
            }
          >
            <ListItemText
              primary={item.name}
              secondary={item.productId ? `Takes stock from ${item.title}` : `Not matched · ${item.externalItemId}`}
            />
          </ListItem>
        ))}
      </List>
      <MatchDialog
        api={api}
        service={service}
        item={matching}
        onClose={(matched) => {
          setMatching(null)
          if (matched) onMatched()
        }}
      />
    </CardDisplay>
  )
}

function MatchDialog(props: {
  api: DeliveryAppsApi
  service: DeliveryServiceId
  item: DeliveryItemMatchView | null
  onClose: (matched: boolean) => void
}) {
  const { api, service, item, onClose } = props
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<DeliveryCatalogOption[]>([])
  const [chosen, setChosen] = useState<DeliveryCatalogOption | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!item) return undefined
    let live = true
    const timer = setTimeout(() => {
      api.searchCatalog(query).then(
        (found) => live && setOptions(found),
        (cause: Error) => live && setError(cause.message),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [api, item, query])

  useEffect(() => {
    if (!item) {
      setQuery('')
      setChosen(null)
      setError(null)
    }
  }, [item])

  return (
    <Dialog open={Boolean(item)} onClose={() => onClose(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{`Match ${item?.name ?? 'item'}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {'Each one sold takes a unit of this product off your shelf.'}
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Autocomplete
          options={options}
          value={chosen}
          filterOptions={(list) => list}
          getOptionLabel={(option) => (option.sku ? `${option.title} · ${option.sku}` : option.title)}
          isOptionEqualToValue={(option, value) => option.productId === value.productId && option.variantId === value.variantId}
          onChange={(_event, value) => setChosen(value)}
          onInputChange={(_event, value, reason) => {
            // Only what is typed is searched; a pick fills the field without asking again.
            if (reason === 'input' || reason === 'clear') setQuery(reason === 'clear' ? '' : value)
          }}
          renderInput={(params) => <TextField {...params} label="Product" />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!chosen || busy}
          onClick={async () => {
            if (!item || !chosen) return
            setBusy(true)
            try {
              await api.match(service, item, chosen)
              onClose(true)
            } catch (cause) {
              setError((cause as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          Match
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default DeliveryAppsCard
