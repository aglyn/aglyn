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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { SALES_CHANNELS_API_ROUTES } from '../constants/bundle-common'
import { SALES_CHANNELS, type SalesChannelDefinition } from '../model/channels'
import type { ChannelDiagnostics } from '../model/diagnostics'
import type { SalesChannelSettings } from '../model/settings'
import { ChannelConnection } from './channel-connection.component'
import {
  useSalesChannelsFetch,
  type CatalogDiagnostics,
  type ChannelState,
  type SalesChannelsState,
} from './sales-channels-api'

/** What `commerceSettings` hands a widget: the site, and its workspace when known. */
export interface SalesChannelsCardProps {
  hostId: string
  orgId?: string
}

const formatTime = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''

/**
 * SALES CHANNELS, on the store's Settings (AGL-3637): one card per shopping
 * channel, each with its feed's switch, the address to paste into the
 * channel, the steps to do it, and what the feed leaves out. Above them, the
 * store's defaults for a product that leaves a channel field blank.
 *
 * Every write is a route's: the token is minted and replaced on the server
 * and never stored where a client can read it.
 */
export function SalesChannelsCard(props: SalesChannelsCardProps) {
  const { hostId } = props
  const request = useSalesChannelsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<SalesChannelsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<CatalogDiagnostics | null>(null)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await request<SalesChannelsState>(SALES_CHANNELS_API_ROUTES.state, { query: { hostId } }))
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [hostId, request])

  useEffect(() => {
    void load()
  }, [load])

  const check = async () => {
    setChecking(true)
    try {
      setDiagnostics(
        await request<CatalogDiagnostics>(SALES_CHANNELS_API_ROUTES.diagnostics, { query: { hostId } }),
      )
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setChecking(false)
    }
  }

  const replaceChannel = (next: ChannelState) =>
    setState((current) =>
      current
        ? { ...current, channels: current.channels.map((held) => (held.id === next.id ? next : held)) }
        : current,
    )

  if (error && !state) {
    return (
      <CardDisplay header="Sales channels" help={pluginDocsHelp('salesChannels')} contentGutterX contentGutterY>
        <Alert severity="error">{error}</Alert>
      </CardDisplay>
    )
  }
  if (!state) return null

  return (
    <CardDisplay
      header="Sales channels"
      help={pluginDocsHelp('salesChannels', { anchor: '#turn-on-a-channel' })}
      subheader="List your products on Google, YouTube, Facebook, Instagram, TikTok, Pinterest, Snapchat and Microsoft Shopping. Each channel reads its own product feed on a schedule, so changes reach it without another upload."
      HeaderProps={{
        action: (
          <Button variant="outlined" onClick={check} disabled={checking || !state.sells}>
            {checking ? 'Checking…' : 'Check products'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} data-testid="sales-channels-card">
        {!state.sells ? (
          <Alert severity="info">{'Turn on Commerce for this site to publish product feeds.'}</Alert>
        ) : null}
        {state.store && !state.store.origin ? (
          <Alert severity="warning">
            {'This site has no web address yet. Publish it to a subdomain or a custom domain to get its feed addresses.'}
          </Alert>
        ) : null}
        {state.store && state.store.origin && !state.store.productPagesServed ? (
          <Alert severity="warning">
            {'Product pages are not served yet, so channels would refuse every product. Choose a product page template in the store settings above.'}
          </Alert>
        ) : null}
        {diagnostics ? <DiagnosticsSummary diagnostics={diagnostics} /> : null}
        <DefaultsCard
          hostId={hostId}
          settings={state.settings}
          storeName={state.store?.name ?? ''}
          onSaved={(settings) => setState((current) => (current ? { ...current, settings } : current))}
        />
        {SALES_CHANNELS.map((channel) => {
          const held = state.channels.find((entry) => entry.id === channel.id)
          if (!held) return null
          return (
            <ChannelCard
              key={channel.id}
              hostId={hostId}
              channel={channel}
              state={held}
              canEnable={state.sells}
              diagnostics={diagnostics?.channels.find((entry) => entry.channel === channel.id) ?? null}
              legacy={channel.id === 'google' ? state.legacy : null}
              connect={state.connect?.providers.find((entry) => entry.provider === channel.id) ?? null}
              onChange={replaceChannel}
              onLegacyRetired={() =>
                setState((current) =>
                  current ? { ...current, legacy: { ...current.legacy, active: false } } : current,
                )
              }
            />
          )
        })}
      </Stack>
    </CardDisplay>
  )
}
SalesChannelsCard.displayName = 'SalesChannelsCard'

function DiagnosticsSummary(props: { diagnostics: CatalogDiagnostics }) {
  const { diagnostics } = props
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        {`Checked ${diagnostics.offers} product listing${diagnostics.offers === 1 ? '' : 's'}${
          diagnostics.partial ? ' (the first of a larger catalog)' : ''
        }. Each channel below says what its feed leaves out.`}
      </Typography>
      {diagnostics.store.map((problem) => (
        <Alert key={problem} severity="warning">
          {problem}
        </Alert>
      ))}
    </Stack>
  )
}

function DefaultsCard(props: {
  hostId: string
  settings: SalesChannelSettings
  storeName: string
  onSaved: (settings: SalesChannelSettings) => void
}) {
  const { hostId, settings, storeName, onSaved } = props
  const request = useSalesChannelsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(settings), [settings])
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const save = async () => {
    setSaving(true)
    try {
      const answer = await request<{ settings: SalesChannelSettings }>(SALES_CHANNELS_API_ROUTES.settings, {
        body: { hostId, settings: draft },
      })
      onSaved(answer.settings)
      enqueueSnackbar('Defaults saved', { variant: 'success' })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CardDisplay
      variant="outlined"
      header="Defaults for every feed"
      help={pluginDocsHelp('salesChannels', { anchor: '#brand-barcode-and-category' })}
      subheader="Used for a product that leaves a field blank. Set a product's own brand, barcode and category in the product editor."
      HeaderProps={{
        action: (
          <Button variant="contained" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          label="Brand"
          value={draft.defaultBrand}
          placeholder={storeName}
          helperText={storeName ? `Blank sends “${storeName}”.` : 'Blank sends the store’s name.'}
          onChange={(event) => setDraft({ ...draft, defaultBrand: event.target.value.slice(0, 70) })}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="Condition"
          value={draft.defaultCondition}
          onChange={(event) =>
            setDraft({ ...draft, defaultCondition: event.target.value as SalesChannelSettings['defaultCondition'] })
          }
          sx={{ flex: 1 }}
        >
          <MenuItem value="new">{'New'}</MenuItem>
          <MenuItem value="refurbished">{'Refurbished'}</MenuItem>
          <MenuItem value="used">{'Used'}</MenuItem>
        </TextField>
        <TextField
          label="Google product category"
          value={draft.defaultGoogleCategory}
          helperText="An id like 2271 or a path like Apparel & Accessories > Clothing."
          onChange={(event) => setDraft({ ...draft, defaultGoogleCategory: event.target.value.slice(0, 750) })}
          sx={{ flex: 1 }}
        />
      </Stack>
    </CardDisplay>
  )
}

function ChannelCard(props: {
  hostId: string
  channel: SalesChannelDefinition
  state: ChannelState
  canEnable: boolean
  diagnostics: ChannelDiagnostics | null
  legacy: SalesChannelsState['legacy'] | null
  /** The channel's API connection, listed only on a deployment that configured it. */
  connect: NonNullable<SalesChannelsState['connect']>['providers'][number] | null
  onChange: (next: ChannelState) => void
  onLegacyRetired: () => void
}) {
  const { hostId, channel, state, canEnable, diagnostics, legacy, connect, onChange, onLegacyRetired } = props
  const request = useSalesChannelsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'rotate' | 'legacy' | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (enabled: boolean) =>
    run(async () => {
      const answer = await request<{ channel: ChannelState }>(SALES_CHANNELS_API_ROUTES.channel, {
        body: { hostId, channel: channel.id, enabled },
      })
      onChange(answer.channel)
    })

  const rotate = () =>
    run(async () => {
      const answer = await request<{ channel: ChannelState }>(SALES_CHANNELS_API_ROUTES.rotate, {
        body: { hostId, channel: channel.id },
      })
      onChange(answer.channel)
      if (channel.id === 'google') onLegacyRetired()
      setConfirm(null)
      enqueueSnackbar(`New ${channel.label} feed address ready. Paste it into ${channel.label}.`, {
        variant: 'success',
      })
    })

  const retireLegacy = () =>
    run(async () => {
      await request(SALES_CHANNELS_API_ROUTES.legacy, { body: { hostId } })
      onLegacyRetired()
      setConfirm(null)
    })

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() =>
      enqueueSnackbar('Feed address copied', { variant: 'success', persist: false }),
    )
  }

  return (
    <CardDisplay
      variant="outlined"
      header={channel.label}
      help={pluginDocsHelp('salesChannels', { anchor: '#turn-on-a-channel' })}
      subheader={channel.reach}
      HeaderProps={{
        action: (
          <FormControlLabel
            label={state.enabled ? 'On' : 'Off'}
            control={
              <Switch
                checked={state.enabled}
                disabled={busy || (!state.enabled && !canEnable)}
                onChange={(event) => void toggle(event.target.checked)}
                slotProps={{ input: { 'aria-label': `${channel.label} feed` } }}
              />
            }
          />
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5} data-testid={`sales-channel-${channel.id}`}>
        {state.enabled && state.url ? (
          <Stack spacing={1}>
            <TextField
              label={`${channel.label} feed address`}
              value={state.url}
              size="small"
              slotProps={{ input: { readOnly: true } }}
              onFocus={(event) => event.target.select()}
              helperText={
                state.lastFetchAtMs
                  ? `Last read ${formatTime(state.lastFetchAtMs)}.`
                  : `${channel.label} has not read this feed yet.`
              }
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => copy(state.url as string)}>
                {'Copy address'}
              </Button>
              <Button size="small" color="warning" disabled={busy} onClick={() => setConfirm('rotate')}>
                {'Replace address'}
              </Button>
            </Stack>
          </Stack>
        ) : state.enabled ? (
          <Typography variant="body2" color="text.secondary">
            {'The address appears once the site has a web address.'}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {`Turn the feed on to get the address ${channel.label} reads.`}
          </Typography>
        )}
        {legacy?.active && legacy.url ? (
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" disabled={busy} onClick={() => setConfirm('legacy')}>
                {'Turn off'}
              </Button>
            }
          >
            {`Your earlier Merchant Center address still works: ${legacy.url}. Turn it off once Merchant Center reads the address above.`}
          </Alert>
        ) : null}
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{`Set up ${channel.label}`}</Typography>
          <Typography component="ol" variant="body2" sx={{ m: 0, pl: 2.5 }}>
            {channel.setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </Typography>
          <Stack direction="row" spacing={2}>
            <Link href={channel.setupUrl} target="_blank" rel="noopener noreferrer" variant="body2">
              {`Open ${channel.label}`}
            </Link>
            <Link href={channel.specUrl} target="_blank" rel="noopener noreferrer" variant="body2">
              {'Product data rules'}
            </Link>
          </Stack>
        </Stack>
        <ChannelConnection hostId={hostId} entry={connect} />
        {diagnostics ? <ChannelDiagnosticsView diagnostics={diagnostics} /> : null}
      </Stack>
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm === 'legacy' ? 'Turn off the earlier address?' : 'Replace the feed address?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === 'legacy'
              ? 'Merchant Center stops receiving updates from the earlier address at once. Do this after it reads the new address.'
              : `The current address stops working at once, and ${channel.label} stops receiving updates until you paste the new one.${
                  channel.id === 'google' ? ' The earlier Merchant Center address stops too.' : ''
                }`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{'Cancel'}</Button>
          <Button
            color="warning"
            variant="contained"
            disabled={busy}
            onClick={() => void (confirm === 'legacy' ? retireLegacy() : rotate())}
          >
            {confirm === 'legacy' ? 'Turn off' : 'Replace'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

function ChannelDiagnosticsView(props: { diagnostics: ChannelDiagnostics }) {
  const { diagnostics } = props
  const [open, setOpen] = useState(false)
  const summary = `${diagnostics.listed} listed · ${diagnostics.excluded} left out · ${diagnostics.warned} with suggestions`
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2">{summary}</Typography>
        {diagnostics.products.length ? (
          <Button size="small" onClick={() => setOpen(!open)}>
            {open ? 'Hide products' : 'Show products'}
          </Button>
        ) : null}
      </Stack>
      {open
        ? diagnostics.products.map((product) => (
            <Stack key={product.productId} spacing={0.25}>
              <Typography variant="subtitle2">
                {product.excludedOffers
                  ? `${product.productName} — left out${product.offers > 1 ? ` (${product.excludedOffers} of ${product.offers})` : ''}`
                  : product.productName}
              </Typography>
              {product.issues.map((issue) => (
                <Typography
                  key={`${issue.field}:${issue.message}`}
                  variant="body2"
                  color={issue.severity === 'error' ? 'error' : 'text.secondary'}
                >
                  {issue.message}
                </Typography>
              ))}
            </Stack>
          ))
        : null}
      {open && diagnostics.truncated ? (
        <Typography variant="body2" color="text.secondary">
          {'More products have suggestions than are listed here.'}
        </Typography>
      ) : null}
    </Stack>
  )
}

export default SalesChannelsCard
