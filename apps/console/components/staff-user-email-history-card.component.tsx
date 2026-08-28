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
// From the subpath, never the barrel (AGL-1151): `ListTable` wraps MUI X
// DataGrid, and the barrel is imported by the tenant runtime — exporting it
// there put ~257 KB of virtualizer into every published customer page.
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { Alert, Chip, Stack, Typography } from '@mui/material'
import { type GridColDef } from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import StaffEmailMessageDialog from './staff-email-message-dialog.component'

/** One message, as the staff detail route returns it. */
export interface StaffEmailDeliveryRow {
  messageId: string
  provider: string
  to: string
  subject: string | null
  context: string | null
  status: string
  timestamps: Record<string, number | undefined>
  firstSeenAtMs: number
  openCount: number
  clickCount: number
  clickedLinks: string[]
  bounceType: string | null
  detail: string | null
  hostId: string | null
  campaignId: string | null
}

export interface StaffUserEmailHistoryCardProps {
  rows: StaffEmailDeliveryRow[]
  /**
   * The read failed. NOT the same as an empty list — see the copy below,
   * which is the whole reason the two are kept apart.
   */
  lookupFailed: boolean
  /** The address the history is filed under, shown so a mismatch is visible. */
  address: string | null
}

/**
 * How a status reads, and how alarming it should look.
 *
 * `complained` is an error rather than a warning on purpose: somebody pressed
 * "report spam", which is the most consequential thing that can happen to a
 * message and the thing a staffer must not scroll past.
 */
const STATUS_PRESENTATION: Record<
  string,
  { label: string; color: 'default' | 'success' | 'warning' | 'error' }
> = {
  sent: { label: 'Sent', color: 'default' },
  delivered: { label: 'Delivered', color: 'success' },
  opened: { label: 'Opened', color: 'success' },
  clicked: { label: 'Clicked', color: 'success' },
  delayed: { label: 'Delayed', color: 'warning' },
  bounced: { label: 'Bounced', color: 'error' },
  complained: { label: 'Spam complaint', color: 'error' },
  failed: { label: 'Failed', color: 'error' },
}

/** Date AND time: two sends on one day is the interesting case. */
function formatWhen(ms: number | null | undefined): string {
  if (!ms) return 'Unknown'
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return 'Unknown'
  }
}

/**
 * WHAT WE SENT THIS PERSON, AND WHAT THEY DID WITH IT.
 *
 * ## The question this answers
 *
 * "They say they never got the invite." Until this card the only way to check
 * was to sign in to the sending provider and search a global list that is not
 * scoped to the account on screen — so the answer took a second tool, a second
 * login, and a guess about which of several similar subjects belonged to this
 * person.
 *
 * ## It reads OUR log, not the provider
 *
 * The rows come from `emailDeliveries/{emailKey}/messages`, written from
 * normalized delivery events. Nothing here knows which provider sent the mail;
 * `provider` is a value in a row, not a branch in the code. That is deliberate
 * — see `email-delivery-log.ts` — and it is why this card keeps working
 * through a change of sender, and keeps showing history the vendor's own
 * retention window has already dropped.
 *
 * ## The empty state says why it might be empty
 *
 * A delivery log only knows what its event feed told it. Mail sent before the
 * feed existed, or while it was down, is simply absent — and a staffer who
 * reads a blank table as "we never emailed them" will tell a customer
 * something untrue. The empty copy therefore names the limit rather than
 * implying completeness.
 */
export function StaffUserEmailHistoryCard({
  rows,
  lookupFailed,
  address,
}: StaffUserEmailHistoryCardProps) {
  const [open, setOpen] = useState<StaffEmailDeliveryRow | null>(null)

  /*
   * `$id` because that is the id `ListTable` reads (`getRowId={row => row.$id}`),
   * and the original row is carried through as `record` so the dialog gets the
   * whole thing rather than the flattened cells the grid renders.
   */
  const gridRows = useMemo(
    () =>
      rows.map((row) => ({
        $id: row.messageId,
        record: row,
        subject: row.subject || 'No subject recorded',
        context: row.context,
        sentAtMs: row.timestamps?.sent ?? row.firstSeenAtMs,
        status: row.status,
        openCount: row.openCount,
        clickCount: row.clickCount,
      })),
    [rows],
  )

  /*
   * Every cell is ONE LINE, and the numeric columns are right-aligned.
   *
   * The first version stacked the subject over its sender label inside the
   * cell, which forced the grid's row height up and left the table looking
   * loose beside every other list in the console. A sender is a value like
   * any other and belongs in a column of its own, where it also sorts and
   * filters — which it could not do buried in a render function.
   */
  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'subject',
        headerName: 'Message',
        flex: 3,
        minWidth: 240,
        // `title` rather than a tooltip component: a subject is truncated by
        // the column, and the browser's own affordance costs nothing and
        // survives a row the grid virtualized away.
        renderCell: (params) => (
          <Typography variant="body2" noWrap title={params.row.subject}>
            {params.row.subject}
          </Typography>
        ),
      },
      {
        field: 'context',
        headerName: 'Sender',
        width: 170,
        renderCell: (params) =>
          params.row.context ? (
            <Chip size="small" variant="outlined" label={params.row.context} />
          ) : (
            // An imported row carries none: the provider's history has no
            // tags, so we know what was sent and not which sender produced it.
            <Typography variant="caption" color="text.secondary">
              {'—'}
            </Typography>
          ),
      },
      {
        field: 'sentAtMs',
        headerName: 'Sent',
        width: 190,
        // A NUMBER in the row and a string only at render, so the column sorts
        // chronologically rather than alphabetically — a formatted string
        // would put "Aug" before "Dec" before "Jan".
        renderCell: (params) => (
          <Typography variant="body2" noWrap>
            {formatWhen(params.row.sentAtMs)}
          </Typography>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        renderCell: (params) => {
          const presentation = STATUS_PRESENTATION[params.row.status] ?? {
            label: params.row.status,
            color: 'default' as const,
          }
          return (
            <Chip
              size="small"
              color={presentation.color}
              label={presentation.label}
            />
          )
        },
      },
      // `type: 'number'` alone right-aligns the CELL and leaves the header
      // left, which reads as a misalignment rather than as a number column.
      {
        field: 'openCount',
        headerName: 'Opens',
        width: 90,
        type: 'number',
        align: 'right',
        headerAlign: 'right',
      },
      {
        field: 'clickCount',
        headerName: 'Clicks',
        width: 90,
        type: 'number',
        align: 'right',
        headerAlign: 'right',
      },
    ],
    [],
  )

  const help = docsHelp('staffConsole', {
    anchor: '#email-delivery',
    excerpt:
      'Every message we sent this address, whether it was delivered, and ' +
      'whether it was opened or clicked — read from our own delivery log ' +
      'rather than from the sending provider.',
  })

  return (
    <CardDisplay
      header="Email delivery"
      help={help}
      contentGutterX
      contentGutterY
    >
      {lookupFailed ? (
        <Alert severity="warning">
          {'The delivery log could not be read. This is NOT the same as "we ' +
            'never emailed them" — do not tell anyone their mail was or was ' +
            'not sent from this screen until it loads.'}
        </Alert>
      ) : rows.length === 0 ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {address
              ? `No delivery events recorded for ${address}.`
              : 'This account has no email address, so there is nothing to record.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'The log holds what the delivery feed reported. Mail sent before ' +
              'that feed was connected, or while it was down, does not appear ' +
              'here — an empty table is not proof that nothing was sent.'}
          </Typography>
        </Stack>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {'Newest first. Open a row to read the message and see which links ' +
              'were followed. Opens are approximate — an inbox that blocks ' +
              'images never reports one, so a missing open is not evidence ' +
              'the mail was unread. A click is a real action and is reliable.'}
          </Typography>
          <ListTable
            rows={gridRows}
            columns={columns}
            /*
             * One line per row. The grid's default 52px is sized for stacked
             * cells; every cell here is a single line, and at the default the
             * rows read as padded rather than as a table.
             */
            rowHeight={44}
            columnHeaderHeight={44}
            onOpen={(_id, row) => setOpen(row.record as StaffEmailDeliveryRow)}
          />
          {/*
            * Mounted only while a row is open. The dialog reads the signed-in
            * user and fetches a message body on mount, and rendering it
            * closed put that hook — and an error boundary's worth of failure
            * surface — behind every card that merely LISTS mail.
            */}
          {open ? (
            <StaffEmailMessageDialog row={open} onClose={() => setOpen(null)} />
          ) : null}
        </>
      )}
    </CardDisplay>
  )
}

export default StaffUserEmailHistoryCard
