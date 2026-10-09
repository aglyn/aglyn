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

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { type FormEvent, useEffect, useState } from 'react'
import { kioskApi, type PosKioskSettingsView } from './pos-kiosk-api'

/**
 * Staff unlock (AGL-3623): a corner button, then the staff PIN the register
 * uses, checked on the server. No names are listed — the screen faces the
 * public — and a right PIN opens the kiosk's settings for a few minutes:
 * which card reader it sends payments to, and leaving kiosk mode.
 */
export function KioskStaffControl({
  token,
  onExit,
  onUnauthorized,
}: {
  token: string
  /** Kiosk mode was left: the device is unpaired. */
  onExit: () => void
  onUnauthorized: () => void
}) {
  const [stage, setStage] = useState<'closed' | 'pin' | 'settings'>('closed')
  const [pin, setPin] = useState('')
  const [unlock, setUnlock] = useState<{ unlock: string; expiresAtMs: number } | null>(null)
  const [view, setView] = useState<PosKioskSettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)

  const close = () => {
    setStage('closed')
    setPin('')
    setUnlock(null)
    setView(null)
    setError(null)
    setConfirmExit(false)
  }

  // The unlock lapses on its own: the settings close with it.
  useEffect(() => {
    if (!unlock) return undefined
    const timer = setTimeout(close, Math.max(0, unlock.expiresAtMs - Date.now()))
    return () => clearTimeout(timer)
  }, [unlock])

  const submitPin = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || pin.length < 4) return
    setBusy(true)
    setError(null)
    const result = await kioskApi.unlock(token, pin)
    setPin('')
    if (!result.ok || !result.value) {
      setBusy(false)
      if (result.status === 401 && /not paired/i.test(result.error ?? '')) return onUnauthorized()
      setError(result.error ?? 'That PIN is not right.')
      return
    }
    const opened = await kioskApi.settings(token, result.value.unlock)
    setBusy(false)
    setUnlock(result.value)
    setView(opened.value ?? null)
    setStage('settings')
  }

  const chooseReader = async (readerId: string) => {
    if (!unlock) return
    setBusy(true)
    const result = await kioskApi.setReader(token, unlock.unlock, readerId)
    setBusy(false)
    if (result.ok && result.value) setView(result.value)
    else setError(result.error ?? 'The card reader could not be changed.')
  }

  const exit = async () => {
    if (!unlock) return
    setBusy(true)
    const result = await kioskApi.exit(token, unlock.unlock)
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'Kiosk mode could not be turned off.')
      return
    }
    close()
    onExit()
  }

  return (
    <>
      <Button
        size="small"
        color="inherit"
        onClick={() => setStage('pin')}
        sx={(theme) => ({ position: 'fixed', left: theme.spacing(1), top: theme.spacing(1), opacity: 0.4 })}
      >
        {'Staff'}
      </Button>
      <Dialog open={stage === 'pin'} onClose={() => (busy ? undefined : close())} maxWidth="xs" fullWidth>
        <form onSubmit={submitPin}>
          <DialogTitle>{'Staff unlock'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <DialogContentText>{'Enter your register PIN.'}</DialogContentText>
              <TextField
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                type="password"
                autoFocus
                autoComplete="off"
                slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6, 'aria-label': 'Staff PIN' } }}
              />
              {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={busy}>
              {'Cancel'}
            </Button>
            <Button type="submit" variant="contained" disabled={busy || pin.length < 4}>
              {busy ? 'Checking…' : 'Unlock'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog open={stage === 'settings'} onClose={() => (busy ? undefined : close())} maxWidth="xs" fullWidth>
        <DialogTitle>{view?.label || 'Kiosk settings'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {view && view.readers.length > 0 ? (
              <TextField
                select
                label="Card reader"
                value={view.readerId ?? ''}
                disabled={busy}
                onChange={(event) => void chooseReader(event.target.value)}
              >
                <MenuItem value="">{'None — pay at counter only'}</MenuItem>
                {view.readers.map((reader) => (
                  <MenuItem key={reader.id} value={reader.id}>
                    {`${reader.label} (${reader.status})`}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <DialogContentText>{'No card reader is assigned to this register.'}</DialogContentText>
            )}
            {confirmExit ? (
              <Alert severity="warning">
                {'This unpairs the kiosk. To use it again, show a new kiosk code on the register.'}
              </Alert>
            ) : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          {confirmExit ? (
            <Button color="error" variant="contained" disabled={busy} onClick={() => void exit()}>
              {'Exit kiosk mode'}
            </Button>
          ) : (
            <Button color="error" disabled={busy} onClick={() => setConfirmExit(true)}>
              {'Exit kiosk mode'}
            </Button>
          )}
          <Button onClick={() => window.location.reload()} disabled={busy}>
            {'Reload'}
          </Button>
          <Button variant="contained" onClick={close} disabled={busy}>
            {'Done'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
