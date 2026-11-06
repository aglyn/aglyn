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
import { PlanUpsellNotice } from '@aglyn/shared-ui-jsx/components/plan-upsell-notice.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useSiteKeys } from '@aglyn/tenant-feature-instance/hooks/use-site-keys'
import { Alert, Button, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  PluginConnectionRouteError,
  usePluginConnectionsApi,
  type PluginConnectionsApi,
  type PluginConnectionsStatusAnswer,
} from '../hooks/use-plugin-connections-api'
import {
  declaredPluginConnections,
  declaredSyncIntervalHours,
  formatConnectionTime,
  nextResourceToChoose,
  PLUGIN_CONNECTION_PHASE_CHIP,
  PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT,
  pluginConnectionNextSyncAtMs,
  pluginConnectionNotSetUpText,
  pluginConnectionPhase,
  pluginConnectionResultMessage,
  pluginConnectionSharesText,
  pluginConnectionSyncFailedText,
  pluginConnectionTooSoonText,
  readPluginConnectionReturn,
  type PluginConnectionCardView,
} from '../model/plugin-connection-card'
import {
  PLUGIN_CONNECTIONS_PLAN_REFUSAL,
  PLUGIN_CONNECTIONS_SITE_PERMISSION,
  PLUGIN_CONNECTIONS_SITE_ROLE_PRESET,
  pluginConnectionsPermissionRefusal,
  type PluginConnectionStatusEntry,
} from '../model/plugin-connections'

/**
 * What the `sitePluginConnections` zone hands each widget: the site's page
 * for one installed plugin, and the pin whose manifest it runs.
 */
export interface SitePluginConnectionsCardProps {
  hostId: string
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /** The installation's id: the listing the pin is keyed by. */
  pluginRef: string
  /** The site's pin of the listing (else the workspace's): its version and manifest. */
  pin: Readonly<Record<string, unknown>> | null | undefined
  /** Test seam: the routes. The signed-in member's by default. */
  api?: PluginConnectionsApi
  /** Test seam: sends the browser to the provider's consent page. */
  navigate?: (url: string) => void
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; refused: boolean }
  | { status: 'ready'; answer: PluginConnectionsStatusAnswer }

const leavePage = (url: string) => window.location.assign(url)

const HELP = pluginDocsHelp('installYourFirstPlugin', {
  anchor: '#plugin-connections',
  excerpt:
    'Some plugins show information from another service, such as your business listing. Connect it once and the plugin keeps it up to date on its own.',
})

/**
 * THE SITE'S CONNECTIONS FOR ONE INSTALLED PLUGIN (AGL-4196).
 *
 * A marketplace plugin may declare connections in its manifest: an account at
 * another service the platform signs in to, the things the owner picks there
 * (an account, then one of its locations), and a scheduled sync. The
 * platform runs all of it, so this card is the same for every plugin: one
 * card per declared connection, drawn from the pinned manifest and the
 * status route.
 *
 * Every prerequisite stays on screen: a plan without connections, a
 * publisher who has not set the connection up, a deployment that cannot run
 * them yet and a member without the site key each keep the card, with its
 * controls off and the reason said.
 */
export function SitePluginConnectionsCard(props: SitePluginConnectionsCardProps) {
  const { hostId, orgSlug, pluginRef, pin } = props
  const routes = usePluginConnectionsApi(hostId)
  const api = props.api ?? routes
  const navigate = props.navigate ?? leavePage
  const { enqueueSnackbar } = useSnackbar()
  const { blocked } = useSiteKeys(hostId)
  const declared = declaredPluginConnections(pin?.['manifest'])
  const hasDeclared = declared.length > 0
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const returned = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setLoad({ status: 'ready', answer: await api.status(pluginRef) })
    } catch (error) {
      const refusal = error instanceof PluginConnectionRouteError ? error : null
      setLoad({
        status: 'error',
        message: refusal?.message ?? 'The connections could not be read. Try again.',
        refused: refusal?.reason === 'permission',
      })
    }
  }, [api, pluginRef])

  useEffect(() => {
    if (!hasDeclared || !hostId) return
    if (!returned.current && typeof window !== 'undefined') {
      returned.current = true
      const back = readPluginConnectionReturn(window.location.href, pluginRef)
      if (back) {
        window.history.replaceState(window.history.state, '', back.cleanUrl)
        const label = declared.find((one) => one.id === back.connectionId)?.label ?? 'The service'
        const { variant, message } = pluginConnectionResultMessage(back.result, label)
        enqueueSnackbar(message, { variant })
      }
    }
    void refresh()
    // `declared` is re-derived each render from the same pin; its ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDeclared, hostId, pluginRef, refresh])

  if (!hasDeclared) return null

  const keyRefused = blocked(PLUGIN_CONNECTIONS_SITE_PERMISSION, PLUGIN_CONNECTIONS_SITE_ROLE_PRESET)
  const permissionText = pluginConnectionsPermissionRefusal(PLUGIN_CONNECTIONS_SITE_PERMISSION)

  if (keyRefused || (load.status === 'error' && load.refused)) {
    return (
      <Stack spacing={3}>
        {declared.map((connection) => (
          <CardDisplay
            key={connection.id}
            header={connection.label}
            subheader={connection.description}
            help={HELP}
            contentGutterX
            contentGutterY
            HeaderProps={{
              action: (
                <BlockedControl blocked reason={permissionText}>
                  <Button variant="contained">{'Connect'}</Button>
                </BlockedControl>
              ),
            }}
          >
            <Alert severity="info">{permissionText}</Alert>
          </CardDisplay>
        ))}
      </Stack>
    )
  }

  if (load.status !== 'ready') {
    return (
      <Stack spacing={3}>
        {declared.map((connection) => (
          <CardDisplay
            key={connection.id}
            header={connection.label}
            subheader={connection.description}
            help={HELP}
            contentGutterX
            contentGutterY
            HeaderProps={
              load.status === 'error'
                ? {
                    action: (
                      <Button variant="outlined" onClick={() => void refresh()}>
                        {'Try again'}
                      </Button>
                    ),
                  }
                : undefined
            }
          >
            {load.status === 'error' ? (
              <Alert severity="error">{load.message}</Alert>
            ) : (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  {'Checking the connection…'}
                </Typography>
              </Stack>
            )}
          </CardDisplay>
        ))}
      </Stack>
    )
  }

  const { answer } = load
  const replace = (entry: PluginConnectionStatusEntry, connection: PluginConnectionCardView | null) =>
    setLoad({
      status: 'ready',
      answer: {
        ...answer,
        connections: answer.connections.map((one) =>
          one.listingId === entry.listingId && one.connectionId === entry.connectionId ? { ...one, connection } : one,
        ),
      },
    })

  return (
    <Stack spacing={3}>
      {answer.connections.map((entry) => (
        <SitePluginConnection
          key={`${entry.listingId}/${entry.connectionId}`}
          entry={entry}
          configured={answer.configured}
          planAllows={answer.planAllows && entry.planAllows}
          upgradeHref={orgSlug ? `/${orgSlug}/billing#plans` : undefined}
          pluginName={String(pin?.['displayName'] ?? '') || 'this plugin'}
          intervalHours={declaredSyncIntervalHours(pin?.['manifest'], entry.connectionId)}
          api={api}
          navigate={navigate}
          onConnection={(connection) => replace(entry, connection)}
          onStale={refresh}
        />
      ))}
    </Stack>
  )
}
SitePluginConnectionsCard.displayName = 'SitePluginConnectionsCard'

export default SitePluginConnectionsCard

type Busy = 'connect' | 'sync' | 'choose' | 'disconnect' | null

interface SitePluginConnectionProps {
  entry: PluginConnectionStatusEntry
  configured: boolean
  planAllows: boolean
  upgradeHref: string | undefined
  pluginName: string
  intervalHours: number | null
  api: PluginConnectionsApi
  navigate: (url: string) => void
  onConnection: (connection: PluginConnectionCardView | null) => void
  onStale: () => Promise<void>
}

type Items =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: Array<{ id: string; label: string }> }

/** One declared connection on the site: its state, what was chosen, and what can be done next. */
function SitePluginConnection(props: SitePluginConnectionProps) {
  const { entry, configured, planAllows, upgradeHref, pluginName, intervalHours, api, navigate, onConnection, onStale } =
    props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState<string | null>(null)
  const [changing, setChanging] = useState<number | null>(null)
  const [items, setItems] = useState<Items>({ status: 'idle' })
  const [picked, setPicked] = useState('')
  const phase = pluginConnectionPhase(entry, configured)
  // A pinned version that declares no sync has nothing for Sync now to run, and no sync times to show.
  const declaresSync = intervalHours !== null
  const view = entry.connection as PluginConnectionCardView | null
  const label = entry.label
  const ids = { listingId: entry.listingId, connectionId: entry.connectionId }

  const resource = changing !== null ? (entry.resources[changing] ?? null) : phase === 'choosing' ? nextResourceToChoose(entry) : null
  const resourceId = resource?.id ?? ''
  const currentChoice = resourceId ? (view?.choices[resourceId]?.id ?? '') : ''

  useEffect(() => {
    if (!resourceId || !planAllows) {
      setItems({ status: 'idle' })
      return
    }
    let live = true
    setItems({ status: 'loading' })
    setPicked(currentChoice)
    api
      .resources({ ...ids, resource: resourceId })
      .then((answer) => {
        if (!live) return
        setItems({ status: 'ready', items: answer.items })
        setPicked((was) => was || (answer.items.length === 1 ? answer.items[0].id : ''))
      })
      .catch((failure: unknown) => {
        if (!live) return
        setItems({ status: 'error', message: failure instanceof Error ? failure.message : String(failure) })
        if (failure instanceof PluginConnectionRouteError && failure.reason === 'reconnect') void onStale()
      })
    return () => {
      live = false
    }
    // The connection's ids and the resource are the request; the rest is display.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, entry.listingId, entry.connectionId, resourceId, planAllows])

  const run = async (kind: NonNullable<Busy>, work: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    setWait(null)
    try {
      await work()
    } catch (failure) {
      if (failure instanceof PluginConnectionRouteError && failure.reason === 'too-soon') {
        // Not a failure: the last sync is under a minute old. Say how long, and show what it brought.
        const retryAfterMs = Number(failure.body['retryAfterMs'])
        setWait(pluginConnectionTooSoonText(label, Number.isFinite(retryAfterMs) ? retryAfterMs : null))
        const connection = failure.body['connection'] as PluginConnectionCardView | undefined
        if (connection && typeof connection === 'object') onConnection(connection)
        return
      }
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      if (
        failure instanceof PluginConnectionRouteError &&
        (failure.reason === 'reconnect' || failure.reason === 'not-connected' || failure.reason === 'choose-first')
      ) {
        void onStale()
      }
    } finally {
      setBusy(null)
    }
  }

  const connect = () =>
    run('connect', async () => {
      const { authorizeUrl } = await api.connectStart({ ...ids, returnTo: window.location.href })
      navigate(authorizeUrl)
    })

  const choose = () =>
    run('choose', async () => {
      if (!resource || !picked) return
      const { connection } = await api.choose({ ...ids, resource: resource.id, id: picked })
      onConnection(connection)
      if (changing !== null) {
        const next = changing + 1
        setChanging(next < entry.resources.length ? next : null)
      }
      if (connection?.ready) enqueueSnackbar(`${label} is set up. It syncs on its own from now on.`, { variant: 'success' })
    })

  const sync = () =>
    run('sync', async () => {
      const { connection, synced } = await api.sync(ids)
      onConnection(connection)
      enqueueSnackbar(synced ? `${label} is up to date.` : `${label} did not sync. See why below.`, {
        variant: synced ? 'success' : 'warning',
      })
    })

  const disconnect = async () => {
    const ok = await Promise.resolve(
      confirm({
        title: `Disconnect ${label}?`,
        description: `${pluginName} stops receiving updates from ${label} on this site, and what it last brought in is removed from the site. You can connect again at any time.`,
        confirmationText: 'Disconnect',
        confirmationButtonProps: { color: 'warning', variant: 'contained' },
      }),
    )
      .then(() => true)
      .catch(() => false)
    if (!ok) return
    await run('disconnect', async () => {
      await api.disconnect(ids)
      setChanging(null)
      onConnection(null)
      enqueueSnackbar(`${label} is disconnected.`, { variant: 'success' })
    })
  }

  const planReason = PLUGIN_CONNECTIONS_PLAN_REFUSAL
  const blockedBy =
    phase === 'not-configured'
      ? PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT
      : phase === 'not-set-up'
        ? pluginConnectionNotSetUpText(label)
        : !planAllows
          ? planReason
          : null

  const guarded = (reason: string | null, control: ReactElement<{ disabled?: boolean }>) => (
    <BlockedControl blocked={Boolean(reason)} reason={reason ?? ''}>
      {control}
    </BlockedControl>
  )

  const disconnectButton = (
    <Button color="warning" disabled={busy !== null} onClick={() => void disconnect()}>
      {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
    </Button>
  )

  const actions: ReactElement[] = []
  if (resource) {
    actions.push(
      guarded(
        !planAllows ? planReason : null,
        <Button key="use" variant="contained" disabled={busy !== null || !picked || items.status !== 'ready'} onClick={() => void choose()}>
          {busy === 'choose' ? 'Saving…' : `Use this ${resource.label.toLowerCase()}`}
        </Button>,
      ),
    )
    if (changing !== null) {
      actions.push(
        <Button key="cancel" color="inherit" disabled={busy !== null} onClick={() => setChanging(null)}>
          {'Cancel'}
        </Button>,
      )
    }
    actions.push(disconnectButton)
  } else if (phase === 'not-configured' || phase === 'not-set-up' || phase === 'not-connected') {
    actions.push(
      guarded(
        blockedBy,
        <Button key="connect" variant="contained" disabled={busy !== null} onClick={() => void connect()}>
          {busy === 'connect' ? 'Opening…' : 'Connect'}
        </Button>,
      ),
    )
  } else if (phase === 'reconnect') {
    actions.push(
      guarded(
        !planAllows ? planReason : !entry.credentialsSet ? pluginConnectionNotSetUpText(label) : null,
        <Button key="reconnect" variant="contained" disabled={busy !== null} onClick={() => void connect()}>
          {busy === 'connect' ? 'Opening…' : 'Reconnect'}
        </Button>,
      ),
    )
    actions.push(disconnectButton)
  } else {
    if (declaresSync) {
      actions.push(
        guarded(
          !planAllows ? planReason : null,
          <Button key="sync" variant={phase === 'error' ? 'contained' : 'outlined'} disabled={busy !== null} onClick={() => void sync()}>
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </Button>,
        ),
      )
    }
    if (entry.resources.length) {
      actions.push(
        guarded(
          !planAllows ? planReason : null,
          <Button key="change" variant="outlined" disabled={busy !== null} onClick={() => setChanging(0)}>
            {'Change'}
          </Button>,
        ),
      )
    }
    actions.push(disconnectButton)
  }

  const chip = PLUGIN_CONNECTION_PHASE_CHIP[phase]
  const shares = pluginConnectionSharesText(entry.hosts)
  // A plan without connections is never run by the scheduled sync, so it has no next one to show.
  const nextSync = planAllows ? pluginConnectionNextSyncAtMs(view, intervalHours) : null
  const chosen = entry.resources.filter((one) => view?.choices[one.id])

  return (
    <CardDisplay
      header={label}
      subheader={entry.description}
      help={HELP}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {actions.map((action, index) => (
              <span key={index}>{action}</span>
            ))}
          </Stack>
        ),
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1}>
          <StatusChip label={chip.label} tone={chip.tone} data-testid="plugin-connection-status" />
        </Stack>

        {phase === 'not-configured' ? <Alert severity="info">{PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT}</Alert> : null}
        {phase === 'not-set-up' ? <PrerequisiteNotice>{pluginConnectionNotSetUpText(label)}</PrerequisiteNotice> : null}
        {!planAllows && phase !== 'not-configured' && phase !== 'not-set-up' ? (
          <PlanUpsellNotice planLabel={undefined} upgradeHref={upgradeHref}>
            {view ? `${planReason} You can still disconnect it.` : planReason}
          </PlanUpsellNotice>
        ) : null}

        {phase === 'not-connected' ? (
          <Typography variant="body2" color="text.secondary">
            {`Connect ${label} so ${pluginName} can use it on this site. You sign in at ${label} and choose what to share; this site never sees your password.`}
          </Typography>
        ) : null}

        {phase === 'reconnect' ? (
          <Alert severity="warning">
            {`${label} no longer accepts this connection. Nothing syncs until you reconnect.`}
          </Alert>
        ) : null}

        {phase === 'error' ? (
          <Alert severity="error">{pluginConnectionSyncFailedText(view?.lastError)}</Alert>
        ) : null}

        {resource ? (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {changing === null
                ? `Choose the ${resource.label.toLowerCase()} ${pluginName} should use. Nothing syncs until you do.`
                : `Choose the ${resource.label.toLowerCase()} ${pluginName} should use.`}
            </Typography>
            {items.status === 'loading' ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  {`Asking ${label}…`}
                </Typography>
              </Stack>
            ) : null}
            {items.status === 'error' ? <Alert severity="error">{items.message}</Alert> : null}
            {items.status === 'ready' && !items.items.length ? (
              <Alert severity="info">
                {`The ${label} account you connected has nothing to choose here. Connect a different account, or add one at ${label} first.`}
              </Alert>
            ) : null}
            {items.status === 'ready' && items.items.length ? (
              <TextField
                select
                size="small"
                label={resource.label}
                value={picked}
                disabled={busy !== null || !planAllows}
                onChange={(event) => setPicked(event.target.value)}
                sx={{ maxWidth: 480 }}
              >
                {items.items.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
        ) : null}

        {view && chosen.length && changing === null ? (
          <Stack spacing={0.5}>
            {chosen.map((one) => (
              <Typography key={one.id} variant="body2">
                <Typography component="span" variant="body2" color="text.secondary">
                  {`${one.label}: `}
                </Typography>
                {view.choices[one.id]?.label}
              </Typography>
            ))}
          </Stack>
        ) : null}

        {view && declaresSync && (phase === 'connected' || phase === 'error') ? (
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {view.lastSyncAtMs !== null ? `Last synced ${formatConnectionTime(view.lastSyncAtMs)}` : 'Not synced yet'}
            </Typography>
            {nextSync !== null ? (
              <Typography variant="body2" color="text.secondary">
                {nextSync === 'soon' ? 'Next sync: within the hour' : `Next sync ${formatConnectionTime(nextSync)}`}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {shares ? (
          <Typography variant="caption" color="text.secondary">
            {shares}
          </Typography>
        ) : null}

        {wait ? (
          <Alert severity="info" onClose={() => setWait(null)}>
            {wait}
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
