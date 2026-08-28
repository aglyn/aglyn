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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import Button from '@mui/material/Button'
import {
  collection,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, usePagedCollection } from '@aglyn/tenant-feature-instance'

export interface SuppressionsCardProps {
  hostId: string
}

/** A stored entry. `reason` is absent on anything written before AGL-2408. */
interface SuppressionRow {
  $id: string
  email?: string
  reason?: string
  suppressedAt?: { seconds?: number } | null
  createdAt?: { seconds?: number } | null
}

/**
 * What a reason means to a merchant, and how much it should worry them.
 *
 * An ABSENT reason reads as "Unsubscribed", and that is a compatibility rule
 * rather than a guess: until AGL-2408 the unsubscribe handler wrote
 * `{ email, createdAt }` and nothing else, while the Resend webhook has
 * stamped `'bounce'`/`'complaint'` since AGL-1918 — so an entry with no reason
 * can only have come from somebody clicking the link. New unsubscribes write
 * the reason explicitly, so this fallback covers history and nothing else.
 */
const REASONS: Record<string, { label: string; color: 'default' | 'warning' | 'error' }> = {
  unsubscribe: { label: 'Unsubscribed', color: 'default' },
  bounce: { label: 'Bounced', color: 'warning' },
  complaint: { label: 'Marked as spam', color: 'error' },
}

const describeReason = (reason: unknown) =>
  REASONS[String(reason ?? 'unsubscribe')] ?? {
    label: String(reason),
    color: 'default' as const,
  }

/**
 * `YYYY-MM-DD` from a Firestore timestamp shape, or an em dash.
 *
 * `createdAt` first, and that ordering is the column's meaning rather than a
 * preference. Both writers restamp `suppressedAt` on every touch and write
 * `createdAt` only when the document is new, precisely so that a bounce
 * arriving after an unsubscribe does not move the date the person actually
 * unsubscribed. Reading `suppressedAt` first put the restamp on screen under a
 * heading that says "Since", and it is also the field the list is ordered by,
 * so a re-touched row would have sorted by one date and displayed another.
 */
function onDate(row: SuppressionRow): string {
  const seconds = row.createdAt?.seconds ?? row.suppressedAt?.seconds
  if (!seconds) return '—'
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * Suppressions (AGL-2410): who is not being emailed, and why.
 *
 * ## What was missing
 *
 * `hosts/{hostId}/suppressions` was written by two paths — the unsubscribe
 * handler and, since AGL-1918, the Resend webhook on a permanent bounce or a
 * complaint — and read by exactly one: `campaign-send.ts`, to filter an
 * audience. Nothing in the console displayed it. So a merchant could not
 * answer any of:
 *
 *  - *"My campaign says 500 recipients and 480 sent — who were the other
 *    20?"* The send returns `{recipients, sent}` and the difference was
 *    unexplained.
 *  - *"Is my list going stale?"* A bounce rate is the single most useful
 *    number about a list and there was nowhere to see it.
 *  - *"This address was suppressed by mistake."* There was no way to remove
 *    an entry — and a link prescanner unsubscribing someone (AGL-2408 §2) was
 *    therefore unrecoverable from inside the product.
 *
 * ## Why a surface and not another counter
 *
 * AGL-1918 deliberately did NOT write a `stats.bounces` counter alongside its
 * fix, because a number with no screen to show it is the written-but-never-
 * read shape this issue is about, one level up. So the fix is the READER, and
 * the breakdown here is derived from the rows on screen rather than from a
 * second stored figure that could disagree with them.
 *
 * ## Removing an entry
 *
 * A plain client `deleteDoc`, and that is a decision. The list belongs to the
 * merchant, host admins already read it through the same rules, and removing
 * a row does nothing except make an address targetable again — there is no
 * counter to launder and no money attached, which is the AGL-1367 test for
 * whether a write has to move server-side.
 *
 * The confirmation is not decoration either: for a `bounce` the address very
 * likely does not exist, and mailing it again is what a provider scores the
 * sending domain on. So the dialog says which reason is being overridden
 * rather than asking a generic "are you sure".
 */
export function SuppressionsCard(props: SuppressionsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  /*
   * The window IS the query, ordered by the server (AGL-693, AGL-2292).
   *
   * This was `limit(500)` with no `orderBy`, sorted by date in the browser.
   * Firestore answers an unordered limit in DOCUMENT-ID order, and an entry
   * here is keyed by `sha256(email)` — so the window was five hundred
   * addresses chosen by the hash of the address, and the client sort dressed
   * that sample up as the newest five hundred. A list past the ceiling
   * therefore hid whoever bounced this morning behind whoever happened to
   * hash low, with no gap on screen to notice and no control asking for more.
   *
   * `createdAt` is the safe field to order on, and that is checked rather
   * than assumed: both writers — the unsubscribe handler and the Resend
   * bounce/complaint webhook — stamp it when the document is created, the
   * pre-AGL-2408 handler wrote `{ email, createdAt }`, and `suppressions` is
   * not in `IMPORTABLE_FIELDS`, so no restore path can produce a row without
   * one. `suppressedAt` would NOT be safe: it is absent on every entry
   * written before AGL-1918, and `orderBy` drops documents that lack the
   * field rather than mis-sorting them.
   */
  const {
    rows: entries,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<SuppressionRow>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'suppressions'),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

  /*==========================================
   * THE BREAKDOWN IS A SERVER AGGREGATE, not a tally of the page.
   *
   * These chips answer "is my list going stale?", and they were a `reduce`
   * over whatever the listener had fetched — so on a site past the old
   * ceiling "Bounced: 140" meant 140 of an arbitrary five hundred, and under
   * a ten-row page it would have meant 140 of ten. A bounce rate computed
   * from a sample is not a bounce rate, and nothing on screen said it was one.
   *
   * Three reads, not one per reason. `where('reason','==','unsubscribe')`
   * cannot be asked, because an entry written before AGL-2408 carries no
   * `reason` at all and an equality filter excludes it — the same
   * field-presence trap as the ordering above. Unsubscribes are therefore the
   * REMAINDER: total minus the two reasons that are always written
   * explicitly, which is exactly the compatibility rule `describeReason`
   * applies row by row.
   *=========================================*/
  const [totalsEpoch, setTotalsEpoch] = useState(0)
  const [totals, setTotals] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let active = true
    const suppressionsRef = collection(firestore, 'hosts', hostId, 'suppressions')
    void Promise.all([
      getAggregateFromServer(suppressionsRef, { total: count() }),
      getAggregateFromServer(
        query(suppressionsRef, where('reason', '==', 'bounce')),
        { total: count() },
      ),
      getAggregateFromServer(
        query(suppressionsRef, where('reason', '==', 'complaint')),
        { total: count() },
      ),
    ])
      .then(([all, bounced, complained]) => {
        if (!active) return
        const total = Number(all.data().total ?? 0)
        const bounce = Number(bounced.data().total ?? 0)
        const complaint = Number(complained.data().total ?? 0)
        setTotals({
          unsubscribe: Math.max(0, total - bounce - complaint),
          bounce,
          complaint,
        })
      })
      .catch(() => {
        // Held at null rather than zeroed. "Bounced: 0" is a confident wrong
        // number in the reassuring direction, and this card exists to warn.
        if (active) setTotals(null)
      })
    return () => {
      active = false
    }
    // The list is a live listener and refreshes itself; an aggregate is a
    // one-shot read and would otherwise keep reporting the breakdown from
    // before the address was put back.
  }, [firestore, hostId, totalsEpoch])

  const handleRemove = async (row: SuppressionRow) => {
    const reason = describeReason(row.reason).label.toLowerCase()
    const accepted = await confirm({
      title: 'Put this address back on your list?',
      description:
        `${row.email ?? 'This address'} is suppressed because it ` +
        `${reason === 'bounced' ? 'bounced permanently' : reason === 'marked as spam' ? 'was marked as spam' : 'unsubscribed'}. ` +
        'Removing the entry means your next campaign will email it again.',
      confirmationText: 'Remove',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with NO VALUE and REJECTS on cancel, so gating on
      // the resolved value alone makes this always return (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    try {
      await deleteDoc(
        doc(firestore, 'hosts', hostId, 'suppressions', row.$id),
      )
      enqueueSnackbar('Removed from the suppression list', {
        variant: 'success',
        persist: false,
      })
      setTotalsEpoch((epoch) => epoch + 1)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  return (
    <CardDisplay
      header="Suppressions"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#compliance' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Addresses your campaigns skip. Someone lands here by clicking ' +
            'unsubscribe, by bouncing permanently, or by marking a message ' +
            'as spam — this is where the gap between a campaign’s recipient ' +
            'count and what it actually sent comes from.'}
        </Typography>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nobody is suppressed. Every address in your audiences is ' +
              'currently mailable.'}
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {totals === null ? (
                <Typography variant="caption" color="text.secondary">
                  {'Could not read the breakdown. This is not the same as ' +
                    'nobody having bounced.'}
                </Typography>
              ) : (
                Object.entries(totals)
                  // A reason nobody has hit is not news, and three chips
                  // reading zero make the two that matter harder to find.
                  .filter(([, total]) => total > 0)
                  .map(([reason, total]) => {
                    const described = describeReason(reason)
                    return (
                      <Chip
                        key={reason}
                        size="small"
                        color={described.color}
                        variant="outlined"
                        label={`${described.label}: ${total}`}
                      />
                    )
                  })
              )}
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Address'}</TableCell>
                  <TableCell>{'Reason'}</TableCell>
                  <TableCell>{'Since'}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((row) => {
                  const described = describeReason(row.reason)
                  return (
                    <TableRow key={row.$id}>
                      <TableCell>
                        {/*
                          Entries are keyed by `sha256(email)` because
                          addresses are PII, and the address itself is stored
                          in the document. An older row written before the
                          address was stored has only its hash — which tells a
                          merchant nothing, so it says so rather than
                          displaying 64 hex characters.
                        */}
                        {row.email || (
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
                      <TableCell>{onDate(row)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="error"
                          onClick={() => void handleRemove(row)}
                        >
                          {'Remove'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={entries.length}
              hasMore={hasMore}
              // The collection's real size, so the footer's count line says
              // "1–10 of 812" rather than "of more than 10" — the aggregate
              // above already knows it, and it is the same number the chips
              // are a breakdown of.
              count={totals ? Object.values(totals).reduce((a, b) => a + b, 0) : undefined}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
SuppressionsCard.displayName = 'SuppressionsCard'

export default SuppressionsCard
