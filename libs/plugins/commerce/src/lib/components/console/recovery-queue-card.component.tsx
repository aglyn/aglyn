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
import { Chip, Divider, Stack, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  EntitlementUpsell,
  useCommerceEntitlement,
} from './entitlement-gate.component'

export interface RecoveryQueueCardProps {
  hostId: string
}

/** `process-abandoned.ts` waits this long before it will remind a checkout. */
const REMIND_AFTER_MS = 60 * 60 * 1000
/** …and gives up after this, marking the checkout `expired`. */
const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const recoveryHelp = pluginDocsHelp('commerce', {
  title: 'Recovery & alerts',
  excerpt:
    'Shoppers who left a checkout unfinished, and shoppers waiting to be ' +
    'told a sold-out product is back. Both are emailed automatically.',
})

const relative = (atMs: number | undefined): string => {
  if (!atMs) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - atMs) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Recovery & alerts (AGL-2227).
 *
 * Two queues the storefront fills and a background job drains, neither of
 * which the console showed at all:
 *
 * - **Abandoned checkouts** — `hosts/{hostId}/checkouts` with `status: 'open'`.
 *   `scanAbandonedCheckouts` emails one reminder per checkout that carries an
 *   email and has been sitting for an hour, then stamps `remindedAtMs`.
 * - **Back-in-stock alerts** — `hosts/{hostId}/restockAlerts` with a null
 *   `notifiedAtMs`. `scanRestockAlerts` mails them once the product has stock.
 *
 * Both scans were dark until AGL-2227 put them on the platform job beat. That
 * is the reason this card exists rather than only the wiring: a background job
 * is the one surface with no user to notice it has stopped, so the merchant
 * needs somewhere the queue depth is visible. A queue that is always empty and
 * a queue that is never drained look identical from outside.
 *
 * Read-only, and deliberately so. The counts come from the same documents the
 * scans read; nothing here writes, so this card cannot disagree with the job
 * about what is owed. Sending is the job's to do — a "send now" button would
 * be a second sender racing a beat that runs every 15 minutes, for a reminder
 * the merchant cannot un-send.
 *
 * The abandoned half is entitlement-gated in place rather than gating the
 * whole card: `abandonedCart` is Pro, back-in-stock alerts are on every plan
 * that has commerce, and `EntitlementGatedCard` would have hidden the free
 * half behind the paid one. `ready` is load-bearing for the same reason it is
 * everywhere else — `checkEntitlement(undefined)` resolves the FREE tier, so
 * refusing before the org doc lands accuses a paying customer.
 */
export function RecoveryQueueCard(props: RecoveryQueueCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { ready, entitled, upgradeHref, planLabel } = useCommerceEntitlement(
    hostId,
    'abandonedCart',
  )

  const { data: checkoutDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'checkouts'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: alertDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'restockAlerts'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const checkouts = useMemo(() => {
    const now = Date.now()
    // The same three tests `scanAbandonedCheckouts` applies, in the same
    // order, so the number here is the number the job will act on rather
    // than a looser "open checkouts" count that would always read higher.
    const open = (checkoutDocs ?? []).filter(
      (row: any) => row.status === 'open' && row.email,
    )
    return {
      reminded: open.filter((row: any) => row.remindedAtMs).length,
      due: open.filter(
        (row: any) =>
          !row.remindedAtMs &&
          now - Number(row.createdAtMs ?? 0) >= REMIND_AFTER_MS &&
          now - Number(row.createdAtMs ?? 0) <= GIVE_UP_AFTER_MS,
      ).length,
      waiting: open.filter(
        (row: any) =>
          !row.remindedAtMs &&
          now - Number(row.createdAtMs ?? 0) < REMIND_AFTER_MS,
      ).length,
      recent: [...open]
        .sort((a: any, b: any) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
        .slice(0, 5),
    }
  }, [checkoutDocs])

  const alerts = useMemo(() => {
    const rows = alertDocs ?? []
    return {
      pending: rows.filter((row: any) => row.notifiedAtMs == null).length,
      notified: rows.filter(
        (row: any) => row.notifiedAtMs != null && !row.skipped,
      ).length,
    }
  }, [alertDocs])

  return (
    <CardDisplay
      header={'Recovery & alerts'}
      help={recoveryHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Abandoned checkouts'}</Typography>
          {!ready ? (
            <Typography variant="body2" color="text.secondary">
              {'Checking your plan…'}
            </Typography>
          ) : entitled ? (
            <>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip
                  size="small"
                  color={checkouts.due ? 'warning' : 'default'}
                  label={`${checkouts.due} due a reminder`}
                />
                <Chip
                  size="small"
                  label={`${checkouts.waiting} still within the first hour`}
                />
                <Chip
                  size="small"
                  color={checkouts.reminded ? 'success' : 'default'}
                  label={`${checkouts.reminded} reminded`}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Reminders send automatically about 15 minutes after a ' +
                  'checkout has been idle for an hour. A checkout that is ' +
                  'completed stops reminding itself.'}
              </Typography>
              {checkouts.recent.length ? (
                <Stack spacing={0.5}>
                  {checkouts.recent.map((row: any) => (
                    <Typography key={row.$id} variant="body2">
                      {`${row.email} · started ${relative(row.createdAtMs)}${
                        row.remindedAtMs
                          ? ` · reminded ${relative(row.remindedAtMs)}`
                          : ''
                      }`}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'No open checkouts with an email address.'}
                </Typography>
              )}
            </>
          ) : (
            <EntitlementUpsell planLabel={planLabel} upgradeHref={upgradeHref}>
              {'Abandoned checkout recovery emails a shopper who reached ' +
                'checkout, entered their email and left, with a link straight ' +
                'back to the cart they built.'}
            </EntitlementUpsell>
          )}
        </Stack>
        <Divider />
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Back-in-stock alerts'}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip
              size="small"
              color={alerts.pending ? 'info' : 'default'}
              label={`${alerts.pending} shoppers waiting`}
            />
            <Chip size="small" label={`${alerts.notified} notified`} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {'Anyone who used “Notify me when it’s back” on a sold-out ' +
              'product is emailed once its stock goes above zero. Waiting ' +
              'shoppers are a demand signal worth restocking against.'}
          </Typography>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
RecoveryQueueCard.displayName = 'RecoveryQueueCard'

export default RecoveryQueueCard
