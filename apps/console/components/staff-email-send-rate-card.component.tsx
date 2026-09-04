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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

interface SendRateBody {
  role: string
  config: {
    perHour: number
    enabled: boolean
    updatedAtMs: number | null
    updatedByEmail: string | null
    note: string
  }
  window: { windowStartMs: number; resetMs: number; used: number }
  bounds: { min: number; max: number }
}

function formatClock(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString() : '—'
}

/**
 * THE RAMP, on the staff console (AGL-2409).
 *
 * Every outbound message in the product leaves on one Resend key from one
 * verified domain under `p=reject`, and until this there was no per-hour or
 * per-day throttle anywhere in the email path — so the day a sending-domain
 * ramp was needed, there was nothing to turn.
 *
 * This is the turn. the standing rule is that a capability is not a feature
 * until the console exposes it, and a rate limit is the sharpest case of it: a
 * ceiling nobody can see cannot be trusted (is it biting? is that why the
 * campaign was short?) and a ceiling nobody can raise is an outage waiting for
 * a deploy.
 *
 * What it deliberately shows beside the number is the CURRENT HOUR'S USE. The
 * question an operator actually has is never "what is the ceiling" — it is
 * "are we near it", and a settings field alone cannot answer that.
 *
 * ## What this can and cannot refuse
 *
 * Stated on the card, not just in the code, because it is the thing an
 * operator most needs to believe before lowering the number: **the ceiling can
 * only ever defer a campaign or a bulk sweep. Password resets, receipts,
 * invites and booking reminders are never refused by it, at any value.** They
 * are counted — the ceiling is about total volume on the domain — but they
 * send regardless.
 */
export default function StaffEmailSendRateCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<SendRateBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [perHour, setPerHour] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await authorizedFetch(user, '/api/admin/email-send-rate')
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error ?? 'Could not load the send rate')
        return
      }
      setError(null)
      setData(payload as SendRateBody)
      setPerHour(String(payload?.config?.perHour ?? ''))
      setEnabled(payload?.config?.enabled !== false)
    } catch {
      setError('Could not load the send rate')
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        '/api/admin/email-send-rate',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            perHour: Number(perHour),
            enabled,
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not set the send rate', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar(
        `Platform send rate is now ${payload?.config?.perHour}/hour` +
          (payload?.config?.enabled === false ? ' (governor off)' : ''),
        { variant: 'success', persist: false },
      )
      setNote('')
      // Re-read rather than trusting the click (AGL-1571): the answer states
      // the post-condition, so the card shows what is stored, not what was
      // asked for.
      await load()
    } finally {
      setBusy(false)
    }
  }

  const isSuper = data?.role === 'super'
  const used = data?.window?.used ?? 0
  const ceiling = data?.config?.perHour ?? 0
  const percent = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 0
  const dirty =
    Boolean(data) &&
    (Number(perHour) !== data?.config?.perHour ||
      enabled !== (data?.config?.enabled !== false))

  return (
    <CardDisplay
      header={'Platform send rate'}
      help={docsHelp('staffConsole', {
        anchor: '#system-emails',
        excerpt:
          'The hourly ceiling on outbound mail across the whole platform. ' +
          'It can defer campaigns and scheduled bulk sweeps; it never ' +
          'refuses transactional mail.',
      })}
      subheader={
        `Everything ${PLATFORM_BRAND_NAME} sends leaves on one key and one ` +
        'verified domain. This is the ramp — change the value, no deploy.'
      }
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : !data ? (
        <Typography variant="body2">Loading…</Typography>
      ) : (
        <Stack spacing={2}>
          <Alert severity="info">
            A campaign or a scheduled bulk sweep over this ceiling is{' '}
            <strong>deferred to the next hour</strong>, never lost. Password
            resets, receipts, invites and booking reminders are{' '}
            <strong>never refused</strong> by it — they are counted, and they
            send whatever the number says.
          </Alert>

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2">
                This hour: <strong>{used.toLocaleString()}</strong> of{' '}
                {ceiling.toLocaleString()}
              </Typography>
              {data.config.enabled === false ? (
                <Chip size="small" color="warning" label="Governor off" />
              ) : used >= ceiling ? (
                <Chip size="small" color="warning" label="At the ceiling" />
              ) : null}
            </Stack>
            <LinearProgress
              variant="determinate"
              value={percent}
              color={used >= ceiling ? 'warning' : 'primary'}
            />
            <Typography variant="caption" color="text.secondary">
              Window resets at {formatClock(data.window.resetMs)}
              {data.config.updatedAtMs
                ? ` · last changed ${new Date(
                    data.config.updatedAtMs,
                  ).toLocaleString()}${
                    data.config.updatedByEmail
                      ? ` by ${data.config.updatedByEmail}`
                      : ''
                  }`
                : ' · never configured (using the built-in default)'}
            </Typography>
            {data.config.note ? (
              <Typography variant="caption" color="text.secondary">
                Note: {data.config.note}
              </Typography>
            ) : null}
          </Stack>

          {isSuper ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Messages per hour"
                  size="small"
                  type="number"
                  value={perHour}
                  onChange={(event) => setPerHour(event.target.value)}
                  slotProps={{
                    htmlInput: { min: data.bounds.min, max: data.bounds.max },
                  }}
                  helperText={`${data.bounds.min}–${data.bounds.max.toLocaleString()}`}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={enabled}
                      onChange={(event) => setEnabled(event.target.checked)}
                    />
                  }
                  label="Governor on"
                />
              </Stack>
              <TextField
                label="Why (audited)"
                size="small"
                fullWidth
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Warm-up step 3, or: investigating a bounce spike"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={save}
                  disabled={busy || !dirty || !perHour}
                >
                  Set send rate
                </Button>
                <Button onClick={() => void load()} disabled={busy}>
                  Refresh
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Alert severity="info">
              Changing the ceiling needs the super staff role — the same bar as
              release flags, because it decides whether every merchant&apos;s
              campaigns go out.
            </Alert>
          )}
        </Stack>
      )}
    </CardDisplay>
  )
}
