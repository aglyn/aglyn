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

/** One address the history was gathered from. */
export interface StaffEmailAddress {
  address: string
  /** `primary` | `provider` | `stored` — why this address is listed. */
  sources: string[]
  /** Another account holds this address too. */
  shared: boolean
  /** A provider asserted it, but another account already held the claim. */
  indexConflict: boolean
}

export interface StaffUserEmailHistoryCardProps {
  rows: StaffEmailDeliveryRow[]
  /**
   * The read failed. NOT the same as an empty list — see the copy below,
   * which is the whole reason the two are kept apart.
   */
  lookupFailed: boolean
  /** The account's current primary, shown so a mismatch is visible. */
  address: string | null
  /**
   * EVERY address the rows were gathered from.
   *
   * The log is keyed by `sha256(address)`, so a changed primary used to leave
   * the history unreachable under the old hash and this card rendered a blank
   * table for a person we demonstrably emailed.
   */
  addresses?: StaffEmailAddress[]
  /** A source was unreadable, so the address list may be short. */
  addressesIncomplete?: boolean
  /** Addresses whose records were destroyed under an erasure request. */
  erasures?: Record<string, { at: number; count: number }>
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
  addresses = [],
  addressesIncomplete = false,
  erasures = {},
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
          // `width: '100%'` so `noWrap` has a box to truncate against: inside
          // a flex cell the paragraph shrink-wraps its text and the ellipsis
          // never appears.
          <Typography
            variant="body2"
            noWrap
            title={params.row.subject}
            sx={{ width: '100%' }}
          >
            {params.row.subject}
          </Typography>
        ),
      },
      {
        field: 'context',
        headerName: 'Sender',
        width: 170,
        // An imported row carries no sender: the provider's history has no
        // tags, so we know what was sent and not which of our senders produced
        // it. Rendered by the grid as a plain value, which also keeps it
        // sortable and filterable.
        valueFormatter: (value: string | null) => value || '—',
        renderCell: (params) =>
          params.row.context ? (
            <Chip size="small" variant="outlined" label={params.row.context} />
          ) : (
            '—'
          ),
      },
      {
        field: 'sentAtMs',
        headerName: 'Sent',
        width: 190,
        // A NUMBER in the row and a string only at display, so the column
        // sorts chronologically rather than alphabetically — a formatted
        // string would put "Aug" before "Dec" before "Jan".
        //
        // `valueFormatter`, NOT `renderCell`: a formatter leaves the grid to
        // draw the text, which is what makes it sit on the same line as every
        // other plain cell. A custom node opts out of that and has to
        // reproduce the centering itself.
        valueFormatter: (value: number) => formatWhen(value),
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

  /*
   * WHICH ADDRESSES THESE ROWS CAME FROM.
   *
   * Rendered above the table rather than folded into a column, because it is
   * a statement about the QUERY and not about any one row: a staffer has to
   * be able to see that mail sent to a former address is included, and that
   * an address is one another account also holds.
   */
  /*
   * FALL BACK TO THE PRIMARY when no list was supplied.
   *
   * A caller that passes only `address` is still describing an account with
   * one address, and the empty state has to say "no delivery events recorded
   * for <it>" rather than "this account has no email address" — the second is
   * a different claim, and a false one.
   */
  const listed =
    addresses.length > 0
      ? addresses
      : address
        ? [
            {
              address,
              sources: ['primary'],
              shared: false,
              indexConflict: false,
            },
          ]
        : []
  const secondary = listed.filter((entry) => entry.address !== address)
  const sharedAddresses = listed.filter((entry) => entry.shared)
  const conflicted = listed.filter((entry) => entry.indexConflict)
  const erased = Object.entries(erasures)

  return (
    <CardDisplay
      header="Email delivery"
      help={help}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1} sx={{ mb: 2 }}>
        {secondary.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {`Includes mail to ${secondary
              .map((entry) => entry.address)
              .join(', ')} — ${
              secondary.length === 1 ? 'an address' : 'addresses'
            } this account also holds, but not its current primary.`}
          </Typography>
        )}
        {addressesIncomplete && (
          <Alert severity="warning">
            {'One source of this account’s addresses could not be read, so ' +
              'this list may be short. Mail to an address missing from it ' +
              'would not appear here.'}
          </Alert>
        )}
        {sharedAddresses.length > 0 && (
          <Alert severity="info">
            {`Another account also holds ${sharedAddresses
              .map((entry) => entry.address)
              .join(', ')}. The delivery log records that mail reached a ` +
              'MAILBOX, so it cannot say which account a message was for — ' +
              'these rows appear on both accounts and belong to neither ' +
              'exclusively.'}
          </Alert>
        )}
        {conflicted.length > 0 && (
          <Alert severity="warning">
            {`A sign-in provider asserts ${conflicted
              .map((entry) => entry.address)
              .join(', ')} for this account, but another account already ` +
              'holds that address. The claim was refused and nothing was ' +
              'reassigned — two accounts sharing one identity needs a human ' +
              'decision.'}
          </Alert>
        )}
        {erased.map(([erasedAddress, record]) => (
          <Alert severity="info" key={erasedAddress}>
            {`Delivery records for ${erasedAddress} were removed under an ` +
              `erasure request on ${formatWhen(record.at)}. ` +
              'The absence of rows below is that erasure, not evidence that ' +
              'no mail was sent.'}
          </Alert>
        ))}
      </Stack>
      {lookupFailed ? (
        <Alert severity="warning">
          {'The delivery log could not be read. This is NOT the same as "we ' +
            'never emailed them" — do not tell anyone their mail was or was ' +
            'not sent from this screen until it loads.'}
        </Alert>
      ) : rows.length === 0 ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {listed.length
              ? `No delivery events recorded for ${listed
                  .map((entry) => entry.address)
                  .join(', ')}.`
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
            /*
             * CENTRE EVERY CELL'S CONTENT.
             *
             * The grid centres a plain value it renders itself, and does not
             * centre a node returned from `renderCell` — it drops it in and
             * leaves the alignment to the node. So a row mixing the two put
             * its text on one line and its chips on another, by a few pixels,
             * which is exactly the kind of misalignment that reads as broken
             * without being nameable.
             *
             * Applied at the grid rather than per column so a column added
             * later cannot reintroduce it.
             */
            sx={{
              '& .MuiDataGrid-cell': {
                display: 'flex',
                alignItems: 'center',
              },
            }}
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
