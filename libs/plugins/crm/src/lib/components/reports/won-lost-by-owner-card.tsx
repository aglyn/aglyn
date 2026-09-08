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

import * as Aglyn from '@aglyn/aglyn'
import { money } from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { percent } from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { Alert, Stack, Typography } from '@mui/material'
import { limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useOrgMemberOptions } from '../../hooks/use-org-member-options'
import { ReportBreakdown } from './report-breakdown'
import {
  type CrmReportScope,
  reportCacheKey,
  scopedCollection,
  visibleToClause,
} from './report-scope'
import { useWindowRead } from './use-aggregate-read'

/**
 * The same ceiling the Won and lost card reads its chart under, spelled
 * from one constant so the two cards share the read rather than each
 * paying for its own.
 */
const CLOSED_DEAL_CEILING = 500

/** How many owners the breakdown draws before folding the rest into one row. */
const OWNER_ROW_CEILING = 8

type DealRow = Aglyn.CrmDeal & { $id: string }

export interface WonLostByOwnerCardProps {
  report: CrmReportScope
}

/**
 * Who closed what (AGL-2662): the period's wins and losses, by the person
 * who owned the deal at the close.
 *
 * ## It costs no read
 *
 * The two windows are the SAME queries the Won and lost card builds, under
 * the same cache keys — `closed:won` and `closed:lost` — so
 * `useAggregateRead` either answers this card from the remembered window or
 * joins the other card's in-flight promise. Two cards, one pair of reads.
 * A key of its own here would have doubled the most expensive read on the
 * page to ask a different question of the same rows.
 *
 * ## Why the rows can under-report a very busy period
 *
 * The window is bounded, and the bound is on the deals rather than on the
 * owners — so a period with more than {@link CLOSED_DEAL_CEILING} closes of
 * an outcome is tallied over the most recent of them, and the caption says
 * so. A server-side group-by would need one aggregate per owner, and the
 * owner list is not known before the read.
 */
export function WonLostByOwnerCard(props: WonLostByOwnerCardProps) {
  const { report } = props
  const { scope, tokens, range } = report
  const firestore = useFirestore()
  // The roster resolves a uid into the name the team reads; a uid it no
  // longer carries — somebody who has left — is named by its own id rather
  // than dropped, because their closed deals still happened.
  const roster = useOrgMemberOptions(scope[1])

  const closedInPeriod = (status: Aglyn.CrmDealStatus) =>
    query(
      scopedCollection(firestore, scope, 'deals'),
      ...visibleToClause(tokens),
      where('status', '==', status),
      where('closedAtMs', '>=', range.from),
      where('closedAtMs', '<', range.to),
      orderBy('closedAtMs', 'desc'),
      limit(CLOSED_DEAL_CEILING + 1),
    )

  const wonWindow = useWindowRead<DealRow>(
    () => closedInPeriod('won'),
    CLOSED_DEAL_CEILING,
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'closed:won') },
  )
  const lostWindow = useWindowRead<DealRow>(
    () => closedInPeriod('lost'),
    CLOSED_DEAL_CEILING,
    [firestore, scope, tokens, range],
    { cacheKey: reportCacheKey(report, 'closed:lost') },
  )

  const owners = useMemo(
    () => Aglyn.wonLostByOwner(wonWindow.rows, lostWindow.rows),
    [wonWindow.rows, lostWindow.rows],
  )
  const currency = useMemo(
    () => Aglyn.currencyOfDeals(wonWindow.rows).currency,
    [wonWindow.rows],
  )

  const read = wonWindow.status === 'success' && lostWindow.status === 'success'
  const failed = wonWindow.status === 'error' || lostWindow.status === 'error'

  const rows = useMemo(() => {
    const named = (uid: string) =>
      uid
        ? (Aglyn.findOrgMember(roster.options, uid)?.label ?? uid)
        : 'Unassigned'
    const shown = owners.slice(0, OWNER_ROW_CEILING)
    const folded = owners.slice(OWNER_ROW_CEILING)
    const rest = folded.reduce(
      (total, owner) => ({
        won: total.won + owner.won,
        lost: total.lost + owner.lost,
        wonAmountCents: total.wonAmountCents + owner.wonAmountCents,
      }),
      { won: 0, lost: 0, wonAmountCents: 0 },
    )
    return [
      ...shown.map((owner) => ({
        key: owner.uid || 'unassigned',
        label: named(owner.uid),
        value: owner.won,
        display: `${owner.won.toLocaleString()} won`,
        note:
          `${owner.lost.toLocaleString()} lost · ` +
          `${owner.winRate === null ? 'no rate' : `${percent(owner.winRate)} win rate`} · ` +
          `${money(owner.wonAmountCents, currency)}`,
        color: 'success.main',
      })),
      ...(folded.length
        ? [
            {
              key: '$rest',
              label: `${folded.length} more`,
              value: rest.won,
              display: `${rest.won.toLocaleString()} won`,
              note: `${rest.lost.toLocaleString()} lost · ${money(rest.wonAmountCents, currency)}`,
              color: 'success.main',
            },
          ]
        : []),
    ]
  }, [owners, roster.options, currency])

  return (
    <CardDisplay
      header={'Won and lost by owner'}
      help={Aglyn.pluginDocsHelp('crmReports', {
        anchor: '#won-and-lost-by-owner',
        excerpt:
          'Closed deals grouped by the person who owned them at the close, ' +
          'ranked by how much closed rather than by win rate, with the deals ' +
          'nobody owned kept as a row of their own.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {failed ? (
          <Alert severity="warning">
            {'The closed deals could not be read, so this is not an empty period.'}
          </Alert>
        ) : null}
        <ReportBreakdown
          rows={rows}
          emptyText={read ? 'Nothing closed in this period.' : 'Reading…'}
        />
        {wonWindow.truncated || lostWindow.truncated ? (
          <Typography variant="caption" color="text.secondary">
            {`Counted over the ${CLOSED_DEAL_CEILING} most recently closed of each outcome; this period held more.`}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {'Credited to whoever owned the deal when it closed, not to whoever created it.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
WonLostByOwnerCard.displayName = 'WonLostByOwnerCard'

export default WonLostByOwnerCard
