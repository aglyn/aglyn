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
import {
  collection,
  type Firestore,
  getCountFromServer,
  limit,
  orderBy,
  query,
  type Query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  CHECKOUT_GIVE_UP_AFTER_MS,
  CHECKOUT_RECOVERY_STATE_FIELD,
  CHECKOUT_REMIND_AFTER_MS,
  type CheckoutRecoveryState,
} from '../../model/checkout-recovery'
import {
  EntitlementUpsell,
  useCommerceEntitlement,
} from './entitlement-gate.component'

export interface RecoveryQueueCardProps {
  hostId: string
}

const recoveryHelp = pluginDocsHelp('commerce', {
  anchor: '#recovery-and-alerts',
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

/** How many open checkouts the card names under its chips. */
const RECENT_CHECKOUTS = 5

const PENDING: CheckoutRecoveryState = 'pending'
const REMINDED: CheckoutRecoveryState = 'reminded'

/**
 * The queries behind every figure on the card (AGL-3321), each the set
 * `scanAbandonedCheckouts` or `scanRestockAlerts` acts on, asked of Firestore
 * rather than matched over rows the card has read.
 *
 * Checkouts ask `status == 'open'` and the `recoveryState` every writer
 * stamps, so "carries an email" and "not reminded yet" are equalities rather
 * than absences. The two time windows are ranges on `createdAtMs`, ordered
 * newest first so they share one composite with the recent list:
 * `(status, recoveryState, createdAtMs DESC)`. Reminded is two equalities and
 * needs none.
 *
 * Alerts ask `notifiedAtMs == null` for the waiting, which `notify-restock.ts`
 * writes as an explicit null. Notified is every retired alert less the
 * skipped ones — `process-restock.ts` writes `skipped: true` only together
 * with `notifiedAtMs`, so the difference is exact — both on single-field
 * indexes.
 */
export function recoveryQueueQueries(
  firestore: Firestore,
  hostId: string,
  nowMs: number,
) {
  const checkouts = collection(firestore, 'hosts', hostId, 'checkouts')
  const alerts = collection(firestore, 'hosts', hostId, 'restockAlerts')
  const open = where('status', '==', 'open')
  const pending = where(CHECKOUT_RECOVERY_STATE_FIELD, '==', PENDING)
  const newestFirst = orderBy('createdAtMs', 'desc')
  return {
    due: query(
      checkouts,
      open,
      pending,
      where('createdAtMs', '>=', nowMs - CHECKOUT_GIVE_UP_AFTER_MS),
      where('createdAtMs', '<=', nowMs - CHECKOUT_REMIND_AFTER_MS),
      newestFirst,
    ),
    waiting: query(
      checkouts,
      open,
      pending,
      where('createdAtMs', '>', nowMs - CHECKOUT_REMIND_AFTER_MS),
      newestFirst,
    ),
    reminded: query(checkouts, open, where(CHECKOUT_RECOVERY_STATE_FIELD, '==', REMINDED)),
    alertsWaiting: query(alerts, where('notifiedAtMs', '==', null)),
    alertsRetired: query(alerts, where('notifiedAtMs', '!=', null)),
    alertsSkipped: query(alerts, where('skipped', '==', true)),
  }
}

/** The open checkouts with an email, newest first — the card's short list. */
export function recentRecoverableCheckouts(
  firestore: Firestore,
  hostId: string,
) {
  return query(
    collection(firestore, 'hosts', hostId, 'checkouts'),
    where('status', '==', 'open'),
    where(CHECKOUT_RECOVERY_STATE_FIELD, 'in', [PENDING, REMINDED]),
    orderBy('createdAtMs', 'desc'),
    limit(RECENT_CHECKOUTS),
  )
}

interface QueueFigures {
  due: number
  waiting: number
  reminded: number
  alertsWaiting: number
  alertsNotified: number
}

const countOf = (target: Query) =>
  getCountFromServer(target).then((snapshot) => snapshot.data().count)

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
 * Every figure is a Firestore COUNT (AGL-3321) over the whole collection —
 * see `recoveryQueueQueries` — so a queue of any depth reads exactly, where
 * the card used to count the first two hundred documents it read.
 *
 * Read-only, and deliberately so. Nothing here writes, so this card cannot
 * disagree with the job about what is owed. Sending is the job's to do — a
 * "send now" button would be a second sender racing a beat that runs every 15
 * minutes, for a reminder the merchant cannot un-send.
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

  const { data: recentDocs } = useFirestoreCollection<any>(
    () => recentRecoverableCheckouts(firestore, hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const recent = useMemo(() => recentDocs ?? [], [recentDocs])

  // Counted again whenever the newest checkouts move, which is when the
  // figures under them have.
  const [figures, setFigures] = useState<QueueFigures | null>(null)
  const [countFailed, setCountFailed] = useState(false)
  const recentKey = recent
    .map((row: any) => `${row.$id}:${row.remindedAtMs ?? ''}`)
    .join(',')
  useEffect(() => {
    let active = true
    const asked = recoveryQueueQueries(firestore, hostId, Date.now())
    Promise.all([
      countOf(asked.due),
      countOf(asked.waiting),
      countOf(asked.reminded),
      countOf(asked.alertsWaiting),
      countOf(asked.alertsRetired),
      countOf(asked.alertsSkipped),
    ])
      .then(([due, waiting, reminded, alertsWaiting, retired, skipped]) => {
        if (!active) return
        setFigures({
          due,
          waiting,
          reminded,
          alertsWaiting,
          alertsNotified: Math.max(0, retired - skipped),
        })
        setCountFailed(false)
      })
      .catch((error) => {
        console.error('Recovery queue counts failed', error)
        if (active) setCountFailed(true)
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, recentKey])

  /** A figure, or a dash until it is counted. Never a 0 it has not counted. */
  const figure = (value: number | undefined) => (value == null ? '—' : String(value))

  return (
    <CardDisplay
      header={'Recovery & alerts'}
      help={recoveryHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {countFailed ? (
          <Typography variant="caption" color="error">
            {'The queue figures could not be counted just now. They are ' +
              'counted again when a checkout changes, or on reload.'}
          </Typography>
        ) : null}
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
                  color={figures?.due ? 'warning' : 'default'}
                  label={`${figure(figures?.due)} due a reminder`}
                />
                <Chip
                  size="small"
                  label={`${figure(figures?.waiting)} still within the first hour`}
                />
                <Chip
                  size="small"
                  color={figures?.reminded ? 'success' : 'default'}
                  label={`${figure(figures?.reminded)} reminded`}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Reminders send automatically about 15 minutes after a ' +
                  'checkout has been idle for an hour. A checkout that is ' +
                  'completed stops reminding itself.'}
              </Typography>
              {recent.length ? (
                <Stack spacing={0.5}>
                  {recent.map((row: any) => (
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
              color={figures?.alertsWaiting ? 'info' : 'default'}
              label={`${figure(figures?.alertsWaiting)} shoppers waiting`}
            />
            <Chip size="small" label={`${figure(figures?.alertsNotified)} notified`} />
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
