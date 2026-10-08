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
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  AD_PROVIDER_IDS,
  AD_PROVIDERS,
  type AdConnectionStatus,
  type AdConnectionView,
  type AdProviderId,
  type AdSiteSetup,
} from '../model/connections'
import { useAdConversionsApi, type AdConversionsApi } from './ad-conversions-api'

/** What the `hostSettings` zone hands a widget. */
export interface AdConversionsCardProps {
  hostId: string
  /** Test seam: the API; the routes by default. */
  api?: AdConversionsApi
}

const STATUS: Readonly<Record<AdConnectionStatus, { label: string; tone: StatusTone }>> = {
  active: { label: 'Connected', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  reconnect: { label: 'Connect again', tone: 'warning' },
}

const formatTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : 'Not yet')

const help = (excerpt: string, anchor: '#conversions-api' | '#consent' | '#test-events') =>
  pluginDocsHelp('adTracking', { anchor, excerpt })

/**
 * AD CONVERSIONS (AGL-3694): a site's Conversions API connections to the
 * merchant's own Meta, TikTok and Pinterest ad accounts — one card per vendor,
 * its state and actions in its header, what it last sent or failed in its
 * body. The access token is written here and never shown again. Draws nothing
 * where the deployment cannot hold a token.
 */
export function AdConversionsCard(props: AdConversionsCardProps) {
  const routesApi = useAdConversionsApi(props.hostId)
  const api = props.api ?? routesApi
  const [state, setState] = useState<{
    loading: boolean
    available: boolean
    setup: AdSiteSetup | null
    connections: AdConnectionView[]
  }>({ loading: true, available: false, setup: null, connections: [] })

  const refresh = useCallback(async () => {
    try {
      const answer = await api.list()
      setState({
        loading: false,
        available: answer.available === true,
        setup: answer.setup ?? null,
        connections: answer.connections ?? [],
      })
    } catch {
      setState({ loading: false, available: false, setup: null, connections: [] })
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const replace = useCallback((provider: AdProviderId, connection: AdConnectionView | null) => {
    setState((current) => ({
      ...current,
      connections: connection
        ? [...current.connections.filter((entry) => entry.provider !== provider), connection]
        : current.connections.filter((entry) => entry.provider !== provider),
    }))
  }, [])

  if (state.loading || !state.setup) return null
  // A connection made before the deployment lost its key is still shown, so
  // it can be disconnected.
  if (!state.available && !state.connections.length) return null

  return (
    <Stack spacing={2}>
      {!state.setup.asksAboutAdvertising ? (
        <Alert severity="warning">
          Nothing is sent until this site asks visitors about advertising. Turn on the advertising question in Cookie
          consent on the Tracking tab; until a visitor allows advertising, no browser tag loads and no server event is
          sent for them.
        </Alert>
      ) : null}
      {AD_PROVIDER_IDS.map((provider) => (
        <ProviderCard
          key={provider}
          api={api}
          provider={provider}
          available={state.available}
          tagId={state.setup?.tagIds?.[provider] ?? null}
          connection={state.connections.find((entry) => entry.provider === provider) ?? null}
          onChange={(connection) => replace(provider, connection)}
        />
      ))}
    </Stack>
  )
}
AdConversionsCard.displayName = 'AdConversionsCard'

function ProviderCard(props: {
  api: AdConversionsApi
  provider: AdProviderId
  available: boolean
  tagId: string | null
  connection: AdConnectionView | null
  onChange: (connection: AdConnectionView | null) => void
}) {
  const { api, provider, available, tagId, connection, onChange } = props
  const info = AD_PROVIDERS[provider]
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [token, setToken] = useState('')
  const [adAccountId, setAdAccountId] = useState(connection?.adAccountId ?? '')
  const [testCode, setTestCode] = useState(connection?.testEventCode ?? '')

  useEffect(() => {
    setAdAccountId(connection?.adAccountId ?? '')
    setTestCode(connection?.testEventCode ?? '')
  }, [connection?.adAccountId, connection?.testEventCode])

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

  const needsTag = info.needsTagId && !tagId
  const usesCode = 'codeLabel' in info.testEvents

  const connect = () =>
    run(async () => {
      const next = await api.connect(provider, {
        accessToken: token.trim(),
        ...(info.adAccount ? { adAccountId: adAccountId.trim() || null } : {}),
        ...(usesCode && testCode.trim() ? { testEventCode: testCode.trim() } : {}),
      })
      setToken('')
      setConnecting(false)
      onChange(next)
      return `${info.label} ${info.api} is connected.`
    })

  const disconnect = async () => {
    const accepted = await confirm({
      title: `Disconnect the ${info.label} ${info.api}?`,
      description:
        'No more server events are sent, and the stored access token and any events not yet sent are deleted. ' +
        `Your ${info.tag} on the site is not affected; remove it on the Tracking tab.`,
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
      return `${info.label} ${info.api} is disconnected.`
    })
  }

  const actions = connection ? (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <StatusChip label={STATUS[connection.status].label} tone={STATUS[connection.status].tone} />
      {connection.status !== 'reconnect' ? (
        <Button size="small" disabled={busy} onClick={() => run(async () => {
          onChange(await api.update(provider, { paused: connection.status === 'active' }))
          return null
        })}>
          {connection.status === 'active' ? 'Pause' : 'Resume'}
        </Button>
      ) : null}
      {available && !connecting ? (
        <Button size="small" disabled={busy} onClick={() => setConnecting(true)}>
          {connection.status === 'reconnect' ? 'Connect again' : 'Replace token'}
        </Button>
      ) : null}
      <Button size="small" color="error" disabled={busy} onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </Stack>
  ) : available && !connecting ? (
    <Button size="small" variant="contained" disabled={busy || needsTag} onClick={() => setConnecting(true)}>
      Connect
    </Button>
  ) : null

  return (
    <CardDisplay
      variant="outlined"
      header={`${info.label} ${info.api}`}
      subheader={`Server-side purchases and leads, paired with your ${info.tag} so each is counted once.`}
      help={help(
        `Send purchases and leads to ${info.label} from the server, for visitors who allowed advertising, so ad blockers and closed tabs do not lose them.`,
        '#conversions-api',
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
        {needsTag ? (
          <Typography variant="body2" color="text.secondary">
            {`Add your ${info.tag} ID on the Tracking tab first: server events go to that ${info.tag.toLowerCase()} and are paired with what it sends from the browser.`}
          </Typography>
        ) : null}
        {connecting ? (
          <Stack spacing={1.5}>
            <TextField
              size="small"
              type="password"
              label="Access token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              helperText={`${info.tokenHelp} Stored encrypted; it is never shown again.`}
            />
            {info.adAccount ? (
              <TextField
                size="small"
                label={info.adAccount.label}
                value={adAccountId}
                onChange={(event) => setAdAccountId(event.target.value)}
                helperText={info.adAccount.help}
                sx={{ maxWidth: 360 }}
              />
            ) : null}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                disabled={busy || !token.trim() || (Boolean(info.adAccount) && !adAccountId.trim())}
                onClick={connect}
              >
                {busy ? 'Saving…' : 'Save and connect'}
              </Button>
              <Button size="small" disabled={busy} onClick={() => setConnecting(false)}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        ) : null}
        {connection ? (
          <ConnectionDetails
            connection={connection}
            busy={busy}
            usesCode={usesCode}
            testHelp={info.testEvents.help}
            codeLabel={'codeLabel' in info.testEvents ? info.testEvents.codeLabel : null}
            testCode={testCode}
            onTestCode={setTestCode}
            onSaveTestCode={() =>
              run(async () => {
                onChange(await api.update(provider, { testEventCode: testCode.trim() || null }))
                return 'Saved.'
              })
            }
            onSendTest={() =>
              run(async () => {
                onChange(await api.testEvent(provider))
                return `A test Purchase was sent. Look for it in ${info.label}’s test events.`
              })
            }
          />
        ) : !connecting && !needsTag ? (
          <Typography variant="body2" color="text.secondary">
            {available
              ? `Not connected. Your ${info.tag} still reports from the browser for visitors who allow advertising.`
              : 'This deployment cannot store access tokens yet.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

function ConnectionDetails(props: {
  connection: AdConnectionView
  busy: boolean
  usesCode: boolean
  codeLabel: string | null
  testHelp: string
  testCode: string
  onTestCode: (value: string) => void
  onSaveTestCode: () => void
  onSendTest: () => void
}) {
  const { connection, busy } = props
  const canTest = connection.status === 'active' && (!props.usesCode || Boolean(connection.testEventCode))
  return (
    <Stack spacing={1.5}>
      {connection.status === 'reconnect' && connection.lastError ? (
        <Alert severity="error">{connection.lastError}</Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {`Last event sent: ${
          connection.lastSentAtMs
            ? `${connection.lastSentEvent ?? 'Event'}${connection.lastSentTest ? ' (test)' : ''}, ${formatTime(connection.lastSentAtMs)}`
            : 'Not yet'
        } · ${connection.totals.sent} sent`}
      </Typography>
      <Typography variant="body2" color={connection.lastFailedAtMs ? 'error' : 'text.secondary'}>
        {connection.lastFailedAtMs
          ? `Last failure: ${formatTime(connection.lastFailedAtMs)} — ${connection.lastError ?? 'refused'} · ${connection.totals.failed} failed`
          : 'No failures.'}
      </Typography>
      {connection.adAccountId ? (
        <Typography variant="body2" color="text.secondary">{`Ad account: ${connection.adAccountId}`}</Typography>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
        {props.usesCode && props.codeLabel ? (
          <>
            <TextField
              size="small"
              label={props.codeLabel}
              value={props.testCode}
              disabled={busy}
              onChange={(event) => props.onTestCode(event.target.value)}
              helperText={props.testHelp}
              sx={{ maxWidth: 360 }}
            />
            {props.testCode.trim() !== (connection.testEventCode ?? '') ? (
              <Button size="small" disabled={busy} onClick={props.onSaveTestCode}>
                Save code
              </Button>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {props.testHelp}
          </Typography>
        )}
        <Button size="small" variant="outlined" disabled={busy || !canTest} onClick={props.onSendTest}>
          Send test event
        </Button>
      </Stack>
    </Stack>
  )
}

export default AdConversionsCard
