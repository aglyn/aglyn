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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MARKETING_PROVIDERS,
  type MarketingConnectionLogEntry,
  type MarketingConnectionStatus,
  type MarketingConnectionView,
  type MarketingProviderId,
} from '../model/connections'
import { useMarketingPlatformsApi, type MarketingPlatformsApi, type MarketingProviderOffer } from './marketing-platforms-api'

/** What the `hostSettings` zone hands a widget. */
export interface MarketingPlatformsCardProps {
  hostId: string
  /** Test seam: the API; the routes by default. */
  api?: MarketingPlatformsApi
}

const STATUS: Readonly<Record<MarketingConnectionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Syncing', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  error: { label: 'Stopped', tone: 'error' },
  reconnect: { label: 'Connect again', tone: 'warning' },
}

const LOG_KIND: Readonly<Record<MarketingConnectionLogEntry['kind'], { label: string; tone: StatusTone }>> = {
  run: { label: 'Synced', tone: 'success' },
  error: { label: 'Error', tone: 'error' },
  'event-failed': { label: 'Event not sent', tone: 'warning' },
}

/** What each provider reads back, for the sentence under its name. */
const READS_BACK: Readonly<Record<MarketingProviderId, string>> = {
  mailchimp: 'Contacts, tags and unsubscribes, both ways.',
  klaviyo: 'Contacts and unsubscribes both ways, plus orders and started checkouts for your flows.',
  omnisend: 'Contacts out, unsubscribes back, plus orders and started checkouts for your flows.',
  attentive: 'Contacts and orders out. Attentive does not report unsubscribes back.',
}

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

const help = (excerpt: string, anchor: '#connect' | '#settings' | '#sync-log' | '#who-is-sent') =>
  pluginDocsHelp('emailPlatforms', { anchor, excerpt })

/**
 * EMAIL PLATFORMS (AGL-3639): a site's connections to the merchant's own
 * Mailchimp, Klaviyo, Omnisend or Attentive account — one card per platform
 * the deployment offers, its state and actions in its header, and the sync
 * log under each connected one. Draws nothing where the deployment cannot
 * hold a connection, or the member cannot read the site's.
 */
export function MarketingPlatformsCard(props: MarketingPlatformsCardProps) {
  const routesApi = useMarketingPlatformsApi(props.hostId)
  const api = props.api ?? routesApi
  const [state, setState] = useState<{
    loading: boolean
    available: MarketingProviderOffer[]
    connections: MarketingConnectionView[]
  }>({ loading: true, available: [], connections: [] })

  const refresh = useCallback(async () => {
    try {
      const answer = await api.list()
      setState({ loading: false, available: answer.available ?? [], connections: answer.connections ?? [] })
    } catch {
      setState({ loading: false, available: [], connections: [] })
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const replace = useCallback((provider: MarketingProviderId, connection: MarketingConnectionView | null) => {
    setState((current) => ({
      ...current,
      connections: connection
        ? [...current.connections.filter((entry) => entry.provider !== provider), connection]
        : current.connections.filter((entry) => entry.provider !== provider),
    }))
  }, [])

  if (state.loading) return null
  // A connection whose provider is no longer offered (its app was removed)
  // is still shown, so it can be disconnected.
  const shown = [
    ...new Set([...state.available.map((offer) => offer.id), ...state.connections.map((entry) => entry.provider)]),
  ]
  if (!shown.length) return null

  return (
    <Stack spacing={2}>
      {shown.map((provider) => (
        <ProviderCard
          key={provider}
          api={api}
          provider={provider}
          offer={state.available.find((offer) => offer.id === provider) ?? null}
          connection={state.connections.find((entry) => entry.provider === provider) ?? null}
          onChange={(connection) => replace(provider, connection)}
        />
      ))}
    </Stack>
  )
}
MarketingPlatformsCard.displayName = 'MarketingPlatformsCard'

function ProviderCard(props: {
  api: MarketingPlatformsApi
  provider: MarketingProviderId
  offer: MarketingProviderOffer | null
  connection: MarketingConnectionView | null
  onChange: (connection: MarketingConnectionView | null) => void
}) {
  const { api, provider, offer, connection, onChange } = props
  const info = MARKETING_PROVIDERS[provider]
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [logKey, setLogKey] = useState(0)

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

  const connectWithKey = () =>
    run(async () => {
      const next = await api.connect(provider, apiKey.trim())
      setApiKey('')
      setConnecting(false)
      onChange(next)
      return `${info.label} is connected. The first sync starts within 15 minutes.`
    })

  const connectWithOAuth = () =>
    run(async () => {
      const url = await api.oauthStart(provider, `${window.location.pathname}${window.location.search}`)
      window.location.assign(url)
      return null
    })

  const update = (settings: Parameters<MarketingPlatformsApi['update']>[1], done: string | null = null) =>
    run(async () => {
      onChange(await api.update(provider, settings))
      return done
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${info.label}?`,
      description:
        'Nothing more is sent to it, and the stored key, the sync log and any orders not yet sent are deleted. ' +
        `Contacts already in ${info.label} stay there, and unsubscribes already read back stay on this site's list.`,
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
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <StatusChip label={STATUS[connection.status].label} tone={STATUS[connection.status].tone} />
      {connection.status === 'active' || connection.status === 'error' ? (
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = await api.syncNow(provider)
              if (next) onChange(next)
              return next && !next.lastError ? 'Synced. Anything left continues in the background.' : null
            })
          }
        >
          Sync now
        </Button>
      ) : null}
      {connection.status === 'active' || connection.status === 'paused' ? (
        <Button size="small" disabled={busy} onClick={() => update({ paused: connection.status === 'active' })}>
          {connection.status === 'active' ? 'Pause' : 'Resume'}
        </Button>
      ) : null}
      {connection.status === 'reconnect' && !connecting ? (
        <Button size="small" variant="contained" disabled={busy} onClick={() => setConnecting(true)}>
          Connect again
        </Button>
      ) : null}
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  ) : offer && !connecting ? (
    <Button size="small" variant="contained" disabled={busy} onClick={() => setConnecting(true)}>
      Connect
    </Button>
  ) : null

  return (
    <>
      <CardDisplay
        variant="outlined"
        header={info.label}
        subheader={READS_BACK[provider]}
        help={help(
          `Keep your ${info.label} account in step with this site: who may be sent marketing, and who unsubscribed on either side.`,
          '#connect',
        )}
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
          {connecting ? (
            <ConnectForm
              info={info}
              offer={offer}
              apiKey={apiKey}
              busy={busy}
              onApiKey={setApiKey}
              onConnectKey={connectWithKey}
              onConnectOAuth={connectWithOAuth}
              onCancel={() => setConnecting(false)}
            />
          ) : null}
          {connection ? (
            <ConnectionDetails connection={connection} busy={busy} onUpdate={update} />
          ) : !connecting ? (
            <Typography variant="body2" color="text.secondary">
              {`Not connected. Connect your own ${info.label} account with ${offer?.apiKey ? 'its API key' : 'your sign-in'}; Aglyn never asks for your password.`}
            </Typography>
          ) : null}
        </Stack>
      </CardDisplay>
      {connection ? <ConnectionLog key={logKey} api={api} provider={provider} /> : null}
    </>
  )
}

function ConnectForm(props: {
  info: (typeof MARKETING_PROVIDERS)[MarketingProviderId]
  offer: MarketingProviderOffer | null
  apiKey: string
  busy: boolean
  onApiKey: (value: string) => void
  onConnectKey: () => void
  onConnectOAuth: () => void
  onCancel: () => void
}) {
  const { info, offer, apiKey, busy } = props
  const byKey = Boolean(offer?.apiKey && info.apiKey)
  return (
    <Stack spacing={1.5}>
      {offer?.oauth ? (
        <Stack direction="row" spacing={1}>
          <Button variant="contained" size="small" disabled={busy} onClick={props.onConnectOAuth}>
            {`Connect with ${info.label}`}
          </Button>
          {!byKey ? (
            <Button size="small" disabled={busy} onClick={props.onCancel}>
              Cancel
            </Button>
          ) : null}
        </Stack>
      ) : null}
      {byKey && info.apiKey ? (
        <>
          <TextField
            size="small"
            type="password"
            label={info.apiKey.label}
            value={apiKey}
            onChange={(event) => props.onApiKey(event.target.value)}
            autoComplete="off"
            helperText={`${info.apiKey.help} Stored encrypted; it is never shown again.`}
          />
          <Stack direction="row" spacing={1}>
            <Button variant={offer?.oauth ? 'outlined' : 'contained'} size="small" disabled={busy || !apiKey.trim()} onClick={props.onConnectKey}>
              {busy ? 'Checking…' : 'Check and connect'}
            </Button>
            <Button size="small" disabled={busy} onClick={props.onCancel}>
              Cancel
            </Button>
          </Stack>
        </>
      ) : null}
    </Stack>
  )
}

function ConnectionDetails(props: {
  connection: MarketingConnectionView
  busy: boolean
  onUpdate: (settings: Parameters<MarketingPlatformsApi['update']>[1], done?: string | null) => void
}) {
  const { connection, busy, onUpdate } = props
  const info = MARKETING_PROVIDERS[connection.provider]
  const [tag, setTag] = useState(connection.tag)
  return (
    <Stack spacing={1.5}>
      {connection.lastError ? (
        <Alert severity={connection.status === 'active' ? 'warning' : 'error'}>{connection.lastError}</Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {[
          connection.accountName ? `Account: ${connection.accountName}` : null,
          `Last synced: ${formatTime(connection.lastSuccessAtMs)}`,
          connection.backfillDone ? null : 'Copying your contacts for the first time',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {`${connection.totals.contactsPushed} contacts sent · ${connection.totals.consentPulled} subscription changes read back${
          info.events ? ` · ${connection.totals.eventsSent} events sent` : ''
        }`}
      </Typography>
      {info.listNoun ? (
        <TextField
          select
          size="small"
          label={info.listNoun === 'audience' ? 'Audience' : 'List'}
          value={connection.listId ?? ''}
          disabled={busy || connection.status === 'reconnect'}
          onChange={(event) => onUpdate({ listId: event.target.value || null }, 'Saved. Everyone is copied to it on the next sync.')}
          helperText={connection.listId ? `Contacts go into this ${info.listNoun}.` : `Choose the ${info.listNoun} contacts go into.`}
          sx={{ maxWidth: 360 }}
        >
          {connection.lists.map((list) => (
            <MenuItem key={list.id} value={list.id}>
              {list.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          size="small"
          label="Tag"
          value={tag}
          disabled={busy}
          onChange={(event) => setTag(event.target.value)}
          helperText="Every contact this site sends carries it, so you can segment them."
          sx={{ maxWidth: 360 }}
        />
        {tag !== connection.tag ? (
          <Button size="small" disabled={busy} onClick={() => onUpdate({ tag }, 'Saved.')}>
            Save tag
          </Button>
        ) : null}
      </Stack>
      <FormControlLabel
        control={
          <Switch
            checked={connection.syncContacts}
            disabled={busy}
            onChange={(event) => onUpdate({ syncContacts: event.target.checked })}
          />
        }
        label="Sync contacts and unsubscribes"
      />
      {info.events ? (
        <FormControlLabel
          control={
            <Switch
              checked={connection.syncEvents}
              disabled={busy}
              onChange={(event) => onUpdate({ syncEvents: event.target.checked })}
            />
          }
          label="Send orders and started checkouts"
        />
      ) : null}
    </Stack>
  )
}

/**
 * The connection's sync log, newest first, in the console's shared list
 * table and its footer. The store keeps a connection's latest rows only, so
 * one read is the whole log and the table pages it.
 */
function ConnectionLog(props: { api: MarketingPlatformsApi; provider: MarketingProviderId }) {
  const { api, provider } = props
  const [rows, setRows] = useState<MarketingConnectionLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.log(provider, null).then(
      (answer) => live && setRows(answer.entries),
      (cause) => live && setError((cause as Error).message),
    )
    return () => {
      live = false
    }
  }, [api, provider])

  const columns = useMemo<GridColDef<MarketingConnectionLogEntry>[]>(
    () => [
      {
        field: 'atMs',
        headerName: 'When',
        width: 190,
        valueFormatter: (value: number) => formatTime(value),
      },
      {
        field: 'kind',
        headerName: 'Result',
        width: 150,
        renderCell: ({ row }) => <StatusChip label={LOG_KIND[row.kind].label} tone={LOG_KIND[row.kind].tone} />,
      },
      { field: 'message', headerName: 'What happened', flex: 1, minWidth: 240, sortable: false },
    ],
    [],
  )

  return (
    <CardDisplay
      variant="outlined"
      header={`${MARKETING_PROVIDERS[provider].label} sync log`}
      help={help('What each sync sent and read back, and every error, newest first.', '#sync-log')}
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : (
        <ListTable
          rows={rows ?? []}
          loading={rows === null}
          columns={columns}
          getRowId={(row: MarketingConnectionLogEntry) => row.id}
          rowHeight={TABLE_ROW_HEIGHT}
          noRowsLabel="Nothing has run yet"
          quickFilter={false}
          disableColumnFilter
        />
      )}
    </CardDisplay>
  )
}

export default MarketingPlatformsCard
