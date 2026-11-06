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
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { CopyField } from '@aglyn/shared-ui-jsx/components/copy-field.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  PluginConnectionRouteError,
  usePluginConnectionCredentialsApi,
  type PluginConnectionCredentialsAnswer,
  type PluginConnectionCredentialsApi,
} from '../hooks/use-plugin-connections-api'
import {
  formatConnectionTime,
  PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT,
  pluginConnectionRedirectUri,
} from '../model/plugin-connection-card'
import {
  PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION,
  pluginConnectionsPermissionRefusal,
  type PluginConnectionCredentialsStatus,
} from '../model/plugin-connections'

export interface ListingConnectionCredentialsCardProps {
  listingId: string
  /**
   * The viewer's resolved permissions, from the shell. Setting and clearing
   * the credentials need "Set a listing's connection credentials", as the
   * route does; without it the card stays, its buttons off and the
   * permission named. An absent key reads as allowed: the route still decides.
   */
  permissions?: Record<string, boolean | undefined>
  /** Test seam: the routes. The signed-in member's by default. */
  api?: PluginConnectionCredentialsApi
  /** Test seam: the console origin the redirect URI is built on. */
  origin?: string
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; refused: boolean }
  | { status: 'ready'; answer: PluginConnectionCredentialsAnswer }

const HELP = pluginDocsHelp('publisherHandbook', { anchor: '#connection-credentials' })

/**
 * THE PUBLISHER'S OAUTH APP FOR EACH DECLARED CONNECTION (AGL-4196).
 *
 * A plugin that declares a connection signs site owners in with its
 * publisher's own OAuth app, and the platform holds that app's client ID and
 * secret sealed. This card sets, replaces and clears them. It is
 * write-only: the route never answers either value, so all it can ever show
 * is "Set" or "Not set", and the redirect URI the publisher registers at the
 * provider.
 *
 * Drawn for the listing's publisher only, and only for a listing whose latest
 * version declares a connection: the route lists none otherwise.
 */
export function ListingConnectionCredentialsCard(props: ListingConnectionCredentialsCardProps) {
  const { listingId, permissions } = props
  const routes = usePluginConnectionCredentialsApi()
  const api = props.api ?? routes
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const canSet = permissions?.[PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION] !== false
  const redirectUri = pluginConnectionRedirectUri(props.origin)

  const refresh = useCallback(async () => {
    try {
      setLoad({ status: 'ready', answer: await api.read(listingId) })
    } catch (error) {
      const refusal = error instanceof PluginConnectionRouteError ? error : null
      setLoad({
        status: 'error',
        message: refusal?.message ?? 'The connection credentials could not be read. Try again.',
        refused: refusal?.reason === 'permission',
      })
    }
  }, [api, listingId])

  useEffect(() => {
    if (listingId) void refresh()
  }, [listingId, refresh])

  if (load.status === 'loading') return null
  if (load.status === 'error') {
    return (
      <CardDisplay header={'Connection credentials'} help={HELP} contentGutterX contentGutterY>
        <Alert severity={load.refused ? 'info' : 'error'}>{load.message}</Alert>
      </CardDisplay>
    )
  }
  const { answer } = load
  if (!answer.credentials.length) return null

  return (
    <Stack spacing={3}>
      {answer.credentials.map((entry) => (
        <ConnectionCredentials
          key={entry.connectionId}
          listingId={listingId}
          entry={entry}
          configured={answer.configured}
          canSet={canSet}
          redirectUri={redirectUri}
          api={api}
          onAnswer={(next) => setLoad({ status: 'ready', answer: next })}
        />
      ))}
    </Stack>
  )
}
ListingConnectionCredentialsCard.displayName = 'ListingConnectionCredentialsCard'

export default ListingConnectionCredentialsCard

interface ConnectionCredentialsProps {
  listingId: string
  entry: PluginConnectionCredentialsStatus
  configured: boolean
  canSet: boolean
  redirectUri: string
  api: PluginConnectionCredentialsApi
  onAnswer: (answer: PluginConnectionCredentialsAnswer) => void
}

/** One declared connection's OAuth app: set or not, and the form that replaces it. */
function ConnectionCredentials(props: ConnectionCredentialsProps) {
  const { listingId, entry, configured, canSet, redirectUri, api, onAnswer } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [editing, setEditing] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refusal = pluginConnectionsPermissionRefusal(PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION)
  const blockedReason = !canSet ? refusal : !configured ? PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT : null

  const close = () => {
    setEditing(false)
    setClientId('')
    setClientSecret('')
    setError(null)
  }

  const save = async () => {
    setBusy('save')
    setError(null)
    try {
      const answer = await api.save({ listingId, connectionId: entry.connectionId, clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      close()
      onAnswer(answer)
      enqueueSnackbar(`${entry.label} credentials saved.`, { variant: 'success' })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  const clear = async () => {
    const ok = await Promise.resolve(
      confirm({
        title: `Clear the ${entry.label} credentials?`,
        description:
          'Sites already connected stop syncing, and nobody can connect until you set new ones.',
        confirmationText: 'Clear',
        confirmationButtonProps: { color: 'warning', variant: 'contained' },
      }),
    )
      .then(() => true)
      .catch(() => false)
    if (!ok) return
    setBusy('clear')
    setError(null)
    try {
      onAnswer(await api.clear({ listingId, connectionId: entry.connectionId }))
      enqueueSnackbar(`${entry.label} credentials cleared.`, { variant: 'success' })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  const action = editing ? (
    <Stack direction="row" spacing={1}>
      <Button color="inherit" disabled={busy !== null} onClick={close}>
        {'Cancel'}
      </Button>
      <Button
        variant="contained"
        disabled={busy !== null || !clientId.trim() || !clientSecret.trim()}
        onClick={() => void save()}
      >
        {busy === 'save' ? 'Saving…' : 'Save'}
      </Button>
    </Stack>
  ) : (
    <Stack direction="row" spacing={1}>
      <BlockedControl blocked={Boolean(blockedReason)} reason={blockedReason ?? ''}>
        <Button variant={entry.set ? 'outlined' : 'contained'} disabled={busy !== null} onClick={() => setEditing(true)}>
          {entry.set ? 'Replace' : 'Set credentials'}
        </Button>
      </BlockedControl>
      {entry.set ? (
        <BlockedControl blocked={!canSet} reason={refusal}>
          <Button color="warning" disabled={busy !== null} onClick={() => void clear()}>
            {busy === 'clear' ? 'Clearing…' : 'Clear'}
          </Button>
        </BlockedControl>
      ) : null}
    </Stack>
  )

  return (
    <CardDisplay
      header={`Connection credentials: ${entry.label}`}
      help={HELP}
      contentGutterX
      contentGutterY
      HeaderProps={{ action }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <StatusChip
            label={entry.set ? 'Set' : 'Not set'}
            tone={entry.set ? 'success' : 'neutral'}
            data-testid="plugin-connection-credentials-status"
          />
          {entry.set && entry.updatedAtMs !== null ? (
            <Typography variant="body2" color="text.secondary">
              {`Last changed ${formatConnectionTime(entry.updatedAtMs)}`}
            </Typography>
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {entry.set
            ? 'Sites sign in to this service with your OAuth app. The client ID and secret are never shown again; replace them to change them.'
            : 'Until these are set, sites that install your plugin cannot connect this service.'}
        </Typography>
        {!configured ? <Alert severity="info">{PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT}</Alert> : null}
        {!canSet ? <Alert severity="info">{refusal}</Alert> : null}
        <CopyField
          label="Redirect URI"
          value={redirectUri}
          helperText="Register this address at the provider as your OAuth app's redirect URI, exactly as shown."
        />
        {editing ? (
          <Stack spacing={2}>
            <TextField
              label="Client ID"
              size="small"
              value={clientId}
              autoComplete="off"
              disabled={busy !== null}
              onChange={(event) => setClientId(event.target.value)}
              slotProps={{ htmlInput: { spellCheck: false, 'data-1p-ignore': true } }}
            />
            <TextField
              label="Client secret"
              size="small"
              type="password"
              value={clientSecret}
              autoComplete="new-password"
              disabled={busy !== null}
              onChange={(event) => setClientSecret(event.target.value)}
              helperText="Stored sealed. It cannot be read back, by you or anyone else."
              slotProps={{ htmlInput: { spellCheck: false, 'data-1p-ignore': true } }}
            />
          </Stack>
        ) : null}
        {busy === 'clear' ? <CircularProgress size={18} /> : null}
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
