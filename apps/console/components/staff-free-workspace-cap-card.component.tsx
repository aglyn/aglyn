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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

interface FreeWorkspaceCapBody {
  role: string
  config: {
    limit: number
    enabled: boolean
    note: string
    updatedAtMs: number | null
    updatedByEmail: string | null
    ready: boolean
  }
  bounds: { min: number; max: number }
  holder?: { uid: string; held: number; orgIds: string[] }
}

/**
 * THE FREE-WORKSPACE CEILING, on the staff console (AGL-2265).
 *
 * Every free cap in the product is per ORG, so before this one account could
 * hold any number of free workspaces and multiply the whole free allowance by
 * that number. the decision was three — **and a control here**, which is
 * the half that makes the number safe to have at all: the accounts this
 * refuses and the accounts it must never refuse (a consultant, an agency,
 * anyone who asks) are told apart by a person, and a person must not need a
 * deploy to say yes.
 *
 * ## Loading is a state, not a value
 *
 * Nothing on this card renders a number until the endpoint has answered, and
 * the Set button stays disabled until then. A ceiling that reads `0` for a
 * moment is a card that says the platform refuses every signup; a ceiling
 * that reads blank-as-unlimited is a card that says nothing is enforced.
 * Neither is true and both are believable, which is exactly the shape of the
 * `checkQuota(undefined)` bug this codebase has already shipped once. The
 * server carries the same distinction as `config.ready`, and when it is false
 * this says so rather than presenting a stand-in as the setting.
 */
export default function StaffFreeWorkspaceCapCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<FreeWorkspaceCapBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const idToken = await (user as any)?.getIdToken?.()
      if (!idToken) return
      const response = await fetch('/api/admin/free-workspace-cap', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error ?? 'Could not load the free workspace limit')
        return
      }
      setError(null)
      setData(payload as FreeWorkspaceCapBody)
      setLimit(String(payload?.config?.limit ?? ''))
      setEnabled(payload?.config?.enabled !== false)
    } catch {
      setError('Could not load the free workspace limit')
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/free-workspace-cap', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          limit: Number(limit),
          enabled,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not set the free workspace limit', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar(
        `Free workspaces per account is now ${payload?.config?.limit}` +
          (payload?.config?.enabled === false ? ' (ceiling off)' : ''),
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
  // `data === null` is the loading state and is rendered as one. Nothing below
  // this line may substitute a number for an answer that has not arrived.
  const dirty =
    Boolean(data) &&
    (Number(limit) !== data?.config?.limit ||
      enabled !== (data?.config?.enabled !== false))

  return (
    <CardDisplay
      header={'Free workspaces per account'}
      help={docsHelp('staffConsole', {
        anchor: '#free-workspace-limit',
        excerpt:
          'How many FREE workspaces one account may hold. Paid workspaces ' +
          'do not count, and being invited to somebody else’s workspace ' +
          'never counts. Change the value, no deploy.',
      })}
      subheader={
        'Every free quota is per workspace, so without a ceiling one account ' +
        'multiplies the whole free allowance. This is the ceiling.'
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
            Counted: <strong>free</strong> workspaces the account owns now or
            created. <strong>Paid workspaces do not count</strong> — an
            agency&apos;s workspaces are paid, and this exists to stop the free
            allowance multiplying. Being <strong>invited</strong> to someone
            else&apos;s workspace never counts, and handing a workspace to
            another account does not free a slot.
          </Alert>

          {data.config.ready === false ? (
            <Alert severity="warning">
              The stored limit could not be read just now, so this is the
              built-in default standing in for it — not a setting anybody
              chose. Refresh before changing it.
            </Alert>
          ) : null}

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2">
                Limit: <strong>{data.config.limit}</strong> free workspaces per
                account
              </Typography>
              {data.config.enabled === false ? (
                <Chip size="small" color="warning" label="Ceiling off" />
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {data.config.updatedAtMs
                ? `Last changed ${new Date(
                    data.config.updatedAtMs,
                  ).toLocaleString()}${
                    data.config.updatedByEmail
                      ? ` by ${data.config.updatedByEmail}`
                      : ''
                  }`
                : 'Never configured (using the built-in default)'}
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
                  label="Free workspaces per account"
                  size="small"
                  type="number"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  slotProps={{
                    htmlInput: { min: data.bounds.min, max: data.bounds.max },
                  }}
                  helperText={`${data.bounds.min}–${data.bounds.max}`}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={enabled}
                      onChange={(event) => setEnabled(event.target.checked)}
                    />
                  }
                  label="Ceiling on"
                />
              </Stack>
              <TextField
                label="Why (audited)"
                size="small"
                fullWidth
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Raising for the agency beta, or: abuse wave 2026-08"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={save}
                  disabled={busy || !dirty || !limit}
                >
                  Set limit
                </Button>
                <Button onClick={() => void load()} disabled={busy}>
                  Refresh
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Lowering this never removes anybody&apos;s existing
                workspaces — an account already over the new number keeps
                every one of them and simply cannot create another.
              </Typography>
            </Stack>
          ) : (
            <Alert severity="info">
              Changing the limit needs the super staff role — the same bar as
              release flags, because a low enough number is indistinguishable
              from signups being switched off.
            </Alert>
          )}
        </Stack>
      )}
    </CardDisplay>
  )
}
