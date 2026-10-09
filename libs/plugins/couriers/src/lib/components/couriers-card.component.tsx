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
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { CourierConnectionView, CourierKeyMode, CourierKeysView, CourierProviderId } from '../model/couriers'
import {
  forgetCourierConnection,
  useCouriersApi,
  type CourierConnectionAnswer,
  type CourierKeysInput,
  type CouriersApi,
} from './couriers-api'

/**
 * What commerce's `commerceSettings` zone hands a widget, restated here
 * because a plugin never imports another (AGL-3695): the site.
 */
export interface CouriersCardProps {
  hostId: string
  orgId?: string
  /** Test seam: the API; the routes by default. */
  api?: CouriersApi
}

const EMPTY_KEYS: CourierKeysInput = { developerId: '', keyId: '', signingSecret: '' }

function MoneyNote(props: { label: string }) {
  return (
    <Alert severity="info">
      {`${props.label} charges each courier to your own ${props.label} account. ${PLATFORM_BRAND_NAME} doesn’t charge, collect or mark up the courier’s fee; your buyers pay your delivery zone’s fee, as they do now.`}
    </Alert>
  )
}

function KeyFields(props: {
  mode: CourierKeyMode
  value: CourierKeysInput
  onChange: (value: CourierKeysInput) => void
  disabled: boolean
}) {
  const { mode, value, onChange, disabled } = props
  const set = (patch: Partial<CourierKeysInput>) => onChange({ ...value, ...patch })
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{mode === 'live' ? 'Live key' : 'Test key (sandbox)'}</Typography>
      <TextField
        label="Developer ID"
        size="small"
        value={value.developerId}
        disabled={disabled}
        onChange={(event) => set({ developerId: event.target.value })}
        autoComplete="off"
      />
      <TextField
        label="Key ID"
        size="small"
        value={value.keyId}
        disabled={disabled}
        onChange={(event) => set({ keyId: event.target.value })}
        autoComplete="off"
      />
      <TextField
        label="Signing secret"
        size="small"
        type="password"
        value={value.signingSecret}
        disabled={disabled}
        onChange={(event) => set({ signingSecret: event.target.value })}
        autoComplete="new-password"
      />
    </Stack>
  )
}

const filled = (keys: CourierKeysInput) => Boolean(keys.developerId || keys.keyId || keys.signingSecret)

function keysChip(view: CourierKeysView, mode: CourierKeyMode) {
  const name = mode === 'live' ? 'Live' : 'Test'
  if (!view.configured) return <StatusChip label={`${name}: not added`} tone="neutral" variant="outlined" />
  return view.lastTestOk ? (
    <StatusChip label={`${name}: connected`} tone="success" />
  ) : (
    <StatusChip label={`${name}: refused`} tone="error" />
  )
}

/**
 * The Couriers card (AGL-3695), under the store's Settings: connect the
 * merchant's own DoorDash Drive developer keys — live, test or both — set the
 * phone and note every courier gets at the store, and copy the webhook
 * DoorDash reports progress to. Draws nothing when the deployment or the site
 * does not offer couriers.
 */
export function CouriersCard(props: CouriersCardProps) {
  const { hostId } = props
  const routes = useCouriersApi(hostId)
  const api = props.api ?? routes
  const [answer, setAnswer] = useState<CourierConnectionAnswer | null>(null)
  const [webhookToken, setWebhookToken] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .connection()
      .then((value) => {
        if (live) setAnswer(value)
      })
      .catch(() => {
        if (live) setAnswer({ available: false, providers: [], connection: null })
      })
    return () => {
      live = false
    }
  }, [api])

  const replace = useCallback(
    (connection: CourierConnectionView | null, token?: string | null) => {
      forgetCourierConnection(hostId)
      setAnswer((current) => (current ? { ...current, connection } : current))
      if (token !== undefined) setWebhookToken(token)
    },
    [hostId],
  )

  if (!answer?.available) return null
  const provider = answer.providers[0]
  if (!provider) return null
  return answer.connection ? (
    <ConnectedCard
      api={api}
      connection={answer.connection}
      webhookToken={webhookToken}
      onChange={replace}
    />
  ) : (
    <ConnectCard api={api} provider={provider} onConnected={replace} />
  )
}

function ConnectCard(props: {
  api: CouriersApi
  provider: CourierConnectionAnswer['providers'][number]
  onConnected: (connection: CourierConnectionView, token: string | null) => void
}) {
  const { api, provider, onConnected } = props
  const { enqueueSnackbar } = useSnackbar()
  const [liveKeys, setLiveKeys] = useState<CourierKeysInput>(EMPTY_KEYS)
  const [testKeys, setTestKeys] = useState<CourierKeysInput>(EMPTY_KEYS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = async () => {
    setBusy(true)
    setError(null)
    try {
      const answer = await api.connect(provider.id, {
        ...(filled(liveKeys) ? { live: liveKeys } : {}),
        ...(filled(testKeys) ? { test: testKeys } : {}),
      })
      enqueueSnackbar(`${provider.label} connected`, { variant: 'success', persist: false })
      onConnected(answer.connection, answer.webhookToken)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      variant="outlined"
      header="Couriers"
      subheader={`Send a ${provider.label} courier for your local deliveries, from your own ${provider.product} account.`}
      help={pluginDocsHelp('couriers', { anchor: '#connect-doordash-drive' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <MoneyNote label={provider.label} />
        <Typography variant="body2" color="text.secondary">
          {'Create a key in your '}
          <Link href={provider.portal} target="_blank" rel="noopener noreferrer">
            {`${provider.product} developer portal`}
          </Link>
          {'. Add your test key to try it on test orders, your live key to send real couriers, or both.'}
        </Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <KeyFields mode="live" value={liveKeys} onChange={setLiveKeys} disabled={busy} />
        <KeyFields mode="test" value={testKeys} onChange={setTestKeys} disabled={busy} />
        <Stack direction="row">
          <Button
            variant="contained"
            disabled={busy || (!filled(liveKeys) && !filled(testKeys))}
            onClick={() => void handleConnect()}
          >
            {`Connect ${provider.label}`}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

function ConnectedCard(props: {
  api: CouriersApi
  connection: CourierConnectionView
  webhookToken: string | null
  onChange: (connection: CourierConnectionView | null, token?: string | null) => void
}) {
  const { api, connection, webhookToken, onChange } = props
  const provider: CourierProviderId = connection.provider
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickupPhone, setPickupPhone] = useState(connection.pickupPhone ?? '')
  const [pickupNote, setPickupNote] = useState(connection.pickupNote ?? '')
  const [addKeys, setAddKeys] = useState<CourierKeyMode | null>(null)
  const [keys, setKeys] = useState<CourierKeysInput>(EMPTY_KEYS)

  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleTest = () =>
    act(async () => {
      const next = await api.test(provider)
      onChange(next)
      const ok = (!next.live.configured || next.live.lastTestOk) && (!next.test.configured || next.test.lastTestOk)
      enqueueSnackbar(ok ? `${connection.providerLabel} accepted your keys` : `${connection.providerLabel} refused a key`, {
        variant: ok ? 'success' : 'error',
        persist: false,
      })
    })

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: `Disconnect ${connection.providerLabel}?`,
      description: `Your keys are forgotten, and no courier can be sent until you connect again.`,
      confirmationText: 'Disconnect',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await act(async () => {
      await api.disconnect(provider)
      onChange(null, null)
    })
  }

  const handleSave = () =>
    act(async () => {
      onChange(await api.settings(provider, { pickupPhone, pickupNote }))
      enqueueSnackbar('Saved', { variant: 'success', persist: false })
    })

  const handleNewToken = () =>
    act(async () => {
      const answer = await api.webhookToken(provider)
      onChange(answer.connection, answer.webhookToken)
    })

  const handleAddKeys = (mode: CourierKeyMode) =>
    act(async () => {
      const answer = await api.connect(provider, { [mode]: keys })
      onChange(answer.connection, answer.webhookToken ?? webhookToken)
      setAddKeys(null)
      setKeys(EMPTY_KEYS)
    })

  return (
    <CardDisplay
      variant="outlined"
      header="Couriers"
      subheader={`${connection.providerLabel} Drive, from your own account.`}
      help={pluginDocsHelp('couriers', { anchor: '#connect-doordash-drive' })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" disabled={busy} onClick={() => void handleTest()}>
              {'Test'}
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={() => void handleDisconnect()}>
              {'Disconnect'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {keysChip(connection.live, 'live')}
          {keysChip(connection.test, 'test')}
        </Stack>
        {[connection.live.lastError, connection.test.lastError].filter(Boolean).map((message) => (
          <Alert key={message} severity="error">
            {message}
          </Alert>
        ))}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <MoneyNote label={connection.providerLabel} />

        {addKeys ? (
          <Stack spacing={1}>
            <KeyFields mode={addKeys} value={keys} onChange={setKeys} disabled={busy} />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" size="small" disabled={busy || !filled(keys)} onClick={() => void handleAddKeys(addKeys)}>
                {'Save key'}
              </Button>
              <Button size="small" disabled={busy} onClick={() => setAddKeys(null)}>
                {'Cancel'}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button size="small" disabled={busy} onClick={() => setAddKeys('live')}>
              {connection.live.configured ? 'Replace live key' : 'Add live key'}
            </Button>
            <Button size="small" disabled={busy} onClick={() => setAddKeys('test')}>
              {connection.test.configured ? 'Replace test key' : 'Add test key'}
            </Button>
          </Stack>
        )}

        <Divider />
        <Typography variant="subtitle2">{'At the store'}</Typography>
        <TextField
          label="Store phone for couriers"
          helperText="Used when the location deliveries leave from has no phone number."
          size="small"
          value={pickupPhone}
          disabled={busy}
          onChange={(event) => setPickupPhone(event.target.value)}
        />
        <TextField
          label="Note for every courier"
          placeholder="Ask at the counter for the order number"
          size="small"
          value={pickupNote}
          disabled={busy}
          onChange={(event) => setPickupNote(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 280 } }}
        />
        <Stack direction="row">
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void handleSave()}>
            {'Save'}
          </Button>
        </Stack>

        <Divider />
        <Typography variant="subtitle2">{'Delivery updates'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {`In your ${connection.providerLabel} developer portal, add a webhook with this address, Authorization type Basic, and the token below. Without it, a courier’s progress reaches your orders on the next check, every 15 minutes.`}
        </Typography>
        <TextField
          label="Webhook address"
          size="small"
          value={connection.webhookUrl ?? ''}
          slotProps={{ htmlInput: { readOnly: true } }}
        />
        {webhookToken ? (
          <TextField
            label="Webhook token — shown once"
            size="small"
            value={webhookToken}
            slotProps={{ htmlInput: { readOnly: true } }}
          />
        ) : null}
        <Stack direction="row">
          <Button size="small" disabled={busy} onClick={() => void handleNewToken()}>
            {connection.webhookTokenSet ? 'New webhook token' : 'Create webhook token'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

export default CouriersCard
