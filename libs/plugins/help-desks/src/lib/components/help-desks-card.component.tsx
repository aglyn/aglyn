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
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useClientPagination } from '@aglyn/shared-ui-jsx/hooks/use-client-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
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
  HELP_DESK_PROVIDERS,
  type HelpDeskConnectionStatus,
  type HelpDeskConnectionView,
  type HelpDeskCredentialInput,
  type HelpDeskLogEntry,
  type HelpDeskProviderId,
} from '../model/connections'
import { useHelpDesksApi, type HelpDesksApi } from './help-desks-api'

/** What the `hostSettings` zone hands a widget. */
export interface HelpDesksCardProps {
  hostId: string
  /** Test seam: the API; the routes by default. */
  api?: HelpDesksApi
}

const STATUS: Readonly<Record<HelpDeskConnectionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Syncing', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  error: { label: 'Stopped', tone: 'error' },
  reconnect: { label: 'Connect again', tone: 'warning' },
}

const LOG_KIND: Readonly<Record<HelpDeskLogEntry['kind'], { label: string; tone: StatusTone }>> = {
  run: { label: 'Synced', tone: 'success' },
  error: { label: 'Error', tone: 'error' },
  'item-failed': { label: 'Not sent', tone: 'warning' },
}

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

const help = (excerpt: string, anchor: '#connect' | '#settings' | '#contact-form-tickets' | '#sync-log') =>
  pluginDocsHelp('helpDesks', { anchor, excerpt })

/**
 * HELP DESKS (AGL-3824): a site's connections to the merchant's own Gorgias,
 * Re:amaze, Kustomer, Gladly or Richpanel account. Draws nothing where the
 * deployment cannot hold a connection, or the member cannot read the site's.
 *
 * ONE card, one row per help desk. A row carries the help desk's state and
 * actions in its header; the connect form, the connection's settings and
 * its sync log open under it.
 */
export function HelpDesksCard(props: HelpDesksCardProps) {
  const routesApi = useHelpDesksApi(props.hostId)
  const api = props.api ?? routesApi
  const [state, setState] = useState<{
    loading: boolean
    available: HelpDeskProviderId[]
    connections: HelpDeskConnectionView[]
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

  const replace = useCallback((provider: HelpDeskProviderId, connection: HelpDeskConnectionView | null) => {
    setState((current) => ({
      ...current,
      connections: connection
        ? [...current.connections.filter((entry) => entry.provider !== provider), connection]
        : current.connections.filter((entry) => entry.provider !== provider),
    }))
  }, [])

  if (state.loading) return null
  // A connection whose help desk is no longer offered is still shown, so it can be disconnected.
  const shown = [...new Set([...state.available, ...state.connections.map((entry) => entry.provider)])]
  if (!shown.length) return null

  return (
    <CardDisplay
      header="Help desks"
      subheader="Show your support team each buyer's recent orders beside their tickets, and, if you choose, send contact form messages there as new tickets."
      help={help(
        'Connect your own Gorgias, Re:amaze, Kustomer, Gladly or Richpanel account, so agents see each buyer’s orders beside their tickets.',
        '#connect',
      )}
      contentGutterX
      contentGutterY
    >
      <Stack divider={<Divider flexItem />} spacing={2}>
        {shown.map((provider) => (
          <ProviderRow
            key={provider}
            api={api}
            provider={provider}
            offered={state.available.includes(provider)}
            connection={state.connections.find((entry) => entry.provider === provider) ?? null}
            onChange={(connection) => replace(provider, connection)}
          />
        ))}
      </Stack>
    </CardDisplay>
  )
}
HelpDesksCard.displayName = 'HelpDesksCard'

function ProviderRow(props: {
  api: HelpDesksApi
  provider: HelpDeskProviderId
  offered: boolean
  connection: HelpDeskConnectionView | null
  onChange: (connection: HelpDeskConnectionView | null) => void
}) {
  const { api, provider, offered, connection, onChange } = props
  const info = HELP_DESK_PROVIDERS[provider]
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<HelpDeskCredentialInput>({})
  const [connecting, setConnecting] = useState(false)
  const [showLog, setShowLog] = useState(false)
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

  const connect = () =>
    run(async () => {
      const next = await api.connect(provider, values)
      setValues({})
      setConnecting(false)
      onChange(next)
      return `${info.label} is connected. The first sync starts within 15 minutes.`
    })

  const update = (settings: Parameters<HelpDesksApi['update']>[1], done: string | null = null) =>
    run(async () => {
      onChange(await api.update(provider, settings))
      return done
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect ${info.label}?`,
      description:
        'Nothing more is sent to it, and the stored credential, the sync log and any orders or messages not yet sent are deleted. ' +
        `Customers, orders and tickets already in ${info.label} stay there.`,
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
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
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
      {connection.status === 'reconnect' && !connecting && offered ? (
        <Button size="small" variant="contained" disabled={busy} onClick={() => setConnecting(true)}>
          Connect again
        </Button>
      ) : null}
      <Button size="small" aria-expanded={showLog} onClick={() => setShowLog((open) => !open)}>
        {showLog ? 'Hide sync log' : 'Sync log'}
      </Button>
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  ) : offered && !connecting ? (
    <Button size="small" variant="contained" disabled={busy} onClick={() => setConnecting(true)}>
      Connect
    </Button>
  ) : null

  return (
    <Stack spacing={1.5} component="section" aria-label={info.label}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3">
            {info.label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {info.orders}
          </Typography>
        </Box>
        {actions ? <Box sx={{ flexShrink: 0 }}>{actions}</Box> : null}
      </Stack>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {connecting ? (
        <ConnectForm
          provider={provider}
          values={values}
          busy={busy}
          onValue={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          onConnect={connect}
          onCancel={() => setConnecting(false)}
        />
      ) : null}
      {connection ? (
        <ConnectionDetails connection={connection} busy={busy} onUpdate={update} />
      ) : !connecting ? (
        <Typography variant="body2" color="text.secondary">
          {`Not connected. Connect your own ${info.label} account with its API credentials; ${PLATFORM_BRAND_NAME} never asks for your password.`}
        </Typography>
      ) : null}
      {connection && showLog ? <ConnectionLog key={logKey} api={api} provider={provider} /> : null}
    </Stack>
  )
}

function ConnectForm(props: {
  provider: HelpDeskProviderId
  values: HelpDeskCredentialInput
  busy: boolean
  onValue: (key: keyof HelpDeskCredentialInput, value: string) => void
  onConnect: () => void
  onCancel: () => void
}) {
  const { provider, values, busy } = props
  const info = HELP_DESK_PROVIDERS[provider]
  const complete = info.fields.every((field) => String(values[field.key] ?? '').trim())
  return (
    <Stack spacing={1.5} component="form" aria-label={`Connect ${info.label}`} onSubmit={(event) => {
      event.preventDefault()
      if (complete && !busy) props.onConnect()
    }}>
      {info.fields.map((field) => (
        <TextField
          key={field.key}
          size="small"
          type={field.secret ? 'password' : field.key === 'login' || field.key === 'supportEmail' ? 'email' : 'text'}
          label={field.label}
          value={values[field.key] ?? ''}
          onChange={(event) => props.onValue(field.key, event.target.value)}
          autoComplete="off"
          helperText={field.secret ? `${field.help} Stored encrypted; it is never shown again.` : field.help}
          sx={{ maxWidth: 480 }}
        />
      ))}
      <Stack direction="row" spacing={1}>
        <Button type="submit" variant="contained" size="small" disabled={busy || !complete}>
          {busy ? 'Checking…' : 'Check and connect'}
        </Button>
        <Button size="small" disabled={busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  )
}

function ConnectionDetails(props: {
  connection: HelpDeskConnectionView
  busy: boolean
  onUpdate: (settings: Parameters<HelpDesksApi['update']>[1], done?: string | null) => void
}) {
  const { connection, busy, onUpdate } = props
  const info = HELP_DESK_PROVIDERS[connection.provider]
  const target = info.target
  const ticketPlural = `${info.ticketNoun}s`
  return (
    <Stack spacing={1.5}>
      {connection.lastError ? (
        <Alert severity={connection.status === 'active' ? 'warning' : 'error'}>{connection.lastError}</Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {[
          connection.accountName ? `Account: ${connection.accountName}` : null,
          `Last synced: ${formatTime(connection.lastSuccessAtMs)}`,
          connection.syncCustomers && !connection.backfillDone ? 'Copying your buyers and recent orders for the first time' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {`${connection.totals.customersPushed} customers sent · ${connection.totals.ordersPushed} orders sent · ${connection.totals.ticketsCreated} ${ticketPlural} opened`}
      </Typography>
      {target ? (
        <TextField
          select
          size="small"
          label={target.label}
          value={connection.targetId ?? ''}
          disabled={busy || connection.status === 'reconnect'}
          onChange={(event) => onUpdate({ targetId: event.target.value || null }, 'Saved.')}
          helperText={connection.targets.length ? target.help : `${info.label} listed no ${target.noun} to choose. Add one there, then connect again.`}
          sx={{ maxWidth: 360 }}
        >
          {connection.targets.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <FormControlLabel
        control={
          <Switch
            checked={connection.syncCustomers}
            disabled={busy}
            onChange={(event) => onUpdate({ syncCustomers: event.target.checked })}
          />
        }
        label="Send buyers and their orders"
      />
      <FormControlLabel
        control={
          <Switch
            checked={connection.sendTickets}
            disabled={busy}
            onChange={(event) =>
              onUpdate(
                { sendTickets: event.target.checked },
                event.target.checked ? `New contact form messages now go to ${info.label}.` : null,
              )
            }
          />
        }
        label={`Send contact form messages to ${info.label}`}
      />
      <Typography variant="body2" color="text.secondary">
        {`Each message submitted through this site's forms opens a new ${info.ticketNoun} from its sender. Messages still arrive in your Inbox.`}
      </Typography>
    </Stack>
  )
}

/**
 * The connection's sync log, newest first: the shared paged list and its
 * footer, opened under the help desk's row. The store keeps a connection's
 * latest rows only, so one read is the whole log and the list pages it in
 * memory.
 */
function ConnectionLog(props: { api: HelpDesksApi; provider: HelpDeskProviderId }) {
  const { api, provider } = props
  const [rows, setRows] = useState<HelpDeskLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pagination = useClientPagination(rows ?? [])

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

  return (
    <Box component="section" aria-label={`${HELP_DESK_PROVIDERS[provider].label} sync log`}>
      <Typography variant="subtitle2" component="h4" gutterBottom>
        Sync log
      </Typography>
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : rows === null ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading the sync log…
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
                      <StatusChip label={LOG_KIND[row.kind].label} tone={LOG_KIND[row.kind].tone} variant="outlined" />
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
        <EmptyStateComponent compact label="Nothing has run yet." />
      )}
    </Box>
  )
}

export default HelpDesksCard
