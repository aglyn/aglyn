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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { CopyField } from '@aglyn/shared-ui-jsx/components/copy-field.component'
import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'

export interface ShippingEasyCardProps {
  hostId: string
}

/** What the connectors route answers about a ShippingEasy connection. */
interface ConnectionStatus {
  /** Whether this deployment can keep an API secret at all. */
  available?: boolean
  connected: boolean
  apiKeyEnding?: string
  storeApiKeyEnding?: string
  createdAtMs?: number
  updatedAtMs?: number
  lastPushAtMs?: number
  lastCallbackAtMs?: number
  lastError?: { message: string; atMs: number; orderNumber?: string } | null
  sync?: { sent: number; already: number; failed: number; more: boolean }
}

/** The address ShippingEasy posts shipments to: this console's own origin, never a guess. */
export function shippingEasyCallbackUrl(hostId: string, origin?: string): string {
  const base = origin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}/api/commerce/shippingeasy/${encodeURIComponent(hostId)}`
}

/** What one "Send open orders" did, in a sentence. */
export function describeShippingEasySync(sync: NonNullable<ConnectionStatus['sync']>): string {
  const parts: string[] = []
  parts.push(sync.sent === 1 ? '1 order sent to ShippingEasy' : `${sync.sent} orders sent to ShippingEasy`)
  if (sync.already) parts.push(`${sync.already} already there`)
  if (sync.failed) parts.push(`${sync.failed} not sent`)
  return `${parts.join(', ')}.${sync.more ? ' More open orders are waiting: select Send open orders again.' : ''}`
}

const when = (ms: number | undefined): string =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet'

/** One fixed fact of the connection: a label and its value. */
function FactRow(props: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell component="th" scope="row">
        {props.label}
      </TableCell>
      <TableCell>{props.value}</TableCell>
    </TableRow>
  )
}

const EMPTY_KEYS = { apiKey: '', apiSecret: '', storeApiKey: '' }

/**
 * Connect ShippingEasy (AGL-3633): the merchant's API key, API secret and
 * store API key, from their own ShippingEasy account; the callback URL to
 * paste into the API store; send open orders; and disconnect. Paid orders go
 * to ShippingEasy as they are paid, and each label bought there marks the
 * order shipped here. The secret is sealed on the server and never shown
 * again; the card renders nothing on a deployment that cannot seal one.
 */
export function ShippingEasyCard(props: ShippingEasyCardProps) {
  const { hostId } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [keys, setKeys] = useState(EMPTY_KEYS)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const uid = user?.uid
  useEffect(() => {
    if (!uid || !user) return
    let live = true
    authorizedFetch(
      user as never,
      `/api/commerce/shipping-connectors?connector=shippingeasy&hostId=${encodeURIComponent(hostId)}`,
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!live) return
        if (!response.ok) return setLoadError(body?.error ?? 'The connection could not be read.')
        setLoadError(null)
        setStatus(body as ConnectionStatus)
      })
      .catch(() => live && setLoadError('The connection could not be read.'))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `user` changes identity every render; `uid` is what matters.
  }, [uid, hostId])

  const act = useCallback(
    async (action: 'connect' | 'sync' | 'disconnect', extra: Record<string, string> = {}): Promise<boolean> => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user as never, '/api/commerce/shipping-connectors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, connector: 'shippingeasy', action, ...extra }),
        })
        const body = (await response.json().catch(() => ({}))) as ConnectionStatus & { error?: string }
        if (!response.ok) {
          enqueueSnackbar(body?.error ?? 'That did not work. Try again.', { variant: 'error', allowDuplicate: true })
          return false
        }
        setStatus(body)
        if (action === 'disconnect') {
          enqueueSnackbar('ShippingEasy is disconnected. New orders are no longer sent to it.', { variant: 'success' })
        } else if (action === 'sync' && body.sync) {
          enqueueSnackbar(describeShippingEasySync(body.sync), { variant: body.sync.failed ? 'warning' : 'success' })
        } else if (action === 'connect') {
          enqueueSnackbar('ShippingEasy is connected. Paste the callback URL into your ShippingEasy API store.', {
            variant: 'success',
          })
        }
        return true
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  // A deployment with no secret keyring cannot keep a secret: nothing to offer.
  if (status && status.available === false && !status.connected) return null

  const connected = Boolean(status?.connected)
  const openKeys = () => {
    setKeys(EMPTY_KEYS)
    setEditing(true)
  }
  const actions = !status ? null : connected ? (
    <Stack direction="row" spacing={1}>
      <Button size="small" disabled={busy} onClick={() => void act('sync')}>
        {'Send open orders'}
      </Button>
      <Button size="small" disabled={busy} onClick={openKeys}>
        {'Change keys'}
      </Button>
      <Button size="small" color="error" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
        {'Disconnect'}
      </Button>
    </Stack>
  ) : (
    <Button size="small" variant="contained" disabled={busy} onClick={openKeys}>
      {'Connect ShippingEasy'}
    </Button>
  )

  const complete = Boolean(keys.apiKey.trim() && keys.apiSecret.trim() && keys.storeApiKey.trim())
  const save = async () => {
    if (await act('connect', keys)) {
      setEditing(false)
      setKeys(EMPTY_KEYS)
    }
  }

  return (
    <CardDisplay
      header={'ShippingEasy'}
      help={pluginDocsHelp('shippingEasy', { anchor: '#connect' })}
      HeaderProps={{ action: actions }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {loadError ? <Alert severity="error">{loadError}</Alert> : null}
        {!connected ? (
          <Typography variant="body2" color="text.secondary">
            {
              'Labeling in ShippingEasy? Connect it with the API key, API secret and store API key from your ' +
              'ShippingEasy account: each order is sent there as it is paid, and each label you buy there ' +
              'marks the order shipped here and emails your customer the tracking link. Only a site admin ' +
              'can connect it.'
            }
          </Typography>
        ) : (
          <>
            <div>
              {status?.lastError ? (
                <StatusChip label="Needs attention" tone="warning" data-testid="shippingeasy-status" />
              ) : (
                <StatusChip label="Connected" tone="success" data-testid="shippingeasy-status" />
              )}
            </div>
            {status?.lastError ? (
              <Alert severity="warning">
                {`${status.lastError.message} (${when(status.lastError.atMs)})`}
              </Alert>
            ) : null}
            <CopyField
              label="Callback URL"
              value={shippingEasyCallbackUrl(hostId)}
              helperText="Paste this into your API store's settings in ShippingEasy, so each label marks the order shipped here."
              onCopied={() => enqueueSnackbar('Callback URL copied', { variant: 'success', persist: false })}
              onCopyFailed={() => enqueueSnackbar('Select the callback URL and copy it.', { variant: 'info' })}
            />
            <ScrollTable size="small" aria-label="ShippingEasy connection">
              <TableBody>
                <FactRow label="API key" value={status?.apiKeyEnding ? `Ends in ${status.apiKeyEnding}` : ''} />
                <FactRow label="Store API key" value={status?.storeApiKeyEnding ? `Ends in ${status.storeApiKeyEnding}` : ''} />
                <FactRow label="Last order sent" value={when(status?.lastPushAtMs)} />
                <FactRow label="Last shipment received" value={when(status?.lastCallbackAtMs)} />
              </TableBody>
            </ScrollTable>
          </>
        )}
      </Stack>
      <Dialog open={editing} onClose={() => !busy && setEditing(false)} fullWidth maxWidth="sm">
        <DialogTitle>{connected ? 'Change ShippingEasy keys' : 'Connect ShippingEasy'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>
              {
                'In ShippingEasy, the API key and API secret are under Settings → API Credentials, and the ' +
                'store API key is on your API store under Settings → Stores & Orders. The secret is kept ' +
                'encrypted and is never shown again.'
              }
            </DialogContentText>
            <TextField
              label="API key"
              value={keys.apiKey}
              onChange={(event) => setKeys((current) => ({ ...current, apiKey: event.target.value }))}
              autoComplete="off"
              fullWidth
              required
            />
            <TextField
              label="API secret"
              type="password"
              value={keys.apiSecret}
              onChange={(event) => setKeys((current) => ({ ...current, apiSecret: event.target.value }))}
              autoComplete="new-password"
              fullWidth
              required
            />
            <TextField
              label="Store API key"
              value={keys.storeApiKey}
              onChange={(event) => setKeys((current) => ({ ...current, storeApiKey: event.target.value }))}
              autoComplete="off"
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setEditing(false)}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy || !complete} onClick={() => void save()}>
            {connected ? 'Save keys' : 'Connect'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)}>
        <DialogTitle>{'Disconnect ShippingEasy?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {
              'New orders stop going to ShippingEasy, and shipments it sends back are refused. Orders ' +
              'already there stay there, and orders already shipped stay shipped. The keys are deleted ' +
              `from ${PLATFORM_BRAND_NAME}.`
            }
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDisconnect(false)}>{'Cancel'}</Button>
          <Button
            color="error"
            disabled={busy}
            onClick={() => {
              setConfirmDisconnect(false)
              void act('disconnect')
            }}
          >
            {'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
ShippingEasyCard.displayName = 'ShippingEasyCard'

export default ShippingEasyCard
