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

import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { OUTREACH_MAILBOX_STATUS_LABELS } from '../mailboxes/mailbox-settings'
import type { OutreachMailbox } from '../model/outreach.types'
import { outreachMailboxActivationIssue } from '../model/sequence-draft'
import { OutreachLink } from './outreach-ui'
import { useOutreachMailboxApi } from './use-outreach-mailbox-api'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'

export interface OutreachSequenceMailboxPickerProps {
  orgId: string
  /** The member choosing, whose own mailboxes are offered. */
  uid: string | null
  /** The organization's mailboxes, from the Mailboxes section's own listener. */
  mailboxes: OutreachMailboxesResult
  /** The Mailboxes section, where a mailbox is connected, resumed or reconnected. */
  mailboxesPath: string
  value: string
  onChange(mailboxId: string): void
  error?: string
  disabled?: boolean
}

/** A mailbox as its line in the menu reads: who mail is from, and any status that stops it sending. */
export function outreachMailboxOptionLabel(mailbox: OutreachMailbox): string {
  const address = mailbox.sendAs || mailbox.email
  const name = mailbox.displayName?.trim()
  const from = name ? `${name} <${address}>` : address
  return mailbox.status === 'connected'
    ? from
    : `${from} — ${OUTREACH_MAILBOX_STATUS_LABELS[mailbox.status] ?? mailbox.status}`
}

/**
 * The mailboxes a member may choose for a sequence: their own, or every
 * one for an organization owner or admin — the two the save route lets
 * send from a mailbox — never a disconnected one. The mailbox a sequence
 * already names stays in the list whoever connected it, so the field never
 * reads as empty.
 */
export function outreachOfferedMailboxes(
  mailboxes: readonly OutreachMailbox[],
  input: { uid: string | null; canManageAll: boolean; value: string },
): OutreachMailbox[] {
  return mailboxes.filter(
    (mailbox) =>
      mailbox.id === input.value ||
      (mailbox.status !== 'disconnected' &&
        (input.canManageAll || (input.uid !== null && mailbox.connectedByUid === input.uid))),
  )
}

/**
 * The mailbox a sequence sends from (AGL-2980), chosen from the Mailboxes
 * section's own listener and route (AGL-2978).
 *
 * Whether the member may choose a colleague's mailbox is the mailbox
 * routes' answer (`availability().canManageAll`); until it arrives, or when
 * it cannot be had, the member is offered their own, which is always
 * allowed. A chosen mailbox that is paused or waiting to be reconnected can
 * hold a draft, and the field says what activating will need.
 */
export function OutreachSequenceMailboxPicker(props: OutreachSequenceMailboxPickerProps) {
  const { mailboxes, uid, value } = props
  const api = useOutreachMailboxApi(props.orgId)
  const [canManageAll, setCanManageAll] = useState(false)

  useEffect(() => {
    let current = true
    api
      .availability()
      .then((answer) => {
        if (current) setCanManageAll(answer.canManageAll)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [api])

  if (mailboxes.status === 'loading') {
    return <TextField label="Mailbox" value="" disabled helperText="Loading mailboxes…" fullWidth />
  }
  if (mailboxes.status === 'error') {
    return (
      <Alert severity="error">The mailboxes could not be loaded. Reload the page to try again.</Alert>
    )
  }

  const offered = outreachOfferedMailboxes(mailboxes.mailboxes, { uid, canManageAll, value })
  if (!offered.length) {
    return (
      <Stack spacing={0.5}>
        <Typography variant="subtitle2" component="p">
          Mailbox
        </Typography>
        <Typography variant="body2" color="text.secondary">
          A sequence sends from your own connected mailbox, and you haven’t connected one yet.
        </Typography>
        <Typography variant="body2">
          <OutreachLink href={props.mailboxesPath}>Connect a mailbox in Mailboxes</OutreachLink>
        </Typography>
        {props.error ? (
          <Typography variant="body2" color="error">
            {props.error}
          </Typography>
        ) : null}
      </Stack>
    )
  }

  const chosen = offered.find((mailbox) => mailbox.id === value) ?? null
  // A chosen mailbox that cannot send, or one that no longer exists, says
  // what activating the sequence will need.
  const standing = value ? outreachMailboxActivationIssue(value, chosen) : null
  return (
    <TextField
      select
      label="Mailbox"
      value={chosen ? value : ''}
      onChange={(event) => props.onChange(event.target.value)}
      disabled={props.disabled}
      error={Boolean(props.error)}
      helperText={
        props.error ??
        standing?.message ??
        'Every email in the sequence is sent from it, in its sending hours and timezone.'
      }
      fullWidth
    >
      {offered.map((mailbox) => (
        <MenuItem key={mailbox.id} value={mailbox.id}>
          {outreachMailboxOptionLabel(mailbox)}
        </MenuItem>
      ))}
    </TextField>
  )
}
OutreachSequenceMailboxPicker.displayName = 'OutreachSequenceMailboxPicker'

export default OutreachSequenceMailboxPicker
