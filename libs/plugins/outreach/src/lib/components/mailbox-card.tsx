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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  FormHelperText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatMinuteOfDay,
  isValidTimezone,
  OUTREACH_DEFAULT_WINDOW,
  OUTREACH_MAILBOX_STATUS_LABELS,
  OUTREACH_MAX_DAILY_CAP,
  OUTREACH_RAMP_STEPS,
  OUTREACH_WEEKDAY_LABELS,
  outreachEffectiveDailyCap,
  summarizeMailboxHealth,
  validateDailyCap,
  validateDisplayName,
  validateSendWindow,
} from '../mailboxes/mailbox-settings'
import type {
  OutreachMailbox,
  OutreachMailboxStatus,
  OutreachSendWindow,
} from '../model/outreach.types'
import type { OutreachMailboxApi } from './use-outreach-mailbox-api'

export interface MailboxCardProps {
  mailbox: OutreachMailbox
  /** The viewer is the member who connected it. */
  isMine: boolean
  /** The viewer may change, pause and disconnect it: its member, or an org owner or admin. */
  canManage: boolean
  api: OutreachMailboxApi
  /** Starts a new Google connect, for a mailbox that needs reconnecting. */
  onReconnect(): void
  /** True while that connect is on its way to Google. */
  reconnecting?: boolean
  /** The clock the health window and today's limit are read on. */
  nowMs?: number
}

/**
 * What the card says about a mailbox that paused ITSELF (AGL-2981): the
 * engine's own sentence, when it paused, and — after a complaint — the day
 * resuming stops being premature. Nothing sends from it until a member
 * resumes it.
 */
export function autoPauseSentence(mailbox: Pick<OutreachMailbox, 'autoPause' | 'timezone'>): string {
  const pause = mailbox.autoPause
  if (!pause) return ''
  const day = (atMs: number) => {
    try {
      return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: mailbox.timezone }).format(atMs)
    } catch {
      return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(atMs)
    }
  }
  const until = typeof pause.untilMs === 'number' ? ` Wait until ${day(pause.untilMs)} before resuming it.` : ''
  return `Sequences paused this mailbox on ${day(pause.atMs)}. ${pause.message}${until} Nothing sends from it until it is resumed.`
}

/** Accessible names of the card's actions, spelled once for the specs. */
export const MAILBOX_ACTION_LABELS = {
  save: 'Save settings',
  pause: 'Pause',
  resume: 'Resume',
  test: 'Send a test to myself',
  testElsewhere: 'Send a test',
  testAddress: 'Test address',
  warmUp: 'Warm up gradually',
  disconnect: 'Disconnect',
  reconnect: 'Reconnect',
} as const

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const STATUS_COLOR: Record<OutreachMailboxStatus, 'success' | 'default' | 'warning' | 'error'> = {
  connected: 'success',
  paused: 'default',
  reconnect_required: 'warning',
  disconnected: 'error',
}

/** Every half hour of the day, and midnight at its end. */
const MINUTE_OPTIONS = Array.from({ length: 49 }, (_, index) => index * 30)

/** The zones this runtime knows, the mailbox's own included whatever it is. */
function timezoneOptions(current: string): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  const zones = supported.length ? supported : ['UTC']
  return zones.includes(current) ? zones : [current, ...zones]
}

/** The ramp, as the cap's helper text reads it. */
const RAMP_SENTENCE = `Warm-up: ${OUTREACH_RAMP_STEPS.map((step, index) =>
  `week ${step.week}${index === OUTREACH_RAMP_STEPS.length - 1 ? '+' : ''}: ${step.limit}`,
).join(' · ')} a day, never above the cap.`

interface Draft {
  sendAs: string
  displayName: string
  dailyCap: string
  window: OutreachSendWindow
  timezone: string
  /** Whether the warm-up ramp applies — `rampStartedAtMs` as a switch. */
  warmUp: boolean
}

const draftOf = (mailbox: OutreachMailbox): Draft => ({
  sendAs: mailbox.sendAs ?? mailbox.email,
  displayName: mailbox.displayName ?? '',
  dailyCap: String(mailbox.dailyCap ?? ''),
  window: mailbox.window ?? OUTREACH_DEFAULT_WINDOW,
  timezone: mailbox.timezone ?? 'UTC',
  warmUp: typeof mailbox.rampStartedAtMs === 'number',
})

/**
 * One connected mailbox (AGL-2978): its account and status, its last seven
 * days, its settings, and pause, test and disconnect.
 *
 * Every control is offered only where the route will allow it: the settings
 * form and pause and disconnect to the member who connected the mailbox or an
 * org owner or admin, and the test and the reconnect to its member alone,
 * because both act in that member's own Google account.
 */
export function MailboxCard(props: MailboxCardProps) {
  const { mailbox, isMine, canManage, api, onReconnect, reconnecting = false, nowMs = Date.now() } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [draft, setDraft] = useState<Draft>(() => draftOf(mailbox))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'status' | 'test' | 'disconnect' | null>(null)
  // Where a test goes when not to the member themself (AGL-3228): a test to
  // one's own address never leaves Google and shows no authentication result.
  const [testAddress, setTestAddress] = useState('')

  // A save here, a change made from another tab, or a reconnect rewrites the
  // stored settings; the form follows them, unless the member has unsaved
  // edits of their own, which are never thrown away.
  const stored = useMemo(() => draftOf(mailbox), [mailbox])
  const storedKey = JSON.stringify(stored)
  const seededFrom = useRef(storedKey)
  const dirty = JSON.stringify(draft) !== storedKey
  useEffect(() => {
    if (seededFrom.current === storedKey) return
    const previous = seededFrom.current
    seededFrom.current = storedKey
    setDraft((current) => (JSON.stringify(current) === previous ? stored : current))
  }, [storedKey, stored])

  const health = summarizeMailboxHealth(mailbox.health, mailbox.timezone, nowMs)
  const needsReconnect = mailbox.status === 'reconnect_required' || mailbox.status === 'disconnected'
  const capCheck = validateDailyCap(draft.dailyCap === '' ? Number.NaN : Number(draft.dailyCap))
  const windowCheck = validateSendWindow(draft.window)
  const nameCheck = validateDisplayName(draft.displayName)
  const timezoneValid = isValidTimezone(draft.timezone)
  const invalid =
    typeof capCheck !== 'number' || !('days' in windowCheck) || typeof nameCheck !== 'string' || !timezoneValid
  const todayLimit = outreachEffectiveDailyCap(
    {
      dailyCap: typeof capCheck === 'number' ? capCheck : mailbox.dailyCap,
      // A ramp switched on in the draft reads as starting today.
      rampStartedAtMs: draft.warmUp ? (mailbox.rampStartedAtMs ?? nowMs) : null,
      timezone: timezoneValid ? draft.timezone : mailbox.timezone,
    },
    nowMs,
  )

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await api.saveSettings({
        mailboxId: mailbox.id,
        ...(draft.sendAs !== stored.sendAs ? { sendAs: draft.sendAs } : {}),
        ...(draft.displayName !== stored.displayName ? { displayName: draft.displayName } : {}),
        ...(draft.dailyCap !== stored.dailyCap ? { dailyCap: Number(draft.dailyCap) } : {}),
        ...(JSON.stringify(draft.window) !== JSON.stringify(stored.window) ? { window: draft.window } : {}),
        ...(draft.timezone !== stored.timezone ? { timezone: draft.timezone } : {}),
        ...(draft.warmUp !== stored.warmUp ? { warmUp: draft.warmUp } : {}),
      })
      enqueueSnackbar('Mailbox settings saved', { variant: 'success' })
    } catch (error) {
      setSaveError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const togglePaused = async () => {
    const paused = mailbox.status !== 'paused'
    setBusy('status')
    try {
      await api.setPaused(mailbox.id, paused)
      enqueueSnackbar(paused ? 'Mailbox paused' : 'Mailbox resumed', { variant: 'success' })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(null)
    }
  }

  const sendTest = async () => {
    setBusy('test')
    try {
      const to = testAddress.trim()
      const sent = await api.sendTest(mailbox.id, to || undefined)
      enqueueSnackbar(
        to
          ? `Test sent to ${sent.sentTo}. Its original source shows whether the sender authenticated.`
          : `Test sent to ${sent.sentTo}. Check your inbox.`,
        { variant: 'success' },
      )
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect this mailbox?',
      description:
        'Disconnecting deletes the access stored for this mailbox and asks Google to revoke it. ' +
        'Nothing is sent from it again unless it is connected again.',
      confirmationText: MAILBOX_ACTION_LABELS.disconnect,
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy('disconnect')
    try {
      const { revocation } = await api.disconnect(mailbox.id)
      if (revocation === 'failed') {
        enqueueSnackbar(
          'Mailbox disconnected, but Google could not confirm the access was revoked. ' +
            'Remove it from the Google Account’s third-party connections to be sure.',
          { variant: 'warning', persist: true },
        )
      } else if (revocation === 'kept-for-other-mailbox') {
        enqueueSnackbar(
          'Mailbox disconnected. Google access stays in place for another connected mailbox on the same account.',
          { variant: 'success' },
        )
      } else {
        enqueueSnackbar('Mailbox disconnected', { variant: 'success' })
      }
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
      setBusy(null)
    }
  }

  const sendAsLabel = (email: string) => {
    const option = mailbox.sendAsOptions?.find((entry) => entry.email === email)
    return option?.displayName ? `${option.displayName} <${option.email}>` : email
  }

  return (
    <CardDisplay
      header={mailbox.email}
      subheader={isMine ? 'Your mailbox' : 'A teammate’s mailbox'}
      help={pluginDocsHelp('sequences', { anchor: '#connect-a-mailbox' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Chip
            size="small"
            label={OUTREACH_MAILBOX_STATUS_LABELS[mailbox.status] ?? mailbox.status}
            color={STATUS_COLOR[mailbox.status] ?? 'default'}
          />
        ),
      }}
    >
      <Stack spacing={2}>
        {needsReconnect ? (
          <Alert
            severity="warning"
            action={
              isMine ? (
                <Button color="inherit" size="small" disabled={reconnecting} onClick={onReconnect}>
                  {MAILBOX_ACTION_LABELS.reconnect}
                </Button>
              ) : undefined
            }
          >
            {`${
              mailbox.status === 'disconnected'
                ? 'This mailbox was disconnected.'
                : 'Google stopped accepting this mailbox’s connection.'
            } ${
              isMine
                ? 'Nothing sends from it until you connect it again.'
                : 'Only the member who connected it can reconnect it.'
            }`}
          </Alert>
        ) : null}
        {mailbox.status === 'paused' && mailbox.autoPause ? (
          <Alert severity="error" role="alert">
            {autoPauseSentence(mailbox)}
          </Alert>
        ) : null}

        <Box>
          <Typography variant="subtitle2">Last 7 days</Typography>
          {health.hasSent ? null : (
            <Typography variant="body2" color="text.secondary">
              No sends yet
            </Typography>
          )}
          <Stack direction="row" spacing={3} sx={{ mt: 0.5 }}>
            {[
              ['Sent', health.sent],
              ['Bounces', health.bounces],
              ['Replies', health.replies],
            ].map(([label, value]) => (
              <Box key={label as string} aria-label={`${label} in the last 7 days`}>
                <Typography variant="h6" component="p">
                  {value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>

        {canManage ? (
          <Stack spacing={2} component="form" onSubmit={(event) => event.preventDefault()}>
            <TextField
              select
              size="small"
              label="Send as"
              value={draft.sendAs}
              onChange={(event) => setDraft({ ...draft, sendAs: event.target.value })}
              helperText="Addresses Gmail has verified for this account."
            >
              {(mailbox.sendAsOptions?.length ? mailbox.sendAsOptions : [{ email: mailbox.sendAs }]).map((option) => (
                <MenuItem key={option.email} value={option.email}>
                  {sendAsLabel(option.email)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Display name"
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              error={typeof nameCheck !== 'string'}
              helperText={typeof nameCheck !== 'string' ? nameCheck.message : 'The name recipients see beside the address.'}
            />
            <TextField
              size="small"
              type="number"
              label="Daily cap"
              value={draft.dailyCap}
              onChange={(event) => setDraft({ ...draft, dailyCap: event.target.value })}
              error={typeof capCheck !== 'number'}
              slotProps={{ htmlInput: { min: 1, max: OUTREACH_MAX_DAILY_CAP, step: 1 } }}
              helperText={
                typeof capCheck !== 'number'
                  ? capCheck.message
                  : draft.warmUp
                    ? `${RAMP_SENTENCE} Today’s limit: ${todayLimit}.`
                    : `No warm-up: today’s limit is the cap, ${todayLimit}.`
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={draft.warmUp}
                  onChange={(event) => setDraft({ ...draft, warmUp: event.target.checked })}
                />
              }
              label={MAILBOX_ACTION_LABELS.warmUp}
            />
            <FormHelperText sx={{ mt: -1 }}>
              {'For a mailbox that is new or has not sent much. One that has sent mail for years already has ' +
                'its reputation and can start at its cap.'}
            </FormHelperText>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Sending window
              </Typography>
              <ToggleButtonGroup
                size="small"
                aria-label="Sending days"
                value={draft.window.days}
                onChange={(_event, days: number[]) =>
                  setDraft({ ...draft, window: { ...draft.window, days: [...days].sort((a, b) => a - b) } })
                }
              >
                {OUTREACH_WEEKDAY_LABELS.map((label, day) => (
                  <ToggleButton key={label} value={day} aria-label={WEEKDAY_NAMES[day]}>
                    {label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
                <TextField
                  select
                  size="small"
                  label="From"
                  value={draft.window.startMinute}
                  onChange={(event) =>
                    setDraft({ ...draft, window: { ...draft.window, startMinute: Number(event.target.value) } })
                  }
                >
                  {MINUTE_OPTIONS.slice(0, -1).map((minute) => (
                    <MenuItem key={minute} value={minute}>
                      {formatMinuteOfDay(minute)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Until"
                  value={draft.window.endMinute}
                  onChange={(event) =>
                    setDraft({ ...draft, window: { ...draft.window, endMinute: Number(event.target.value) } })
                  }
                >
                  {MINUTE_OPTIONS.slice(1).map((minute) => (
                    <MenuItem key={minute} value={minute}>
                      {formatMinuteOfDay(minute)}
                    </MenuItem>
                  ))}
                </TextField>
                <Autocomplete
                  size="small"
                  disableClearable
                  options={timezoneOptions(mailbox.timezone)}
                  value={draft.timezone}
                  onChange={(_event, timezone) => setDraft({ ...draft, timezone: timezone ?? draft.timezone })}
                  sx={{ minWidth: 240 }}
                  renderInput={(params) => <TextField {...params} label="Timezone" />}
                />
              </Stack>
              {'days' in windowCheck ? null : <FormHelperText error>{windowCheck.message}</FormHelperText>}
            </Box>
            {saveError ? <FormHelperText error>{saveError}</FormHelperText> : null}
            <Box>
              <Button variant="contained" disabled={!dirty || invalid || saving} onClick={() => void save()}>
                {MAILBOX_ACTION_LABELS.save}
              </Button>
            </Box>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {`Sends as ${sendAsLabel(stored.sendAs)}, at most ${stored.dailyCap} a day, ` +
              `${stored.window.days.map((day) => OUTREACH_WEEKDAY_LABELS[day]).join(', ')} ` +
              `${formatMinuteOfDay(stored.window.startMinute)}–${formatMinuteOfDay(stored.window.endMinute)} ` +
              `(${stored.timezone}).`}
          </Typography>
        )}

        {isMine && !needsReconnect ? (
          <TextField
            label={MAILBOX_ACTION_LABELS.testAddress}
            value={testAddress}
            onChange={(event) => setTestAddress(event.target.value)}
            disabled={busy !== null}
            size="small"
            type="email"
            helperText={
              'Leave empty to send the test to yourself. A test to an outside mailbox you can ' +
              'read is the only one whose original source shows the sender authentication results.'
            }
            fullWidth
          />
        ) : null}

        {canManage || isMine ? (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {canManage && !needsReconnect ? (
              <Button variant="outlined" disabled={busy !== null} onClick={() => void togglePaused()}>
                {mailbox.status === 'paused' ? MAILBOX_ACTION_LABELS.resume : MAILBOX_ACTION_LABELS.pause}
              </Button>
            ) : null}
            {isMine && !needsReconnect ? (
              <Button variant="outlined" disabled={busy !== null} onClick={() => void sendTest()}>
                {testAddress.trim() ? MAILBOX_ACTION_LABELS.testElsewhere : MAILBOX_ACTION_LABELS.test}
              </Button>
            ) : null}
            {canManage ? (
              <Button color="error" disabled={busy !== null} onClick={() => void disconnect()}>
                {MAILBOX_ACTION_LABELS.disconnect}
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
MailboxCard.displayName = 'MailboxCard'

export default MailboxCard
