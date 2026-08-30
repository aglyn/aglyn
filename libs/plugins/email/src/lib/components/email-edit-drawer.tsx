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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  Alert,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'

/** The most a display name may carry, matching the send route's own cap. */
const DISPLAY_NAME_MAX = 60

export interface EmailEditDrawerProps {
  open: boolean
  onClose: () => void
  /** Drawer heading. */
  title: string
  /** Label on the confirm button. */
  submitLabel: string
  /**
   * Which field the drawer collects.
   *
   * `details` edits the merchant's own name for the email; `schedule` picks
   * the time it should go out. They are one component because they are one
   * shape — a single field, a note saying what it does, and a submit — and
   * two files would be two chromes to keep in step.
   */
  field: 'details' | 'schedule'
  /** The name as stored, for `details`. */
  displayName?: string
  /** The send time as stored in epoch ms, for `schedule`. */
  sendAtMs?: number
  /** A line above the field explaining what this changes. */
  note?: string
  busy?: boolean
  onSubmit: (values: { displayName?: string; sendAtMs?: number }) => void
}

/**
 * The value a `datetime-local` input wants, from epoch ms.
 *
 * The input has no timezone of its own and reads whatever it is given as
 * local wall-clock time, so the offset has to come off before formatting —
 * `toISOString` would hand it UTC and the field would open showing a time
 * some hours from the one the email is actually scheduled for.
 */
function localInputValue(ms: number): string {
  if (!ms) return ''
  const at = new Date(ms)
  if (Number.isNaN(at.getTime())) return ''
  const offset = at.getTimezoneOffset() * 60_000
  return new Date(ms - offset).toISOString().slice(0, 16)
}

/**
 * EDITING ONE EMAIL, IN A DRAWER.
 *
 * A drawer and not a form above the page's content: editing a record happens
 * on the record's own surface in this console, and a list or a report with a
 * form sitting on top of it is the shape this page was built to stop.
 *
 * ## Why the name is the only detail on offer
 *
 * A sent email's subject, body, audience and topic describe mail that is
 * already in inboxes. Editing them here would leave the record disagreeing
 * with what was delivered — the report would be headed by a subject nobody
 * received, and the audience row would name a list the send never went to.
 * The display name is different in kind: it is console-only, it reaches no
 * recipient and no header, and it exists precisely so a merchant can find
 * "the one with the discount code" months later. So it stays editable for the
 * whole of an email's life, and nothing else does.
 *
 * An email that has NOT gone out has no such constraint, and its copy is
 * edited in the composer on the same page rather than here.
 */
export function EmailEditDrawer(props: EmailEditDrawerProps) {
  const {
    open,
    onClose,
    title,
    submitLabel,
    field,
    displayName,
    sendAtMs,
    note,
    busy,
    onSubmit,
  } = props

  const [name, setName] = useState('')
  const [sendAt, setSendAt] = useState('')

  /*
   * Re-seeded whenever the drawer opens rather than held from the last time.
   * The stored value arrives asynchronously and can change under a closed
   * drawer, so seeding once at mount would open it on a stale name.
   */
  useEffect(() => {
    if (!open) return
    setName(String(displayName ?? ''))
    setSendAt(localInputValue(Number(sendAtMs ?? 0)))
  }, [open, displayName, sendAtMs])

  const scheduledMs = sendAt ? new Date(sendAt).getTime() : 0
  const inThePast = Boolean(scheduledMs) && scheduledMs <= Date.now()
  const submittable =
    field === 'schedule'
      ? Boolean(scheduledMs) && !inThePast && !busy
      : name.trim().length > 0 && !busy

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {title}
          </Typography>
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          {note ? (
            <Typography variant="body2" color="text.secondary">
              {note}
            </Typography>
          ) : null}
          {field === 'details' ? (
            <TextField
              label="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              helperText={
                'Friendly name for internal reference. Never shown to a ' +
                'recipient, and never the subject line.'
              }
              slotProps={{ htmlInput: { maxLength: DISPLAY_NAME_MAX } }}
              fullWidth
            />
          ) : (
            <TextField
              type="datetime-local"
              label="Send at"
              value={sendAt}
              onChange={(event) => setSendAt(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          )}
          {inThePast ? (
            <Alert severity="warning">
              {'Pick a future send time. A time that has already passed ' +
                'would leave this email waiting for a moment that never ' +
                'comes.'}
            </Alert>
          ) : null}
          <Button
            variant="contained"
            disabled={!submittable}
            onClick={() =>
              onSubmit(
                field === 'schedule'
                  ? { sendAtMs: scheduledMs }
                  : { displayName: name.trim() },
              )
            }
          >
            {submitLabel}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
EmailEditDrawer.displayName = 'EmailEditDrawer'

export default EmailEditDrawer
