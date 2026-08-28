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
import {
  Alert,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { docsHelp } from '../constants/docs-links'

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
            {'Newest first. Opens are approximate — an inbox that blocks ' +
              'images never reports one, so a missing open is not evidence ' +
              'the mail was unread. A click is a real action and is reliable.'}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Message</TableCell>
                <TableCell>Sent</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Opens</TableCell>
                <TableCell align="right">Clicks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const presentation = STATUS_PRESENTATION[row.status] ?? {
                  label: row.status,
                  color: 'default' as const,
                }
                return (
                  <TableRow key={row.messageId}>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body2">
                          {row.subject || 'No subject recorded'}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                          useFlexGap
                        >
                          {row.context ? (
                            /* WHICH sender produced it. Without this a row
                               says only that some email went out, which is
                               the question the staffer already had. */
                            <Chip
                              size="small"
                              variant="outlined"
                              label={row.context}
                            />
                          ) : null}
                          {row.clickedLinks.length ? (
                            <Tooltip title={row.clickedLinks.join('\n')}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`followed ${row.clickedLinks.length} link${
                                  row.clickedLinks.length === 1 ? '' : 's'
                                }`}
                              </Typography>
                            </Tooltip>
                          ) : null}
                        </Stack>
                        {row.detail ? (
                          <Typography variant="caption" color="error">
                            {row.detail}
                          </Typography>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatWhen(row.timestamps?.sent ?? row.firstSeenAtMs)}
                      </Typography>
                      {row.timestamps?.delivered ? (
                        <Typography variant="caption" color="text.secondary">
                          {`delivered ${formatWhen(row.timestamps.delivered)}`}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={presentation.color}
                        label={presentation.label}
                      />
                      {row.bounceType ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block' }}
                        >
                          {row.bounceType}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{row.openCount}</TableCell>
                    <TableCell align="right">{row.clickCount}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {rows.some((row) => row.campaignId) ? (
            <Typography variant="caption" color="text.secondary">
              {'Campaign sends also appear on the site’s own campaign stats.'}
            </Typography>
          ) : null}
        </>
      )}
    </CardDisplay>
  )
}

export default StaffUserEmailHistoryCard
