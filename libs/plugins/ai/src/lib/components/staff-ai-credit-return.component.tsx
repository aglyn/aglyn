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

import { resolveStaffRoleGate } from '@aglyn/aglyn/app-utils/staff-role-gate'
import BlockedControl from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'

/**
 * GIVE AI CREDITS BACK (AGL-3595): the staff dialog behind the AI cards'
 * "Give back credits" and "Reset this month" header actions.
 *
 * Posts to `/api/ai/admin/credits`, which holds every rule — the role, the
 * bound, the reason, the key. The dialog states the same rules before the
 * request so staff are not refused for something the form could have said,
 * and mints the idempotency key once per opening, so a double-click or a
 * retry after a lost response returns the credits once.
 */

/** The roles the route admits (`AI_CREDIT_RETURN_ROLES`, server side). */
const RETURN_ROLES = ['super', 'billing'] as const

export type StaffCreditReturnMeter = 'workspace' | 'account' | 'both'

/** One meter's month, as the card already holds it. */
export interface StaffCreditMeterFigure {
  /** Credits used this month, net of earlier give-backs. */
  used: number
  /** The band or allowance, or null where none applies. */
  limit: number | null
}

/** The most one give-back may return to the meter(s) chosen. */
export function staffCreditReturnable(
  meter: StaffCreditReturnMeter,
  workspace: StaffCreditMeterFigure | null,
  account: StaffCreditMeterFigure | null,
): number {
  const figures =
    meter === 'both'
      ? [workspace, account]
      : meter === 'workspace'
        ? [workspace]
        : [account]
  if (figures.some((figure) => !figure)) return 0
  return Math.max(
    0,
    Math.min(...figures.map((figure) => Math.floor(figure?.used ?? 0))),
  )
}

/**
 * What stops the form, or `null` when it may be sent — the route's own
 * refusals, said before the request.
 */
export function staffCreditReturnProblem(input: {
  mode: 'give' | 'reset'
  credits: string
  reason: string
  returnable: number
}): string | null {
  if (!input.reason.trim()) return 'Say why — the reason is the audit row.'
  if (input.returnable <= 0) return 'Nothing used this month to give back.'
  if (input.mode === 'reset') return null
  const credits = Number(input.credits)
  if (!Number.isInteger(credits) || credits < 1) {
    return 'Enter a whole number of credits, 1 or more.'
  }
  if (credits > input.returnable) {
    return `At most ${input.returnable.toLocaleString()} — what this month used.`
  }
  return null
}

const newKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`

/** The signed-in staff member's role, `null` while the token is read. */
export function useStaffRoleClaim(): string | null {
  const { data: user } = useUser()
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const account = user as
      | { getIdTokenResult?: () => Promise<{ claims?: Record<string, unknown> }> }
      | null
      | undefined
    if (!account?.getIdTokenResult) return undefined
    void account
      .getIdTokenResult()
      .then((result) => {
        if (!active) return
        const claims = result?.claims
        // Missing is `support`, as every staff route reads it (AGL-495).
        setRole(claims?.['staff'] ? String(claims['staffRole'] ?? 'support') : null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [user])
  return role
}

/**
 * The two header actions, gated on the role the route admits. A role that
 * would be refused sees the buttons disabled with the reason, not hidden.
 */
export function StaffCreditReturnActions({
  disabled,
  onGive,
  onReset,
}: {
  disabled: boolean
  onGive: () => void
  onReset: () => void
}) {
  const gate = resolveStaffRoleGate(useStaffRoleClaim(), RETURN_ROLES)
  const reason = gate.reason ?? ''
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      <BlockedControl blocked={gate.blocked} reason={reason}>
        <Button size="small" disabled={disabled || !gate.admitted} onClick={onGive}>
          {'Give back credits'}
        </Button>
      </BlockedControl>
      <BlockedControl blocked={gate.blocked} reason={reason}>
        <Button
          size="small"
          color="warning"
          disabled={disabled || !gate.admitted}
          onClick={onReset}
        >
          {'Reset this month'}
        </Button>
      </BlockedControl>
    </Stack>
  )
}

export interface StaffCreditReturnDialogProps {
  open: boolean
  mode: 'give' | 'reset'
  /** The workspace, or (from the staff user page) the account. */
  target: { orgId: string } | { uid: string }
  /** The workspace's band this month; null where it is not offered. */
  workspace: StaffCreditMeterFigure | null
  /** The owner's Free allowance this month; null where it does not apply. */
  account: StaffCreditMeterFigure | null
  /** Opened from a job: its id, and what it spent. */
  jobId?: string | null
  jobCredits?: number | null
  onClose: () => void
  /** After the route answered 200 — the card re-reads its figures. */
  onReturned: (message: string) => void
}

const meterLabel: Record<StaffCreditReturnMeter, string> = {
  workspace: 'Workspace band',
  account: 'Owner’s Free allowance',
  both: 'Both',
}

export function StaffCreditReturnDialog(props: StaffCreditReturnDialogProps) {
  const { open, mode, workspace, account } = props
  const { data: user } = useUser()
  const meters = (['both', 'workspace', 'account'] as const).filter((meter) =>
    meter === 'both' ? Boolean(workspace && account) : meter === 'workspace' ? Boolean(workspace) : Boolean(account),
  )
  const [meter, setMeter] = useState<StaffCreditReturnMeter>(meters[0] ?? 'workspace')
  const [credits, setCredits] = useState('')
  const [reason, setReason] = useState('')
  const [jobId, setJobId] = useState('')
  const [key, setKey] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const returnable = staffCreditReturnable(meter, workspace, account)

  // Each opening is one act: a fresh key, and the form reset to its
  // defaults — the amount that puts the meter back to zero, or the job's
  // spend when opened from a job, never more than the month used.
  useEffect(() => {
    if (!open) return
    const initialMeter = meters[0] ?? 'workspace'
    const initialReturnable = staffCreditReturnable(initialMeter, workspace, account)
    const suggested =
      props.jobCredits && props.jobCredits > 0
        ? Math.min(Math.ceil(props.jobCredits), initialReturnable)
        : initialReturnable
    setMeter(initialMeter)
    setCredits(suggested > 0 ? String(suggested) : '')
    setReason('')
    setJobId(props.jobId ?? '')
    setKey(newKey())
    setTouched(false)
    setError(null)
    // Opening is the trigger; the figures are read as they stand then, and
    // a card re-read while the dialog is open must not wipe what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const problem = staffCreditReturnProblem({ mode, credits, reason, returnable })

  const submit = async () => {
    setTouched(true)
    if (problem || !user) return
    setBusy(true)
    setError(null)
    try {
      const response = await authorizedFetch(user, '/api/ai/admin/credits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...props.target,
          action: mode,
          meter,
          ...(mode === 'give' ? { credits: Number(credits) } : {}),
          reason: reason.trim(),
          jobId: jobId.trim() || null,
          idempotencyKey: key,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setError(payload?.error ?? 'Giving credits back failed')
        return
      }
      const lines = (payload?.lines ?? []) as Array<{ meter: string; credits: number }>
      props.onReturned(
        payload?.duplicate
          ? 'Already given back — nothing returned twice.'
          : `Returned ${lines
              .filter((line) => line.credits > 0)
              .map((line) => `${line.credits.toLocaleString()} credits to the ${line.meter}`)
              .join(' and ')}.`,
      )
    } catch {
      setError('Giving credits back failed')
    } finally {
      setBusy(false)
    }
  }

  const figure = (label: string, value: StaffCreditMeterFigure | null) =>
    value ? (
      <Typography variant="body2">
        {`${label}: ${Math.floor(value.used).toLocaleString()} used` +
          (value.limit === null ? '' : ` of ${value.limit.toLocaleString()}`)}
      </Typography>
    ) : null

  return (
    <Dialog open={open} onClose={busy ? undefined : props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{mode === 'reset' ? 'Reset this month’s AI credits' : 'Give back AI credits'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {mode === 'reset'
            ? 'Returns everything used this month on the meter you choose. The spend stays on record; the meter reads it as given back.'
            : 'For a fault of ours. The spend stays on record; the meter reads it as given back, up to what this month used.'}
        </Typography>
        <Stack spacing={0.5}>
          {figure('Workspace band', workspace)}
          {figure('Owner’s Free allowance', account)}
        </Stack>
        {meters.length > 1 ? (
          <div>
            <FormLabel id="ai-credit-return-meter">{'Give back to'}</FormLabel>
            <RadioGroup
              aria-labelledby="ai-credit-return-meter"
              value={meter}
              onChange={(event) => setMeter(event.target.value as StaffCreditReturnMeter)}
            >
              {meters.map((value) => (
                <FormControlLabel
                  key={value}
                  value={value}
                  control={<Radio size="small" />}
                  disabled={busy}
                  label={meterLabel[value]}
                />
              ))}
            </RadioGroup>
          </div>
        ) : null}
        {mode === 'give' ? (
          <TextField
            label="Credits"
            type="number"
            size="small"
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
            disabled={busy}
            slotProps={{ htmlInput: { min: 1, max: returnable, step: 1 } }}
            helperText={`At most ${returnable.toLocaleString()} — what this month used${meter === 'both' ? ' on the lower of the two' : ''}.`}
          />
        ) : (
          <Typography variant="body2">
            {meter === 'both'
              ? `Returns ${Math.floor(workspace?.used ?? 0).toLocaleString()} to the workspace band and ${Math.floor(account?.used ?? 0).toLocaleString()} to the owner’s allowance.`
              : `Returns ${returnable.toLocaleString()} credits.`}
          </Typography>
        )}
        <TextField
          label="Reason"
          required
          multiline
          minRows={2}
          size="small"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
          error={touched && !reason.trim()}
          helperText="Recorded in the staff audit log with the amount."
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        <TextField
          label="AI job id (optional)"
          size="small"
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          disabled={busy}
        />
        {(touched && problem) || error ? (
          <Alert severity="error">{error ?? problem}</Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={props.onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color={mode === 'reset' ? 'warning' : 'primary'}
          disabled={busy}
          onClick={() => void submit()}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
        >
          {mode === 'reset' ? 'Reset' : 'Give back'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
StaffCreditReturnDialog.displayName = 'StaffCreditReturnDialog'
