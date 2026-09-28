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

import { Tooltip, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { OutreachNextSendState, OutreachQueuedReason } from '../engine/next-send'
import { isOutreachWindowOpen } from '../engine/schedule'
import { OUTREACH_TICK_MINUTES, outreachTickAllowance } from '../engine/sending-capacity'
import type { OutreachMailbox } from '../model/outreach.types'
import { formatOutreachTime } from './outreach-ui'

/*
 * The words for an enrollment's next send (AGL-3366): a time while it is
 * still ahead, and once it has come, the queue it is waiting in — short in
 * the cell, whole in the tooltip, which also keeps the exact due time.
 */

const QUEUED_LABELS: Record<OutreachQueuedReason, string> = {
  paced: 'Queued · paced',
  next_run: 'Queued · next run',
  window_closed: 'Queued · window closed',
  daily_cap_reached: 'Queued · cap reached',
  mailbox_not_sending: 'Held · mailbox not sending',
  sequence_not_active: 'Held · sequence not active',
}

/**
 * The clock next sends are judged against, moved on every minute so a row
 * turns from its time to "Queued" while the page stays open.
 */
export function useOutreachNowMs(everyMs = 60_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return nowMs
}

/** What the cell, the chip and the export say. */
export function outreachNextSendLabel(state: OutreachNextSendState, timeZone: string | null): string {
  if (state.kind === 'none') return '—'
  if (state.kind === 'scheduled') return formatOutreachTime(state.dueAtMs, timeZone)
  return QUEUED_LABELS[state.reason]
}

/** The whole explanation of a queued send; `''` for one that is not queued. */
export function outreachNextSendDetail(state: OutreachNextSendState, timeZone: string | null): string {
  if (state.kind !== 'queued') return ''
  const time = (ms: number | null) => formatOutreachTime(ms, timeZone)
  const due = `Due ${time(state.dueAtMs)}.`
  const pacing = state.pacing
    ? ` This mailbox has sent ${state.pacing.sentToday} of ${state.pacing.dailyCap} today` +
      (state.reason === 'paced' ? ` and may send ${state.pacing.allowance} in this run.` : '.')
    : ''
  switch (state.reason) {
    case 'paced':
      return (
        `${due} Emails go out a few at a time every ${OUTREACH_TICK_MINUTES} minutes, ` +
        'follow-ups first, so the day’s cap is spread across the send window rather than ' +
        `sent at once. This one goes out in a later run.${pacing}`
      )
    case 'next_run':
      return `${due} The task is created on the next run, within ${OUTREACH_TICK_MINUTES} minutes.`
    case 'window_closed':
      return `${due} The send window is closed; it goes out once the window opens${
        state.opensAtMs ? `, ${time(state.opensAtMs)}` : ''
      }.${pacing}`
    case 'daily_cap_reached':
      return `${due}${pacing} Sending resumes${
        state.opensAtMs ? ` ${time(state.opensAtMs)}` : ' in the next window'
      }.`
    case 'mailbox_not_sending':
      return `${due} Its mailbox is not sending, so nothing goes out until it is connected and resumed.`
    case 'sequence_not_active':
      return `${due} The sequence is not active, so nothing goes out until it is activated.`
  }
}

/**
 * The Mailboxes card's one line on pacing: what has gone today against the
 * cap, and how much the next run may send — the number a due enrollment's
 * "Queued" is waiting on.
 */
export function outreachPacingNote(
  mailbox: Pick<
    OutreachMailbox,
    'status' | 'dailyCap' | 'rampStartedAtMs' | 'timezone' | 'window' | 'health'
  >,
  nowMs: number,
): string {
  const tick = outreachTickAllowance({ mailbox, nowMs })
  if (tick.hold === 'mailbox_not_connected' || tick.hold === 'invalid_timezone') {
    return 'Sends nothing until it is connected and sending.'
  }
  const today = `Today: ${tick.sentToday} of ${tick.dailyCap} sent`
  if (tick.hold === 'daily_cap_reached') return `${today} · cap reached, sending resumes in the next day’s window.`
  if (!isOutreachWindowOpen(nowMs, mailbox.window, mailbox.timezone)) {
    return `${today} · outside its send window.`
  }
  return (
    `${today} · up to ${tick.allowance} per ${OUTREACH_TICK_MINUTES}-minute run now, ` +
    'follow-ups first, so the rest of the day’s cap is spread across the window.'
  )
}

/** An enrollment's next send, with the reason on hover when it is queued. */
export function OutreachNextSend(props: { state: OutreachNextSendState; timeZone: string | null }) {
  const { state, timeZone } = props
  const label = outreachNextSendLabel(state, timeZone)
  if (state.kind !== 'queued') {
    return (
      <Typography variant="body2" color={state.kind === 'none' ? 'text.secondary' : undefined}>
        {label}
      </Typography>
    )
  }
  return (
    <Tooltip title={outreachNextSendDetail(state, timeZone)} describeChild>
      <Typography
        variant="body2"
        color={
          state.reason === 'mailbox_not_sending' || state.reason === 'sequence_not_active'
            ? 'warning.main'
            : 'text.secondary'
        }
        sx={{ textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'help' }}
      >
        {label}
      </Typography>
    </Tooltip>
  )
}
