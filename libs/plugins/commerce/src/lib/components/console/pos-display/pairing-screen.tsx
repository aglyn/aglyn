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

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { type FormEvent, useState } from 'react'
import { pairDisplay, type PosDisplayBranding } from './pos-display-api'

/**
 * The unpaired display (AGL-3608): six digits from the register's Customer
 * display menu, exchanged once for this device's token.
 */
export function PosDisplayPairingScreen({
  onPaired,
}: {
  onPaired: (token: string, branding: PosDisplayBranding) => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = code.length === 6

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    const result = await pairDisplay(code)
    setBusy(false)
    const token = result.ok ? result.value?.token : undefined
    setCode('')
    if (token) {
      onPaired(token, result.value?.branding)
      return
    }
    setError(result.error ?? 'That code is not valid. Show a new code on the register.')
  }

  return (
    <Stack
      component="form"
      onSubmit={submit}
      spacing={4}
      sx={{ minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', px: 2 }}
    >
      <Typography variant="h3" component="h1" sx={{ textAlign: 'center' }}>
        Pair this display
      </Typography>
      <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center' }}>
        Enter the code shown on the register
      </Typography>
      <TextField
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        autoFocus
        autoComplete="one-time-code"
        placeholder="000000"
        slotProps={{
          htmlInput: {
            inputMode: 'numeric',
            pattern: '[0-9]*',
            maxLength: 6,
            'aria-label': 'Pairing code',
            style: { textAlign: 'center' },
          },
        }}
        sx={(theme) => ({
          width: '100%',
          maxWidth: theme.spacing(48),
          '& input': { ...theme.typography.h3, letterSpacing: theme.spacing(1) },
        })}
      />
      {error ? (
        <Alert severity="error" sx={{ width: '100%', maxWidth: (theme) => theme.spacing(48) }}>
          {error}
        </Alert>
      ) : null}
      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={!ready || busy}
        sx={(theme) => ({
          width: '100%',
          maxWidth: theme.spacing(48),
          minHeight: theme.spacing(8),
          ...theme.typography.h6,
        })}
      >
        {busy ? 'Pairing…' : 'Pair display'}
      </Button>
    </Stack>
  )
}
