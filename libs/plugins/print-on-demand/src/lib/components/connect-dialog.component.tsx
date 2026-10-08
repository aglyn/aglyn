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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import type { PodConnectionView, PodProviderId } from '../model/print-on-demand'
import { usePodFetch, type PodProviderOffer } from './pod-api'

export interface ConnectDialogProps {
  hostId: string
  open: boolean
  offers: PodProviderOffer[]
  onClose: () => void
  onConnected: (connection: PodConnectionView, notice: string | null) => void
}

/**
 * Connects a service with the merchant's own token (AGL-3641). The token is
 * tested before it is kept, and when it reaches more than one store the
 * member chooses which one.
 */
export function ConnectDialog(props: ConnectDialogProps) {
  const { hostId, open, offers, onClose, onConnected } = props
  const request = usePodFetch()
  const [provider, setProvider] = useState<PodProviderId | ''>(offers[0]?.id ?? '')
  const [token, setToken] = useState('')
  const [stores, setStores] = useState<Array<{ id: string; name: string }> | null>(null)
  const [storeId, setStoreId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offer = offers.find((entry) => entry.id === provider) ?? offers[0]
  const chosen = offer?.id

  const reset = () => {
    setToken('')
    setStores(null)
    setStoreId('')
    setError(null)
  }

  const connect = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      const answer = await request<{ connection: PodConnectionView; notice: string | null }>(POD_API_ROUTES.connect, {
        body: { hostId, provider: chosen, token: token.trim(), ...(storeId ? { storeId } : {}) },
      })
      reset()
      onConnected(answer.connection, answer.notice)
    } catch (cause) {
      if ((cause as { status?: number }).status === 409 && !stores) {
        // The token reaches several stores: list them to choose from.
        try {
          const found = await request<{ stores: Array<{ id: string; name: string }> }>(POD_API_ROUTES.stores, {
            body: { hostId, provider: chosen, token: token.trim() },
          })
          setStores(found.stores)
          setStoreId(found.stores[0]?.id ?? '')
        } catch (inner) {
          setError((inner as Error).message)
        }
      } else {
        setError((cause as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{offer ? `Connect ${offer.label}` : 'Connect a service'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {offers.length > 1 ? (
            <TextField
              select
              label="Service"
              value={chosen ?? ''}
              onChange={(event) => {
                setProvider(event.target.value as PodProviderId)
                reset()
              }}
              disabled={busy}
            >
              {offers.map((entry) => (
                <MenuItem key={entry.id} value={entry.id}>
                  {entry.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {offer ? (
            <Typography variant="body2" color="text.secondary">
              {offer.tokenHelp.steps}{' '}
              <Link href={offer.tokenHelp.url} target="_blank" rel="noopener noreferrer">
                {`Open ${offer.label}`}
              </Link>
            </Typography>
          ) : null}
          <TextField
            label={offer ? `${offer.label} ${offer.tokenHelp.label}` : 'Token'}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => {
              setToken(event.target.value)
              setStores(null)
              setStoreId('')
            }}
            disabled={busy}
            helperText={`Kept encrypted and used only for this site. ${PLATFORM_BRAND_NAME} never asks for your ${offer?.label ?? 'service'} password.`}
            fullWidth
          />
          {stores ? (
            <TextField
              select
              label={chosen === 'printful' ? 'Printful store' : 'Printify shop'}
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              disabled={busy}
            >
              {stores.map((store) => (
                <MenuItem key={store.id} value={store.id}>
                  {store.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void connect()} disabled={busy || !token.trim() || (Boolean(stores) && !storeId)}>
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ConnectDialog
