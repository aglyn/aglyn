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

import {
  OWNER_APPROVAL_CHANNEL_LABELS,
  OWNER_APPROVAL_CHANNELS,
  describeHours,
  type OwnerApprovalChannel,
} from '@aglyn/aglyn/app-utils/owner-approval-record'
import { SITE_CARE_EXTRA_HOUR_USD } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  formatSiteCareDate,
  formatSiteCareMinutes,
  formatSiteCareUsd,
  SITE_CARE_LIVE_CHARGE_STATUSES,
  siteCareCandidatesSentence,
  siteCareChargeWords,
  siteCarePublishSentence,
  type SiteCareRequest,
  type SiteCareWorkspaceCandidate,
} from '@aglyn/aglyn/app-utils/site-care'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSiteCareCall } from './site-care-api'
import SiteCareHistoryList, { type SiteCareHistoryEntry } from './site-care-history-list.component'
import { docsHelp } from '../../constants/docs-links'

interface Panel {
  ticketId: string
  orgId: string
  subject: string
  request: SiteCareRequest
  history: SiteCareHistoryEntry[]
  suggestedMinutes: number
  monthMinutesLeft: number
  /** Other Site Care workspaces an emailed request's sender belongs to (AGL-4031). */
  otherWorkspaces?: SiteCareWorkspaceCandidate[]
  /** Why the request may not move, or null when it may. */
  moveBlockedReason?: string | null
}

type Form = 'close' | 'approve' | 'correct' | 'reverse' | 'quote' | 'move' | null

interface Blocked {
  message: string
  requiredHours: number
}

/** `datetime-local`'s value for an instant, in the viewer's zone. */
function localInputValue(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export interface SiteCareRequestPanelProps {
  ticketId: string
  /** Called after any change, so the thread around the panel re-reads. */
  onChanged?: () => void
}

/**
 * The Site Care request panel on a staff support thread (AGL-3959).
 *
 * Opening the thread starts the request's timer — once; a reload or a second
 * open changes nothing — so tracking time costs staff nothing. Closing asks
 * one number, the minutes, prefilled from the timer. When those minutes take
 * the month past the included hour and no approval covers them, the close
 * stops at "Ask the owner first" (record their yes) or "Absorb it" (close
 * with no charge). Every change after that — correcting the minutes or the
 * approval, voiding, crediting or refunding the charge, the quote reply — is
 * here too, each with a reason where it corrects something, and every one
 * lands in the append-only history below.
 *
 * An emailed request from a sender in several Site Care workspaces is filed
 * on one of them; the panel names the others and offers "Move to workspace"
 * while the request is open and nothing is billed or approved on it, and
 * says why not otherwise (AGL-4031).
 */
export function SiteCareRequestPanel({ ticketId, onChanged }: SiteCareRequestPanelProps) {
  const call = useSiteCareCall()
  const { enqueueSnackbar } = useSnackbar()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Form fields.
  const [minutes, setMinutes] = useState('')
  const [reason, setReason] = useState('')
  const [absorb, setAbsorb] = useState(false)
  const [hours, setHours] = useState('1')
  const [channel, setChannel] = useState<OwnerApprovalChannel>('phone')
  const [approvedAt, setApprovedAt] = useState(() => localInputValue(Date.now()))
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const [scope, setScope] = useState('')
  const [moveTo, setMoveTo] = useState('')

  const load = useCallback(async () => {
    const answer = await call<Panel>(`/api/admin/site-care?ticketId=${encodeURIComponent(ticketId)}`)
    if (answer.ok) {
      setPanel(answer.body)
      setFailed(null)
    } else if (answer.status) {
      setFailed(answer.body.error ?? 'The Site Care record could not be read')
    }
  }, [call, ticketId])

  // Opening the thread to work on it starts the timer, once. Keyed on the
  // request alone: `call` changes identity with the signed-in user object on
  // every render, and a re-run here would re-read in a loop.
  const loadRef = useRef(load)
  loadRef.current = load
  const callRef = useRef(call)
  callRef.current = call
  useEffect(() => {
    let active = true
    void (async () => {
      await callRef.current('/api/admin/site-care', { method: 'POST', body: { action: 'start', ticketId } })
      if (active) await loadRef.current()
    })()
    return () => {
      active = false
    }
  }, [ticketId])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const openForm = useCallback(
    (next: Form) => {
      setForm(next)
      setBlocked(null)
      setReason('')
      setAbsorb(false)
      if (next === 'close') setMinutes(String(panel?.suggestedMinutes ?? 5))
      if (next === 'correct') setMinutes(String(panel?.request.minutesLogged ?? ''))
      if (next === 'move') setMoveTo(panel?.otherWorkspaces?.[0]?.orgId ?? '')
      if (next === 'approve') {
        setHours(String(panel?.request.approval?.hours ?? 1))
        setChannel(panel?.request.approval?.channel ?? 'phone')
        setApprovedAt(localInputValue(panel?.request.approval?.approvedAtMs ?? Date.now()))
        setNote(panel?.request.approval?.note ?? '')
      }
    },
    [panel],
  )

  const act = useCallback(
    async (body: Record<string, unknown>, success: string) => {
      setBusy(true)
      try {
        const answer = await call<{ blocked?: { requiredHours: number } }>('/api/admin/site-care', {
          method: 'POST',
          body: { ticketId, ...body },
        })
        if (answer.status === 409 && answer.body.blocked) {
          setBlocked({
            message: answer.body.error ?? 'This needs the owner’s approval first.',
            requiredHours: answer.body.blocked.requiredHours,
          })
          return
        }
        if (!answer.ok) {
          if (answer.status) {
            enqueueSnackbar(answer.body.error ?? 'Request failed', { variant: 'warning', persist: false })
          }
          return
        }
        enqueueSnackbar(success, { variant: 'success', persist: false })
        setForm(null)
        setBlocked(null)
        await load()
        onChanged?.()
      } finally {
        setBusy(false)
      }
    },
    [call, ticketId, enqueueSnackbar, load, onChanged],
  )

  if (failed) return <Alert severity="warning">{failed}</Alert>
  if (!panel) return <Typography variant="body2" color="text.secondary">{'Loading Site Care…'}</Typography>
  const { request } = panel
  const charge = request.charge
  const chargeLive = Boolean(charge && SITE_CARE_LIVE_CHARGE_STATUSES.includes(charge.status) && charge.invoiceItemId)
  const chargeStuck = charge?.status === 'failed' || charge?.status === 'creating'
  const closed = request.state === 'closed'
  const elapsed = request.timerStartedAtMs ? Math.max(0, Math.round((now - request.timerStartedAtMs) / 60_000)) : null
  const otherWorkspaces = panel.otherWorkspaces ?? []
  const moveBlocked = panel.moveBlockedReason ?? null
  const moveTarget = otherWorkspaces.find((workspace) => workspace.orgId === moveTo) ?? null

  const blockedAlert = blocked ? (
    <Alert
      severity="warning"
      action={
        <Stack direction="row" spacing={1}>
          <Button size="small" color="inherit" onClick={() => openForm('approve')}>
            {'Ask the owner first'}
          </Button>
          <Button
            size="small"
            color="inherit"
            disabled={busy}
            onClick={() =>
              void act(
                form === 'correct'
                  ? { action: 'correctMinutes', minutes: Number(minutes), reason, absorb: true }
                  : { action: 'close', minutes: Number(minutes), absorb: true },
                'Closed; the extra time is absorbed at no charge',
              )
            }
          >
            {'Absorb it'}
          </Button>
        </Stack>
      }
    >
      {blocked.message}
    </Alert>
  ) : null

  return (
    <CardDisplay
      header="Site Care"
      help={docsHelp('supportTriage', { anchor: '#site-care-working' })}
      subheader={
        closed
          ? `Done ${request.closedAtMs ? formatSiteCareDate(request.closedAtMs) : ''}`
          : `Included time left this month: ${formatSiteCareMinutes(panel.monthMinutesLeft)}`
      }
      HeaderProps={{
        action: (
          <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {!closed ? (
              <Button size="small" variant="contained" disabled={busy} onClick={() => openForm('close')}>
                {'Close with minutes'}
              </Button>
            ) : (
              <Button size="small" disabled={busy} onClick={() => openForm('correct')}>
                {'Correct minutes'}
              </Button>
            )}
            <Button size="small" disabled={busy} onClick={() => openForm('approve')}>
              {request.approval ? 'Correct approval' : 'Record approval'}
            </Button>
            {chargeLive ? (
              <Button size="small" color="warning" disabled={busy} onClick={() => openForm('reverse')}>
                {'Void, credit or refund'}
              </Button>
            ) : null}
            {chargeStuck ? (
              <Button
                size="small"
                color="warning"
                disabled={busy}
                onClick={() => void act({ action: 'retryCharge' }, 'Charge retried')}
              >
                {'Retry charge'}
              </Button>
            ) : null}
            <Button size="small" disabled={busy} onClick={() => openForm('quote')}>
              {'Send quote'}
            </Button>
            {otherWorkspaces.length ? (
              <BlockedControl blocked={Boolean(moveBlocked)} reason={moveBlocked ?? ''}>
                <Button size="small" disabled={busy} onClick={() => openForm('move')}>
                  {'Move to workspace'}
                </Button>
              </BlockedControl>
            ) : null}
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" label={closed ? 'Done' : 'Open'} color={closed ? 'success' : 'warning'} />
          {elapsed !== null && !closed ? (
            <Chip size="small" variant="outlined" label={`Timer: ${formatSiteCareMinutes(elapsed)}`} />
          ) : null}
          {closed ? (
            <Chip
              size="small"
              variant="outlined"
              label={`${formatSiteCareMinutes(request.minutesLogged ?? 0)} logged · ${request.includedMinutesUsed} included min`}
            />
          ) : null}
          {request.approval ? (
            <Chip
              size="small"
              variant="outlined"
              label={`Approved up to ${describeHours(request.approval.hours)} (${OWNER_APPROVAL_CHANNEL_LABELS[
                request.approval.channel
              ].toLowerCase()})`}
            />
          ) : null}
          {request.billedHours > 0 || charge ? (
            <Chip
              size="small"
              color={chargeStuck ? 'error' : 'default'}
              label={`${describeHours(charge?.hours ?? request.billedHours)} · ${formatSiteCareUsd(
                charge?.amountCents ?? 0,
              )} · ${charge ? `${charge.status}` : 'no charge'}`}
            />
          ) : null}
          {request.absorbed ? <Chip size="small" variant="outlined" label="Extra time absorbed" /> : null}
        </Stack>
        {request.publish ? (
          <Typography variant="body2" color="text.secondary">
            {`Shipped: ${siteCarePublishSentence(request.publish, formatSiteCareDate)}`}
          </Typography>
        ) : null}
        {otherWorkspaces.length ? (
          <Typography variant="body2" color="text.secondary">
            {siteCareCandidatesSentence(otherWorkspaces)}
          </Typography>
        ) : null}
        {charge?.error ? <Alert severity="error">{`Stripe: ${charge.error}`}</Alert> : null}

        {form === 'close' || form === 'correct' ? (
          <Stack spacing={1.5}>
            <TextField
              label="Minutes"
              type="number"
              size="small"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              helperText={
                form === 'close'
                  ? 'From the timer, rounded up to 5. Change it if the timer is off.'
                  : 'Until the month’s invoice finalizes. The owner is emailed the before and after.'
              }
              slotProps={{ htmlInput: { min: 1, step: 5 } }}
            />
            {form === 'correct' ? (
              <TextField label="Why" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} />
            ) : null}
            {blockedAlert}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                disabled={busy || !Number(minutes) || (form === 'correct' && !reason.trim())}
                onClick={() =>
                  void act(
                    form === 'close'
                      ? { action: 'close', minutes: Number(minutes) }
                      : { action: 'correctMinutes', minutes: Number(minutes), reason },
                    form === 'close' ? 'Closed; the owner has been emailed a summary' : 'Minutes corrected',
                  )
                }
              >
                {form === 'close' ? 'Close' : 'Save correction'}
              </Button>
              <Button size="small" onClick={() => setForm(null)}>
                {'Cancel'}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        {form === 'approve' ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {`Record how the owner said yes. Extra time is $${SITE_CARE_EXTRA_HOUR_USD}/hour in whole hours, rounded up, and never less than what they approve. Saving emails the owner a confirmation.`}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Hours approved"
                type="number"
                size="small"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
              />
              <TextField
                select
                label="How they said yes"
                size="small"
                value={channel}
                onChange={(event) => setChannel(event.target.value as OwnerApprovalChannel)}
                sx={{ minWidth: (theme) => theme.spacing(22.5) }}
              >
                {OWNER_APPROVAL_CHANNELS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {OWNER_APPROVAL_CHANNEL_LABELS[value]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="When"
                type="datetime-local"
                size="small"
                value={approvedAt}
                onChange={(event) => setApprovedAt(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <TextField label="What they approved (optional)" size="small" value={note} onChange={(e) => setNote(e.target.value)} />
            {request.approval ? (
              <TextField label="Why it is being corrected" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} />
            ) : null}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                disabled={busy || !Number(hours) || (Boolean(request.approval) && !reason.trim())}
                onClick={() =>
                  void act(
                    {
                      action: 'approve',
                      approval: {
                        hours: Number(hours),
                        channel,
                        approvedAtMs: new Date(approvedAt).getTime(),
                        note,
                        reason,
                      },
                    },
                    'Approval recorded; the owner has been emailed a confirmation',
                  )
                }
              >
                {request.approval ? 'Save correction' : 'Save approval'}
              </Button>
              <Button size="small" onClick={() => setForm(null)}>
                {'Cancel'}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        {form === 'reverse' && charge ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {`${formatSiteCareUsd(charge.amountCents)} for ${describeHours(charge.hours)}. Before the invoice finalizes it is removed; after, credited; once paid, refunded. The owner is emailed.`}
            </Typography>
            <TextField label="Why" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} />
            <FormControlLabel
              control={<Checkbox checked={absorb} onChange={(event) => setAbsorb(event.target.checked)} />}
              label="Absorb it: record this request's extra time as not charged"
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="warning"
                size="small"
                disabled={busy || !reason.trim()}
                onClick={() => void act({ action: 'reverseCharge', reason, absorb }, 'Charge reversed')}
              >
                {'Reverse charge'}
              </Button>
              <Button size="small" onClick={() => setForm(null)}>
                {'Cancel'}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        {form === 'quote' ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {'For work that adds a page, a form, a design or a campaign: one flat price, fixed once given. The owner replies yes, then bill it with Charge for work.'}
            </Typography>
            <TextField
              label="Price (USD)"
              type="number"
              size="small"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
            />
            <TextField label="What it covers" size="small" multiline minRows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                disabled={busy || !Number(amount) || !scope.trim()}
                onClick={() => void act({ action: 'sendQuote', amountUsd: Number(amount), scope }, 'Quote sent')}
              >
                {'Send quote'}
              </Button>
              <Button size="small" onClick={() => setForm(null)}>
                {'Cancel'}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        {form === 'move' && !moveBlocked ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {'The sender is a member of each of these workspaces. Moving the request makes its time count against the chosen workspace’s included hour, and its summary goes to that workspace’s owner when it is done.'}
            </Typography>
            <TextField
              select
              label="Move to"
              size="small"
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
            >
              {otherWorkspaces.map((workspace) => (
                <MenuItem key={workspace.orgId} value={workspace.orgId}>
                  {workspace.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                disabled={busy || !moveTarget}
                onClick={() =>
                  void act({ action: 'move', orgId: moveTo }, `Moved to ${moveTarget?.name ?? 'the workspace'}`)
                }
              >
                {'Move'}
              </Button>
              <Button size="small" onClick={() => setForm(null)}>
                {'Cancel'}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        {charge && !chargeStuck ? (
          <Typography variant="caption" color="text.secondary">
            {`Owner sees: ${siteCareChargeWords(charge.status)}`}
          </Typography>
        ) : null}
        <Typography variant="subtitle2">{'History'}</Typography>
        <SiteCareHistoryList rows={panel.history} staff />
      </Stack>
    </CardDisplay>
  )
}

SiteCareRequestPanel.displayName = 'SiteCareRequestPanel'

export default SiteCareRequestPanel
