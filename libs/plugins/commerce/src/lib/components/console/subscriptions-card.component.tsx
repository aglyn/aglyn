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

import * as CommerceModel from '../../model'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getAggregateFromServer,
  limit,
  orderBy,
  query,
  sum,
  count,
  where,
  type Firestore,
} from 'firebase/firestore'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import CommerceStatTile from './commerce-stat-tile.component'
import SubscriptionDetailDialog, { type SubscriptionRow } from './subscription-detail-dialog.component'

export interface SubscriptionsCardProps {
  hostId: string
}

/** The query key that opens one subscription on arrival: the renewal notification's link. */
export const SUBSCRIPTIONS_SUBSCRIPTION_PARAM = 'subscription'

type SubscriptionFilter = (typeof CommerceModel.SUBSCRIPTION_FILTER_STATUSES)[number] | 'all'

export interface SubscriptionsSummary {
  monthlyRecurringCents: number
  payingCount: number
  trialCount: number
  pastDueCount: number
}

/**
 * The figures above the list, from aggregation queries: what a store with
 * thousands of subscribers pays for is a handful of index reads, never one
 * read per subscriber.
 *
 * Monthly recurring revenue is summed per billing interval, because a sum
 * cannot divide a yearly price by twelve on the way. Only LIVE-mode
 * subscriptions count: a test checkout is a rehearsal, and the order
 * analytics leave it out for the same reason (`order-analytics.ts`). A
 * subscription with no stored `interval` is left out of the figure rather
 * than guessed at; every sale since AGL-1732 stores one.
 */
export async function loadSubscriptionsSummary(
  firestore: Firestore,
  hostId: string,
): Promise<SubscriptionsSummary> {
  const subscriptions = collection(firestore, 'hosts', hostId, 'subscriptions')
  const paying = (interval: CommerceModel.SubscriptionBillingInterval) =>
    getAggregateFromServer(
      query(
        subscriptions,
        where('status', 'in', [...CommerceModel.SUBSCRIPTION_PAYING_STATUSES]),
        where('interval', '==', interval),
        where('livemode', '==', true),
      ),
      {
        subscriptions: count(),
        totalCents: sum('totals.totalCents'),
        taxCents: sum('totals.taxCents'),
      },
    )
  const counted = (status: string) =>
    getAggregateFromServer(
      query(subscriptions, where('status', '==', status), where('livemode', '==', true)),
      { subscriptions: count() },
    )
  const [monthly, yearly, trials, pastDue] = await Promise.all([
    paying('month'),
    paying('year'),
    counted('trialing'),
    counted('past_due'),
  ])
  const figure = (value: unknown) => Number(value) || 0
  return {
    monthlyRecurringCents:
      CommerceModel.monthlyRecurringCents(
        monthly.data().totalCents,
        monthly.data().taxCents,
        'month',
      ) +
      CommerceModel.monthlyRecurringCents(
        yearly.data().totalCents,
        yearly.data().taxCents,
        'year',
      ),
    payingCount: figure(monthly.data().subscriptions) + figure(yearly.data().subscriptions),
    trialCount: figure(trials.data().subscriptions),
    pastDueCount: figure(pastDue.data().subscriptions),
  }
}

/**
 * Subscriptions (AGL-4191): every subscription on the site, newest first, and
 * what they add up to.
 *
 * Until this, a merchant could see subscriptions only one person at a time, in
 * a site member's Purchases: a digital or service subscription writes no order
 * per cycle, so Orders never showed them either.
 *
 * THE STATUS FILTER IS THE QUERY, as on Returns: `status == X` ordered by
 * `createdAtMs` descending, served by the `subscriptions(status ASC,
 * createdAtMs DESC)` composite; "All" is the single-field order alone. Opening
 * a row shows the subscription's invoices; `?subscription={id}` opens one on
 * arrival, which is where the renewal notification links.
 */
export function SubscriptionsCard(props: SubscriptionsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const [filter, setFilter] = useState<SubscriptionFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<SubscriptionsSummary | null>(null)
  const [summaryFailed, setSummaryFailed] = useState(false)

  const { data: store } = useFirestoreDoc<Record<string, unknown>>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const currency = String(store?.currency ?? 'USD').toUpperCase()
  const money = (cents: number) => CommerceModel.formatOrderMoney(cents, currency)

  useEffect(() => {
    let live = true
    setSummaryFailed(false)
    loadSubscriptionsSummary(firestore, hostId)
      .then((next) => {
        if (live) setSummary(next)
      })
      .catch((error) => {
        console.error('Subscriptions summary unavailable', error)
        if (live) setSummaryFailed(true)
      })
    return () => {
      live = false
    }
  }, [firestore, hostId])

  const {
    rows,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    status,
  } = usePagedCollection<SubscriptionRow>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'subscriptions'),
        ...(filter === 'all' ? [] : [where('status', '==', filter)]),
        orderBy('createdAtMs', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId, filter],
    { idField: '$id' },
  )

  const searchParams = useSearchParams()
  const seededId = searchParams?.get(SUBSCRIPTIONS_SUBSCRIPTION_PARAM) ?? null
  // Once per id, so closing the dialog does not reopen it on the next render.
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (!seededId || seeded.current === seededId) return
    seeded.current = seededId
    setSelectedId(seededId)
  }, [seededId])

  // A linked subscription need not be on this page, so it is read by id.
  const onPage = selectedId ? (rows.find((row) => row.$id === selectedId) ?? null) : null
  const { data: linked } = useFirestoreDoc<Omit<SubscriptionRow, '$id'>>(
    () =>
      selectedId && !onPage
        ? doc(firestore, 'hosts', hostId, 'subscriptions', selectedId)
        : null,
    [firestore, hostId, selectedId, Boolean(onPage)],
  )
  const selected: SubscriptionRow | null =
    onPage ?? (selectedId && linked ? { ...linked, $id: selectedId } : null)

  return (
    <CardDisplay
      header={'Subscriptions'}
      help={pluginDocsHelp('catalog', { anchor: '#subscriptions-list' })}
      HeaderProps={{
        action: (
          <TextField
            label="Status"
            value={filter}
            onChange={(event) => setFilter(event.target.value as SubscriptionFilter)}
            size="small"
            select
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="all">{'All'}</MenuItem>
            {CommerceModel.SUBSCRIPTION_FILTER_STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {CommerceModel.subscriptionStatusLabel(value)}
              </MenuItem>
            ))}
          </TextField>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 4, rowGap: 1.5 }}>
          <CommerceStatTile
            label="Monthly recurring revenue"
            value={summary ? money(summary.monthlyRecurringCents) : summaryFailed ? '—' : '…'}
          />
          <CommerceStatTile
            label="Paying subscribers"
            value={summary ? String(summary.payingCount) : summaryFailed ? '—' : '…'}
          />
          <CommerceStatTile
            label="In a free trial"
            value={summary ? String(summary.trialCount) : summaryFailed ? '—' : '…'}
          />
          <CommerceStatTile
            label="Past due"
            value={summary ? String(summary.pastDueCount) : summaryFailed ? '—' : '…'}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {summaryFailed
            ? 'These figures could not be loaded. The list below is unaffected.'
            : 'Monthly recurring revenue counts active and past-due subscriptions paid in live mode, with a yearly plan counted as a twelfth and tax left out.'}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {status === 'error'
              ? // The rules gate subscriptions on the order book's permission.
                'Subscriptions take the "See orders and webhooks" permission on this site.'
              : status === 'loading'
              ? 'Loading subscriptions…'
              : filter === 'all'
                ? 'No subscriptions yet. When someone subscribes to a monthly or yearly product, they appear here.'
                : `No ${CommerceModel.subscriptionStatusLabel(filter).toLowerCase()} subscriptions.`}
          </Typography>
        ) : (
          <List disablePadding>
            {rows.map((row) => {
              const dateText = CommerceModel.subscriptionDateText(
                CommerceModel.subscriptionDateLine(row),
              )
              const price =
                row.totals?.totalCents != null
                  ? `${money(Number(row.totals.totalCents) || 0)}${CommerceModel.subscriptionIntervalSuffix(row.interval)}`
                  : ''
              const paid =
                Number(row.invoicesCount ?? 0) > 0
                  ? `${money(Number(row.paidCents) || 0)} paid so far`
                  : ''
              return (
                <ListItemButton key={row.$id} onClick={() => setSelectedId(row.$id)} divider>
                  <ListItemText
                    primary={`${row.customerName || row.customerEmail || 'Unknown customer'} · ${CommerceModel.subscriptionPlanName(row)}`}
                    secondary={[price, dateText, paid].filter(Boolean).join(' · ')}
                  />
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                    {row.livemode === false ? (
                      <Chip label="Test" size="small" variant="outlined" />
                    ) : null}
                    <Chip
                      label={CommerceModel.subscriptionStatusLabel(row.status)}
                      size="small"
                      color={CommerceModel.subscriptionStatusColor(row.status)}
                      variant="outlined"
                    />
                  </Stack>
                </ListItemButton>
              )
            })}
          </List>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={rows.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Stack>
      {selected ? (
        <SubscriptionDetailDialog
          hostId={hostId}
          subscription={selected}
          currency={currency}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </CardDisplay>
  )
}
SubscriptionsCard.displayName = 'SubscriptionsCard'

export default SubscriptionsCard
