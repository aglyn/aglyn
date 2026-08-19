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
import { collection, deleteDoc, doc, limit, query } from 'firebase/firestore'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'

/**
 * How many entries the table lists. `campaign-send` filters against the first
 * 5,000 of the same collection; a browsable table wants far fewer, and the
 * COUNT shown above it is the count of what was fetched. Both facts are said
 * out loud in the copy when the ceiling is reached, rather than quietly
 * showing a number that is really "500".
 */
const SUPPRESSION_PAGE = 500

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

/** `YYYY-MM-DD` from a Firestore timestamp shape, or an em dash. */
function onDate(row: SuppressionRow): string {
  const seconds = row.suppressedAt?.seconds ?? row.createdAt?.seconds
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

  const { data: rows } = useFirestoreCollection<SuppressionRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'suppressions'),
        limit(SUPPRESSION_PAGE),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

  const entries = [...(rows ?? [])].sort(
    (a, b) =>
      (b.suppressedAt?.seconds ?? b.createdAt?.seconds ?? 0) -
      (a.suppressedAt?.seconds ?? a.createdAt?.seconds ?? 0),
  )
  const counts = entries.reduce<Record<string, number>>((totals, row) => {
    const key = String(row.reason ?? 'unsubscribe')
    totals[key] = (totals[key] ?? 0) + 1
    return totals
  }, {})
  const atCeiling = entries.length >= SUPPRESSION_PAGE

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
              {Object.entries(counts).map(([reason, count]) => {
                const described = describeReason(reason)
                return (
                  <Chip
                    key={reason}
                    size="small"
                    color={described.color}
                    variant="outlined"
                    label={`${described.label}: ${count}`}
                  />
                )
              })}
            </Stack>
            {atCeiling ? (
              <Typography variant="caption" color="text.secondary">
                {`Showing the first ${SUPPRESSION_PAGE}. Your campaigns still ` +
                  'skip every suppressed address, whether or not it is ' +
                  'listed here.'}
              </Typography>
            ) : null}
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
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
SuppressionsCard.displayName = 'SuppressionsCard'

export default SuppressionsCard
