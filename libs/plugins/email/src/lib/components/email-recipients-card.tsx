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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Chip,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'

/** The server's page size. Fixed, so the reader is not offered a choice. */
const PAGE_SIZE = 25

/** Which recipients the table asks for. Matches the route's own vocabulary. */
type EngagementFilter = 'all' | 'opened' | 'clicked'

const FILTER_LABELS: Record<EngagementFilter, string> = {
  all: 'Everyone this was sent to',
  opened: 'Opened it',
  clicked: 'Clicked something',
}

interface RecipientRow {
  messageId: string
  to: string
  subject: string | null
  campaignId: string | null
  status: string
  openCount: number
  clickCount: number
  clickedLinks: string[]
  firstSeenAtMs: number
  lastEventAtMs: number
}

const recipientsDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#opens--clicks',
  excerpt:
    'The people an email reached, and which of them opened it or clicked ' +
    'a link — read from the per-recipient delivery log.',
})

export interface EmailRecipientsCardProps {
  hostId: string
  /**
   * Read every message built from this template.
   *
   * Exactly one of `screenId` and `emailId` is passed. The route takes the
   * SCOPE rather than a list of message ids because a caller who could name
   * ids could name another site's, and the narrower input is the one that
   * cannot be got wrong later.
   */
  screenId?: string
  /** Read one message. */
  emailId?: string
}

/**
 * WHO, not how many.
 *
 * ## Why this is a fetch and not a listen
 *
 * Every other card on this page reads Firestore directly. This one cannot:
 * the per-recipient delivery log lives at `emailDeliveries/{sha256(address)}`
 * — one platform-level collection holding every site's mail and every
 * transactional message besides — and the query that narrows it to this
 * site's campaigns is a collection-group query whose scoping predicate is
 * part of the query. A security rule cannot require a `where` clause, so
 * there is no rule that would admit this read and refuse the same read
 * without the filter. The narrowing happens on the server, behind the same
 * site role the send path requires.
 *
 * ## Why it is its own card
 *
 * A separate card is a separate mount, and this is the only read on either
 * detail page whose cost grows with how much mail there has been. It asks
 * once on mount and once per page turn — never on a poll — so a reader who
 * came for the preview and the totals above pays for one page of this and
 * nothing more.
 *
 * ## The cursor, and why "Previous" keeps a stack
 *
 * The route pages forward with an opaque cursor, which is the only shape a
 * Firestore query offers without counting the whole result first. Going back
 * therefore means remembering where each page started, so the cursors are
 * kept in a list indexed by page — `null` for the first — rather than
 * re-walking forward from the beginning.
 */
export function EmailRecipientsCard(props: EmailRecipientsCardProps) {
  const { hostId, screenId, emailId } = props
  const { data: user } = useUser()

  const [filter, setFilter] = useState<EngagementFilter>('all')
  const [page, setPage] = useState(0)
  /** Cursor for each page. Index 0 is always `null` — the first page. */
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [rows, setRows] = useState<RecipientRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const [campaignsOmitted, setCampaignsOmitted] = useState(0)
  const [campaignsRead, setCampaignsRead] = useState(0)

  const cursor = cursors[page] ?? null

  useEffect(() => {
    if (!user) return undefined
    let active = true
    setLoading(true)
    setFailure(null)
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/campaigns/recipients', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            hostId,
            ...(screenId ? { screenId } : {}),
            ...(emailId ? { emailId } : {}),
            filter,
            cursor,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setRows([])
          setHasMore(false)
          setFailure(String(payload?.error ?? 'Could not read recipients'))
          return
        }
        /*
         * A read that FAILED is not a campaign nobody opened.
         *
         * The route answers 200 with `lookupFailed` for a delivery-log read
         * that could not run — a missing collection-group index is the likely
         * one — because the rest of the payload is still true. Rendering that
         * as an empty table is how a merchant concludes their campaign
         * reached nobody, which is the one wrong answer this table can give.
         */
        if (payload?.lookupFailed) {
          setRows([])
          setHasMore(false)
          setFailure(
            'The delivery log could not be read, so this table is empty for ' +
              'a reason that has nothing to do with your campaign. The ' +
              'numbers above come from the campaigns themselves and are ' +
              'unaffected.',
          )
          return
        }
        const nextRows: RecipientRow[] = Array.isArray(payload?.rows)
          ? payload.rows
          : []
        setRows(nextRows)
        setCampaignsOmitted(Number(payload?.campaignsOmitted ?? 0))
        setCampaignsRead(Number(payload?.campaignsRead ?? 0))
        const nextCursor: string | null = payload?.cursor ?? null
        setHasMore(Boolean(nextCursor))
        if (nextCursor) {
          setCursors((existing) => {
            if (existing[page + 1] === nextCursor) return existing
            const next = existing.slice(0, page + 1)
            next[page + 1] = nextCursor
            return next
          })
        }
      } catch (error) {
        console.error(error)
        if (active) {
          setRows([])
          setHasMore(false)
          setFailure('Could not read recipients')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, hostId, screenId, emailId, filter, cursor, page])

  // A new filter is a new result set, so the cursors collected under the old
  // one describe positions in a query that no longer exists.
  const handleFilter = useCallback((next: EngagementFilter) => {
    setFilter(next)
    setPage(0)
    setCursors([null])
  }, [])

  return (
    <CardDisplay
      header={'Recipients'}
      help={recipientsDocsHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {(emailId
            ? 'One row per address this email was sent to, newest first. '
            : 'One row per message sent from this template, newest first. ') +
            'Opens are counted by a tracking pixel a mail client may block ' +
            'or pre-fetch, so an absent open is weaker evidence than a click.'}
        </Typography>

        <TextField
          select
          size="small"
          label="Show"
          value={filter}
          onChange={(event) =>
            handleFilter(event.target.value as EngagementFilter)
          }
          sx={{ alignSelf: 'flex-start', minWidth: 260 }}
        >
          {(Object.keys(FILTER_LABELS) as EngagementFilter[]).map((key) => (
            <MenuItem key={key} value={key}>
              {FILTER_LABELS[key]}
            </MenuItem>
          ))}
        </TextField>

        {failure ? <Alert severity="warning">{failure}</Alert> : null}

        {campaignsOmitted ? (
          <Alert severity="info">
            {'This template has been used by more emails than one read can ' +
              `span. These rows cover its ${campaignsRead} most recent ` +
              `emails; ${campaignsOmitted} older ` +
              `${campaignsOmitted === 1 ? 'email is' : 'emails are'} ` +
              'not included.'}
          </Alert>
        ) : null}

        {rows.length === 0 && !loading && !failure ? (
          <Typography variant="body2" color="text.secondary">
            {filter === 'all'
              ? 'No delivery records have been kept for this yet.'
              : 'Nobody in the delivery log matches that yet.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Recipient'}</TableCell>
                {emailId ? null : <TableCell>{'Email'}</TableCell>}
                <TableCell>{'State'}</TableCell>
                <TableCell align="right">{'Opens'}</TableCell>
                <TableCell align="right">{'Clicks'}</TableCell>
                <TableCell>{'Last event'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.messageId} hover>
                  <TableCell sx={{ wordBreak: 'break-all' }}>
                    <Stack spacing={0.5}>
                      <Typography variant="body2">{row.to}</Typography>
                      {/*
                       * WHICH links, under the person who followed them. The
                       * per-campaign link rollup counts destinations and
                       * names nobody; this is the other half of the same
                       * question, and it is the half a merchant asks when
                       * they want to know who to call.
                       */}
                      {row.clickedLinks.map((link) => (
                        <Typography
                          key={link}
                          variant="caption"
                          color="text.secondary"
                        >
                          {link}
                        </Typography>
                      ))}
                    </Stack>
                  </TableCell>
                  {emailId ? null : (
                    <TableCell>{row.subject ?? '—'}</TableCell>
                  )}
                  <TableCell>
                    <Chip size="small" label={row.status} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {row.openCount.toLocaleString()}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {row.clickCount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {row.lastEventAtMs
                      ? new Date(row.lastEventAtMs).toLocaleString()
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/*
         * A cursor feed knows whether ANOTHER page exists and never how many
         * rows there are in total, so `hasMore` is passed and `count` is not
         * — the control renders "1–25 of more than 25" rather than inventing
         * a total nobody paid to count.
         */}
        <ListPagination
          page={page}
          pageSize={PAGE_SIZE}
          rowCount={rows.length}
          hasMore={hasMore}
          disabled={loading}
          onPageChange={setPage}
        />

        <Typography variant="caption" color="text.secondary">
          {'Up to ten distinct destinations are kept per recipient, so a ' +
            'reader who clicked more links than that has the rest counted ' +
            'but not listed.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
EmailRecipientsCard.displayName = 'EmailRecipientsCard'

export default EmailRecipientsCard
