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
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import useStaffListPagination from '../hooks/use-staff-list-pagination'
import StaffListPaginationControls from './staff-list-pagination.component'

interface PlatformSuppression {
  $id: string
  email?: string
  reason?: string
  context?: string | null
  hostId?: string | null
  releasedAt?: unknown | null
  suppressedAt?: { seconds?: number } | null
  createdAt?: { seconds?: number } | null
}

const REASONS: Record<
  string,
  { label: string; color: 'default' | 'warning' | 'error' }
> = {
  bounce: { label: 'Bounced', color: 'warning' },
  complaint: { label: 'Marked as spam', color: 'error' },
  staff: { label: 'Recorded by staff', color: 'default' },
}

const describeReason = (reason: unknown) =>
  REASONS[String(reason ?? '')] ?? {
    label: String(reason ?? 'Unknown'),
    color: 'default' as const,
  }

function onDate(row: PlatformSuppression): string {
  const seconds = row.createdAt?.seconds ?? row.suppressedAt?.seconds
  if (!seconds) return '—'
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * THE PLATFORM-WIDE SUPPRESSION LIST, with a reader and a release.
 *
 * ## What was missing
 *
 * `emailSuppressions` is written by the Resend webhook on every permanent
 * bounce and every complaint, for every sender in the product — invites,
 * verification, receipts, the usage summary — and `listEmailSuppressions` and
 * `releaseEmail` were written to read and lift an entry and had **no callers
 * anywhere**. So an address could be suppressed platform-wide by a machine
 * and never seen or lifted by anybody.
 *
 * The failure that produces is the one support cannot answer: a customer
 * whose address landed here — a typo, a mailbox that was full at exactly the
 * wrong moment and reported permanent, a bounce from a corporate filter that
 * has since been fixed — stops receiving mail from the whole platform, and no
 * screen anywhere says why. This is that screen.
 *
 * ## Why a merchant does not get this control
 *
 * A merchant's own Suppressions card owns the PER-SITE list: a preference
 * about one sender's mail, theirs to add to and remove from. This list is
 * evidence about an ADDRESS, learned anywhere in the product and applying
 * everywhere in it — so lifting one is deciding, on behalf of every other
 * tenant on the shared sending domain, that a hard bounce or a spam report
 * should be mailed again. That is a platform act.
 *
 * ## Why the reason box is required
 *
 * A release is recorded in `adminAudit`, and a record saying only that
 * somebody did it answers half the question it is kept for. The refusal is on
 * the ROUTE as well as here — a disabled button is a courtesy, not a control.
 */
export default function StaffEmailSuppressionsCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [error, setError] = useState<string | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  /*
   * THE CONSOLE'S ONE CURSOR WALK, not a second one that resembles it.
   *
   * A list this long is a window over something that grows — one row per
   * address that has ever bounced permanently or reported spam anywhere in
   * the product — so a fixed read would hide whichever entries fell past it,
   * with nothing on screen to say so. That is the exact defect this list
   * exists to explain, and it would be a poor screen that reproduced it.
   */
  const pagination = useStaffListPagination<PlatformSuppression>({
    fetchPage: async (cursor, _pageIndex, pageSize) => {
      const params = new URLSearchParams({ limit: String(pageSize) })
      if (cursor) params.set('cursor', cursor)
      const response = await authorizedFetch(
        user,
        `/api/admin/emails/suppressions?${params.toString()}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Could not read the suppression list')
      }
      setError(null)
      return {
        rows: (payload?.entries ?? []) as PlatformSuppression[],
        nextCursor: payload?.nextCursor ?? null,
        hasMore: Boolean(payload?.hasMore),
      }
    },
    // Held at an error rather than an empty list. "Nothing is suppressed" is a
    // confident wrong answer in the reassuring direction, and this card exists
    // to explain mail that is not arriving.
    onError: () => setError('Could not read the suppression list'),
  })
  const entries = pagination.rows

  const release = useCallback(
    async (email: string) => {
      if (busy) return
      setBusy(true)
      try {
        const response = await authorizedFetch(
          user,
          '/api/admin/emails/suppressions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, note: note.trim() }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'The address was not released',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        enqueueSnackbar(
          payload?.released
            ? 'Released — this address can be mailed again'
            : 'That address was not on the list',
          { variant: payload?.released ? 'success' : 'info', persist: false },
        )
        setReleasing(null)
        setNote('')
        // Re-read rather than trusting the click: the card shows what is
        // stored, not what was asked for.
        pagination.refresh()
      } finally {
        setBusy(false)
      }
    },
    [busy, user, note, enqueueSnackbar, pagination],
  )

  const live = (entries ?? []).filter((row) => !row.releasedAt)
  const loading = pagination.loading && !entries.length

  return (
    <CardDisplay
      header={'Platform suppressions'}
      help={docsHelp('staffConsole', {
        anchor: '#system-emails',
        excerpt:
          'Addresses no Aglyn mail reaches, learned from a permanent bounce ' +
          'or a spam report anywhere in the product.',
      })}
      subheader={
        'Addresses that bounced permanently or reported spam, on any send ' +
        'from any site. Nothing in the product mails one until it is released.'
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Alert severity="info">
          {'This list is separate from a merchant’s own Suppressions card. ' +
            'A merchant removing their site’s entry does NOT lift one of ' +
            'these — which is why an address can keep being skipped after ' +
            'they have already removed it from their list.'}
        </Alert>
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : loading ? (
          <Typography variant="body2">{'Loading…'}</Typography>
        ) : live.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing is suppressed platform-wide.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Address'}</TableCell>
                <TableCell>{'Reason'}</TableCell>
                <TableCell>{'Learned from'}</TableCell>
                <TableCell>{'Since'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {live.map((row) => {
                const described = describeReason(row.reason)
                const address = row.email ?? ''
                return (
                  <TableRow key={row.$id}>
                    <TableCell>
                      {address || (
                        <Typography variant="body2" color="text.secondary">
                          {'(address not recorded)'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={described.color}
                        variant="outlined"
                        label={described.label}
                      />
                    </TableCell>
                    {/*
                      WHICH SENDER produced the address that died. It is the
                      first thing a support question needs — an invite that
                      bounced is a mistyped address, and a receipt that
                      bounced is a customer who has lost their mailbox.
                    */}
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {row.context || '—'}
                        {row.hostId ? ` · ${row.hostId}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>{onDate(row)}</TableCell>
                    <TableCell align="right">
                      {releasing === address ? (
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                        >
                          <TextField
                            size="small"
                            label="Why"
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            slotProps={{ htmlInput: { maxLength: 200 } }}
                          />
                          <Button
                            size="small"
                            color="error"
                            disabled={busy || note.trim().length < 8}
                            onClick={() => void release(address)}
                          >
                            {'Release'}
                          </Button>
                          <Button
                            size="small"
                            onClick={() => {
                              setReleasing(null)
                              setNote('')
                            }}
                          >
                            {'Cancel'}
                          </Button>
                        </Stack>
                      ) : (
                        <Button
                          size="small"
                          color="error"
                          disabled={!address}
                          onClick={() => {
                            setReleasing(address)
                            setNote('')
                          }}
                        >
                          {'Release'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {/*
          The console's shared footer, so this list is the same control as
          every other staff list rather than a third grammar that resembles
          them. No size menu: the ROUTE bounds a page, and offering a choice
          it clamps would be a menu that does not do what it says.
        */}
        <StaffListPaginationControls
          pagination={pagination}
          shown={live.length}
          sizeMenu={false}
        />
      </Stack>
    </CardDisplay>
  )
}
StaffEmailSuppressionsCard.displayName = 'StaffEmailSuppressionsCard'
