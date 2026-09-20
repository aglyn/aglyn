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
  Alert,
  Button,
  Chip,
  type ChipProps,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'
import type {
  OutreachEnrollmentStatus,
  OutreachSequenceStatus,
  OutreachStopReason,
} from '../model/outreach.types'
import type { OutreachLoadStatus } from './use-outreach-data'

/**
 * The pieces every Outreach page shares (AGL-2980): the words for each
 * status, the states a read can be in, and a link that navigates inside the
 * console without reloading it.
 */

export const OUTREACH_SEQUENCE_STATUS_LABELS: Record<
  OutreachSequenceStatus,
  string
> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
}

const SEQUENCE_STATUS_COLORS: Record<
  OutreachSequenceStatus,
  ChipProps['color']
> = {
  draft: 'default',
  active: 'success',
  paused: 'warning',
  archived: 'default',
}

export const OUTREACH_ENROLLMENT_STATUS_LABELS: Record<
  OutreachEnrollmentStatus,
  string
> = {
  active: 'Active',
  paused: 'Paused',
  finished: 'Finished',
  replied: 'Replied',
  bounced: 'Bounced',
  opted_out: 'Opted out',
  stopped: 'Stopped',
  failed: 'Failed',
}

const ENROLLMENT_STATUS_COLORS: Record<
  OutreachEnrollmentStatus,
  ChipProps['color']
> = {
  active: 'success',
  paused: 'warning',
  finished: 'default',
  replied: 'info',
  bounced: 'error',
  opted_out: 'default',
  stopped: 'default',
  failed: 'error',
}

/** Why an enrollment is not active, as the table says it. */
export const OUTREACH_STOP_REASON_LABELS: Record<OutreachStopReason, string> = {
  reply: 'They replied',
  hard_bounce: 'The address bounced',
  opt_out_reply: 'They asked not to be emailed',
  unsubscribe: 'They unsubscribed',
  do_not_contact: 'On the do-not-contact list',
  gate: 'No longer eligible',
  manual: 'By a member',
  sequence_archived: 'The sequence was archived',
  send_failed: "An email couldn't be sent",
}

export function OutreachSequenceStatusChip(props: {
  status: OutreachSequenceStatus
}) {
  return (
    <Chip
      size="small"
      label={OUTREACH_SEQUENCE_STATUS_LABELS[props.status]}
      color={SEQUENCE_STATUS_COLORS[props.status]}
      variant={props.status === 'archived' ? 'outlined' : 'filled'}
    />
  )
}

export function OutreachEnrollmentStatusChip(props: {
  status: OutreachEnrollmentStatus
}) {
  return (
    <Chip
      size="small"
      label={OUTREACH_ENROLLMENT_STATUS_LABELS[props.status]}
      color={ENROLLMENT_STATUS_COLORS[props.status]}
    />
  )
}

/** Progress for a read still on its way. */
export function OutreachLoading(props: { label: string }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', py: 2 }}
      role="status"
    >
      <CircularProgress size={18} />
      <Typography variant="body2" color="text.secondary">
        {props.label}
      </Typography>
    </Stack>
  )
}

/** The words a refused read shows when the route gave none of its own. */
export const OUTREACH_REFUSED_MESSAGE =
  "You don't have access to this in Sequences. Ask an organization owner or admin for the Use Sequences permission."

/**
 * What a failed or refused read shows. A refusal is a statement about the
 * reader, not a fault, so it reads as information and offers no retry.
 */
export function OutreachLoadProblem(props: {
  status: Extract<OutreachLoadStatus, 'error' | 'refused'>
  /** What could not be read, for the error sentence. */
  what: string
  message?: string | null
  onRetry?: () => void
}) {
  if (props.status === 'refused') {
    return (
      <Alert severity="info">{props.message || OUTREACH_REFUSED_MESSAGE}</Alert>
    )
  }
  return (
    <Alert
      severity="error"
      action={
        props.onRetry ? (
          <Button color="inherit" size="small" onClick={props.onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {props.message ||
        `The ${props.what} could not be loaded. Reload the page to try again.`}
    </Alert>
  )
}

/** Navigation inside the console, without reloading it. */
export function useOutreachNavigate(): (href: string) => void {
  const router = useRouter()
  return (href: string) => router.push(href)
}

/**
 * A link inside the console: a real anchor, so it opens in a new tab when
 * asked to, and a client navigation otherwise.
 */
export function OutreachLink(props: {
  href: string
  children: ReactNode
  underline?: 'hover' | 'always' | 'none'
}) {
  const navigate = useOutreachNavigate()
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    navigate(props.href)
  }
  return (
    <Link
      href={props.href}
      onClick={onClick}
      underline={props.underline ?? 'hover'}
    >
      {props.children}
    </Link>
  )
}

/**
 * A moment as a reader in `timeZone` reads it — "Sep 22, 9:14 AM CDT" — or
 * in the reader's own zone when none is known.
 */
export function formatOutreachTime(
  ms: number | null | undefined,
  timeZone?: string | null,
): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      ...options,
      ...(timeZone ? { timeZone } : {}),
    }).format(ms)
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(ms)
  }
}
