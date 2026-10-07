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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
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
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { SHIPSTATION_STATUS_NAMES } from '../../model/shipstation'

export interface ShipStationCardProps {
  hostId: string
}

/** What the connectors route answers about a connection. */
interface ConnectionStatus {
  /** Whether this deployment can keep a ShipStation password at all. */
  available?: boolean
  connected: boolean
  username?: string
  createdAtMs?: number
  rotatedAtMs?: number
  lastExportAtMs?: number
  lastShipNoticeAtMs?: number
}

/** The address ShipStation calls: this console's own origin, never a guess. */
export function shipStationEndpoint(hostId: string, origin?: string): string {
  const base = origin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}/api/commerce/shipstation/${encodeURIComponent(hostId)}`
}

/** The status names to type into ShipStation's Custom Store form, in its order. */
export const SHIPSTATION_STATUS_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Unpaid Status', SHIPSTATION_STATUS_NAMES.unpaid],
  ['Paid Status', SHIPSTATION_STATUS_NAMES.paid],
  ['Shipped Status', SHIPSTATION_STATUS_NAMES.shipped],
  ['Canceled Status', SHIPSTATION_STATUS_NAMES.canceled],
  ['On-Hold Status', SHIPSTATION_STATUS_NAMES.onHold],
]

const when = (ms: number | undefined): string =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet'

/**
 * Connect ShipStation (AGL-3613): the URL, username and password a merchant
 * pastes into ShipStation's Custom Store, the status names to map, a new
 * password and a disconnect. The password is kept sealed on the server and
 * a site admin can show it again; the card renders nothing on a deployment
 * that cannot seal one.
 */
export function ShipStationCard(props: ShipStationCardProps) {
  const { hostId } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  // Keyed on the account, not the user object: the object is new on every
  // render, and the status is the same until somebody else signs in.
  const uid = user?.uid
  useEffect(() => {
    if (!uid || !user) return
    let live = true
    authorizedFetch(user as never, `/api/commerce/shipping-connectors?hostId=${encodeURIComponent(hostId)}`)
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
    async (action: 'connect' | 'rotate' | 'reveal' | 'disconnect') => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user as never, '/api/commerce/shipping-connectors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, action }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(body?.error ?? 'That did not work. Try again.', { variant: 'error', allowDuplicate: true })
          return
        }
        setStatus(body as ConnectionStatus)
        setPassword(typeof body?.password === 'string' ? body.password : null)
        if (action === 'disconnect') {
          enqueueSnackbar('ShipStation is disconnected. It can no longer read your orders.', { variant: 'success' })
        }
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const copy = (label: string, value: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => enqueueSnackbar(`${label} copied`, { variant: 'success', persist: false }))
      .catch(() => enqueueSnackbar(`Select the ${label.toLowerCase()} and copy it.`, { variant: 'info' }))
  }

  // A deployment with no secret keyring cannot keep a password: nothing to offer.
  if (status && status.available === false && !status.connected) return null

  const connected = Boolean(status?.connected)
  const actions = !status ? null : connected ? (
    <Stack direction="row" spacing={1}>
      <Button size="small" disabled={busy} onClick={() => void act('rotate')}>
        {'New password'}
      </Button>
      <Button size="small" color="error" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
        {'Disconnect'}
      </Button>
    </Stack>
  ) : (
    <Button size="small" variant="contained" disabled={busy} onClick={() => void act('connect')}>
      {'Connect ShipStation'}
    </Button>
  )

  const endpoint = shipStationEndpoint(hostId)
  const credentialRows: Array<[string, string, boolean]> = [
    ['URL to custom XML page', endpoint, true],
    ['Username', status?.username ?? '', true],
  ]
  if (password) credentialRows.push(['Password', password, true])

  return (
    <CardDisplay
      header={'ShipStation'}
      help={pluginDocsHelp('shipStation', {
        excerpt:
          `ShipStation imports your paid orders from ${PLATFORM_BRAND_NAME} and sends each shipment back, which ` +
          'marks the order shipped and emails your customer the tracking link.',
      })}
      HeaderProps={{ action: actions }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {loadError ? <Alert severity="error">{loadError}</Alert> : null}
        {!connected ? (
          <Typography variant="body2" color="text.secondary">
            {
              'Already labeling in ShipStation? Connect it as a Custom Store: ShipStation imports the ' +
              'orders you still have to ship, and each label you buy there marks the order shipped ' +
              'here and emails your customer the tracking link. Only a site admin can connect it.'
            }
          </Typography>
        ) : (
          <>
            {password ? (
              <Alert severity="info">
                <AlertTitle>{'Paste these into ShipStation'}</AlertTitle>
                {
                  'Anyone with this password can read the name and address on every order you ship. ' +
                  'If it gets out, make a new password: the old one stops working at once.'
                }
              </Alert>
            ) : null}
            <ScrollTable size="small" aria-label="ShipStation connection">
              <TableBody>
                {credentialRows.map(([label, value]) => (
                  <TableRow key={label}>
                    <TableCell component="th" scope="row">
                      {label}
                    </TableCell>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{value}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => copy(label, value)}>
                        {'Copy'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!password ? (
                  <TableRow>
                    <TableCell component="th" scope="row">
                      {'Password'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {'Hidden. Only a site admin can show it.'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" disabled={busy} onClick={() => void act('reveal')}>
                        {'Show'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </ScrollTable>
            <Typography variant="subtitle2">{'Status names to type into ShipStation'}</Typography>
            <ScrollTable size="small" aria-label="ShipStation status names">
              <TableBody>
                {SHIPSTATION_STATUS_ROWS.map(([field, value]) => (
                  <TableRow key={field}>
                    <TableCell component="th" scope="row">
                      {field}
                    </TableCell>
                    <TableCell>{value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
            <Typography variant="body2" color="text.secondary">
              {`Last order import: ${when(status?.lastExportAtMs)}. Last shipment received: ${when(status?.lastShipNoticeAtMs)}.`}
            </Typography>
          </>
        )}
      </Stack>
      <Dialog open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)}>
        <DialogTitle>{'Disconnect ShipStation?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {
              'ShipStation stops importing orders from this site, and shipments it sends back are ' +
              'refused. Orders already shipped stay shipped. You can connect again later with a new password.'
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
ShipStationCard.displayName = 'ShipStationCard'

export default ShipStationCard
