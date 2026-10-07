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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { SALES_CHANNELS_API_ROUTES } from '../constants/bundle-common'
import { useSalesChannelsFetch, type ConnectionState } from './sales-channels-api'

/**
 * A CHANNEL'S API CONNECTION (AGL-3637, phase 2), inside the Google or Meta
 * channel card: connect, choose the Merchant Center account or catalog,
 * sync now, disconnect, and what the last sync did.
 *
 * Drawn only for a provider the state route lists under `connect`, which it
 * does only on a deployment that configured that provider: an unconfigured
 * deployment shows the feed alone.
 */

export type ConnectProvider = ConnectionState['provider']

export interface ChannelConnectionProps {
  hostId: string
  /** The state route's entry for this provider; nothing is drawn without it. */
  entry: { provider: ConnectProvider; connection: ConnectionState | null } | null | undefined
}

/** How close to its expiry a Meta grant asks for a reconnect. */
export const RECONNECT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const LABELS: Record<ConnectProvider, { service: string; target: string; targets: string }> = {
  google: { service: 'Google Merchant Center', target: 'Merchant Center account', targets: 'accounts' },
  meta: { service: 'Meta Commerce Manager', target: 'Catalog', targets: 'catalogs' },
}

const OUTCOMES: Record<string, { severity: 'success' | 'warning' | 'error'; message: (service: string) => string }> = {
  connected: { severity: 'success', message: (service) => `Connected to ${service}. Sync now to send your products.` },
  'no-targets': {
    severity: 'warning',
    message: (service) => `Connected, but the account you signed in with reaches nothing to send products to in ${service}.`,
  },
  denied: { severity: 'warning', message: (service) => `${service} access was not granted.` },
  expired: { severity: 'error', message: () => 'The connection took too long or was already used. Connect again.' },
  'not-permitted': { severity: 'error', message: () => 'Only a site admin can connect a channel.' },
  failed: { severity: 'error', message: (service) => `${service} could not be connected. Try again.` },
}

const formatTime = (ms: number | undefined): string =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''

/** The outcome the callback left in the address for this provider, removed once read. */
function useConnectOutcome(provider: ConnectProvider | undefined): string | null {
  const [outcome, setOutcome] = useState<string | null>(null)
  useEffect(() => {
    if (!provider || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('salesChannelsProvider') !== provider) return
    const found = url.searchParams.get('salesChannelsConnect')
    if (!found || !OUTCOMES[found]) return
    setOutcome(found)
    url.searchParams.delete('salesChannelsProvider')
    url.searchParams.delete('salesChannelsConnect')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [provider])
  return outcome
}

export function ChannelConnection(props: ChannelConnectionProps) {
  const { hostId, entry } = props
  const request = useSalesChannelsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [connection, setConnection] = useState<ConnectionState | null>(entry?.connection ?? null)
  const [busy, setBusy] = useState<'connect' | 'sync' | 'select' | 'disconnect' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const outcome = useConnectOutcome(entry?.provider)
  useEffect(() => setConnection(entry?.connection ?? null), [entry?.connection])

  if (!entry) return null
  const provider = entry.provider
  const labels = LABELS[provider]

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<void>) => {
    setBusy(kind)
    try {
      await work()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const connect = () =>
    run('connect', async () => {
      const answer = await request<{ authorizeUrl: string }>(SALES_CHANNELS_API_ROUTES.connectStart, {
        body: { hostId, provider, returnTo: window.location.href },
      })
      window.location.assign(answer.authorizeUrl)
    })

  const select = (targetId: string) =>
    run('select', async () => {
      const answer = await request<{ connection: ConnectionState | null }>(SALES_CHANNELS_API_ROUTES.connectSelect, {
        body: { hostId, provider, targetId },
      })
      setConnection(answer.connection)
    })

  const sync = () =>
    run('sync', async () => {
      const answer = await request<{ connection: ConnectionState | null; result: { sent: number; failed: number } }>(
        SALES_CHANNELS_API_ROUTES.sync,
        { body: { hostId, provider } },
      )
      setConnection(answer.connection)
      enqueueSnackbar(
        answer.result.failed
          ? `Sent ${answer.result.sent} products; ${answer.result.failed} were refused.`
          : `Sent ${answer.result.sent} products to ${labels.service}.`,
        { variant: answer.result.failed ? 'warning' : 'success' },
      )
    })

  const disconnect = () =>
    run('disconnect', async () => {
      await request(SALES_CHANNELS_API_ROUTES.disconnect, { body: { hostId, provider } })
      setConnection(null)
      setConfirm(false)
    })

  const expiresAtMs = connection?.tokenExpiresAtMs
  const reconnectDue = Boolean(expiresAtMs && expiresAtMs - Date.now() < RECONNECT_WINDOW_MS)
  const result = connection?.lastSyncResult

  const action = !connection ? (
    <Button variant="contained" onClick={() => void connect()} disabled={busy !== null}>
      {busy === 'connect' ? 'Opening…' : 'Connect'}
    </Button>
  ) : (
    <Stack direction="row" spacing={1}>
      {reconnectDue ? (
        <Button variant="outlined" onClick={() => void connect()} disabled={busy !== null}>
          {'Reconnect'}
        </Button>
      ) : null}
      <Button
        variant="contained"
        onClick={() => void sync()}
        disabled={busy !== null || !connection.targetId}
      >
        {busy === 'sync' ? 'Syncing…' : 'Sync now'}
      </Button>
      <Button color="warning" onClick={() => setConfirm(true)} disabled={busy !== null}>
        {'Disconnect'}
      </Button>
    </Stack>
  )

  return (
    <CardDisplay
      variant="outlined"
      header={`Product sync with ${labels.service}`}
      subheader={
        connection
          ? `Connected ${formatTime(connection.connectedAtMs)}. Sends the products this feed lists straight to ${labels.service}.`
          : `Connect to send products straight to ${labels.service} instead of waiting for it to read the feed.`
      }
      HeaderProps={{ action }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5} data-testid={`sales-channel-connection-${provider}`}>
        {outcome ? (
          <Alert severity={OUTCOMES[outcome].severity}>{OUTCOMES[outcome].message(labels.service)}</Alert>
        ) : null}
        {reconnectDue ? (
          <Alert severity="warning">
            {`The connection to ${labels.service} expires ${formatTime(expiresAtMs)}. Reconnect to keep syncing.`}
          </Alert>
        ) : null}
        {connection ? (
          connection.targets.length ? (
            <TextField
              select
              size="small"
              label={labels.target}
              value={connection.targetId}
              disabled={busy !== null}
              onChange={(event) => void select(event.target.value)}
            >
              {connection.targets.map((target) => (
                <MenuItem key={target.id} value={target.id}>
                  {target.name}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Alert severity="warning">
              {`The account you connected reaches no ${labels.targets}. Create one in ${labels.service}, then reconnect.`}
            </Alert>
          )
        ) : null}
        {connection && result ? (
          <Stack spacing={0.5}>
            <Typography variant="body2">
              {`Last sync ${formatTime(connection.lastSyncAtMs)}: ${result.sent} sent${
                result.deleted ? `, ${result.deleted} removed` : ''
              }${result.failed ? `, ${result.failed} refused` : ''}.${
                result.partial ? ' Only the first part of a larger catalog was read.' : ''
              }`}
            </Typography>
            {result.errors.map((message) => (
              <Typography key={message} variant="body2" color="error">
                {message}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Stack>
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>{`Disconnect ${labels.service}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`Products already sent stay in ${labels.service} until you remove them there. The feed address keeps working.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>{'Cancel'}</Button>
          <Button color="warning" variant="contained" disabled={busy !== null} onClick={() => void disconnect()}>
            {'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

export default ChannelConnection
