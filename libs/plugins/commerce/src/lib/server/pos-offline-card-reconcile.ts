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

import { formatOperatorAlertAmount } from '@aglyn/aglyn/app-utils/operator-alerts'
import type { BillingWebhookHandler, PluginJobHostGate } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  hostDisplayName,
  notifyHostManagers,
  raiseOperatorAlert,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  COMMERCE_POS_OFFLINE_CARD_UNSYNCED,
  COMMERCE_POS_OFFLINE_CARD_WRONG_ACCOUNT,
} from '../constants/operator-alerts'
import {
  POS_OFFLINE_CARD_INTENT_KIND,
  posOfflineSaleKeyIsValid,
} from '../model/commerce-pos-offline'

/*==========================================
 * A CARD TAKEN OFFLINE, AS STRIPE REPORTS IT (AGL-4039).
 *
 * The Aglyn POS app creates the PaymentIntent of a card it takes offline, so
 * Stripe can know of a charge before the sale itself reaches the server: the
 * SDK forwards the card the moment a connection returns, and the sale syncs
 * right after, from the same device. Usually seconds apart. If the sale never
 * arrives (the device was lost or wiped between the two, or it waits for a
 * member who never signs in again), the charge must not be invisible: each
 * event on such an intent is kept on the site, by the sale's key, under the
 * site's server-only Terminal document
 * (`terminal/config/offlineCardCharges/{saleKey}`), beside whether the sale
 * has synced. The sync itself never depends on this: it reads Stripe.
 *
 * WHO SAYS "SYNCED". Both writers, in transactions, so neither can undo the
 * other: the sync marks the record when it creates the order, and an event
 * reads the record and the sync record together. An event that arrives after
 * the sync therefore keeps `synced`, and one that raced it retries and sees
 * it.
 *
 * NOBODY LOOKING. An intent that holds or has taken money while its sale has
 * not synced gets `alertDueAtMs`, {@link POS_OFFLINE_CARD_UNSYNCED_ALERT_MS}
 * after it was first seen. The hourly sweep ({@link scanUnsyncedOfflineCards})
 * tells the operator and the site's managers once, with time left to sync the
 * sale before Stripe's authorization lapses (about two days). It never
 * captures: without the sale there is no fee to capture with.
 *
 * Self-selecting: every other event returns `null` untouched. Registered on
 * the platform webhook from the commerce server module, beside the other
 * commerce handlers, rather than as a branch of the storefront sections. The
 * four `payment_intent.*` events it reads are in the platform destination's
 * `WEBHOOK_EVENTS` (`tools/scripts/lib/stripe-webhook-health.mjs`).
 *=========================================*/

/** The subcollection, under `hosts/{hostId}/terminal/config`, and its collection-group name. */
export const POS_OFFLINE_CARD_CHARGES = 'offlineCardCharges'

/**
 * How long an intent that holds money may wait for its sale before the sweep
 * says so: six hours, which leaves well over a day of Stripe's two-day
 * authorization to sync it, and is far past the seconds a healthy sync takes.
 */
export const POS_OFFLINE_CARD_UNSYNCED_ALERT_MS = 6 * 60 * 60 * 1000

/** Statuses in which an intent holds money or has taken it. */
const HOLDS_MONEY: ReadonlySet<string> = new Set(['requires_capture', 'processing', 'succeeded'])

/** Statuses an intent never leaves; an older event must not turn one back. */
const FINAL: ReadonlySet<string> = new Set(['succeeded', 'canceled'])

/** What the site keeps about one offline card's PaymentIntent. */
export interface PosOfflineCardChargeRecord {
  hostId: string
  saleKey: string
  paymentIntentId: string
  status: string
  amountCents: number
  registerId: string
  livemode: boolean
  /** Whether the sale has synced (its order exists). */
  synced: boolean
  orderId?: string
  syncedAtMs?: number
  lastEvent: string
  updatedAtMs: number
  /** When the sweep says the sale never synced; absent once synced or told. */
  alertDueAtMs?: number
  alertedAtMs?: number
  /** The capture's idempotency attempt, raised only after a definite failure. */
  captureAttempt?: number
}

/** `hosts/{hostId}/terminal/config/offlineCardCharges/{saleKey}`. */
export function posOfflineCardChargeRef(
  hostRef: FirebaseFirestore.DocumentReference,
  saleKey: string,
): FirebaseFirestore.DocumentReference {
  return hostRef.collection('terminal').doc('config').collection(POS_OFFLINE_CARD_CHARGES).doc(saleKey)
}

const validHostId = (hostId: string) => /^[A-Za-z0-9_-]{1,128}$/.test(hostId)

export async function reconcilePosOfflineCardEvent(
  input: { type: string; object: any },
  firestore?: FirebaseFirestore.Firestore,
  now: () => number = Date.now,
): Promise<{ hostId: string } | null> {
  if (!input.type.startsWith('payment_intent.')) return null
  const intent = input.object ?? {}
  const metadata = (intent.metadata ?? {}) as Record<string, string>
  if (metadata['kind'] !== POS_OFFLINE_CARD_INTENT_KIND) return null
  const hostId = String(metadata['hostId'] ?? '')
  const saleKey = String(metadata['saleKey'] ?? '')
  if (!validHostId(hostId) || !posOfflineSaleKeyIsValid(saleKey)) return null
  const db = firestore ?? firebaseAdmin.app().firestore()
  const hostRef = db.collection('hosts').doc(hostId)
  const chargeRef = posOfflineCardChargeRef(hostRef, saleKey)
  const saleRef = hostRef.collection('posOfflineSales').doc(saleKey)
  await db.runTransaction(async (transaction) => {
    const charge = await transaction.get(chargeRef)
    const sale = await transaction.get(saleRef)
    const previous = (charge.exists ? charge.data() : {}) as Partial<PosOfflineCardChargeRecord>
    const synced = previous.synced === true || sale.exists
    const incoming = String(intent.status ?? '')
    // Stripe does not promise event order: a late `amount_capturable_updated`
    // must not turn a captured or canceled intent back into an authorized one.
    const status =
      previous.status && FINAL.has(previous.status) && !FINAL.has(incoming) ? previous.status : incoming
    const at = now()
    const alertDueAtMs =
      !synced && HOLDS_MONEY.has(status) && !previous.alertedAtMs
        ? typeof previous.alertDueAtMs === 'number'
          ? previous.alertDueAtMs
          : at + POS_OFFLINE_CARD_UNSYNCED_ALERT_MS
        : null
    transaction.set(
      chargeRef,
      {
        hostId,
        saleKey,
        paymentIntentId: String(intent.id ?? ''),
        status,
        amountCents: Math.max(0, Math.round(Number(intent.amount ?? 0))),
        registerId: String(metadata['registerId'] ?? '').slice(0, 128),
        livemode: Boolean(intent.livemode),
        synced,
        lastEvent: input.type,
        updatedAtMs: at,
        alertDueAtMs: alertDueAtMs ?? FieldValue.delete(),
      },
      { merge: true },
    )
  })
  return { hostId }
}

/** The platform webhook's handler for offline card intents: claims only its own. */
export const posOfflineCardBillingWebhookHandler: BillingWebhookHandler =
  async ({ type, object }) => {
    const reconciled = await reconcilePosOfflineCardEvent({ type, object })
    return reconciled ? { claimed: true, hostId: reconciled.hostId } : undefined
  }

/*==========================================
 * THE SWEEP: AN OFFLINE CARD WHOSE SALE NEVER SYNCED.
 *=========================================*/

export interface UnsyncedOfflineCardReport {
  hostId: string
  saleKey: string
  paymentIntentId: string
  status: string
  amountCents: number
  registerId: string
  /** How long ago the intent was first seen waiting, in ms. */
  waitedMs: number
}

export interface UnsyncedOfflineCardScan {
  due: number
  alerted: number
  /** Synced, or no longer holding money, since the alert was set. */
  cleared: number
  skippedLocked: number
}

const describeWait = (ms: number) => {
  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)))
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hour${hours === 1 ? '' : 's'}`
}

/** Tells the operator and the site's managers about one card. Never throws. */
export async function reportUnsyncedOfflineCard(report: UnsyncedOfflineCardReport): Promise<void> {
  try {
    const host = await firebaseAdmin.app().firestore().collection('hosts').doc(report.hostId).get().catch(() => null)
    const site = host?.exists ? hostDisplayName(host.data() as Record<string, unknown>, report.hostId) : report.hostId
    const amount = formatOperatorAlertAmount(report.amountCents)
    await raiseOperatorAlert(COMMERCE_POS_OFFLINE_CARD_UNSYNCED, {
      dedupeKey: `${report.hostId}:${report.saleKey}`,
      hostId: report.hostId,
      context: {
        amount,
        paymentIntentId: report.paymentIntentId,
        status: report.status,
        site: `${site} (${report.hostId})`,
        registerId: report.registerId || 'unknown',
        age: describeWait(report.waitedMs),
      },
    })
    await notifyHostManagers(report.hostId, {
      type: 'content.order',
      title: `A ${amount} card taken offline on {site} has no sale`,
      body:
        report.status === 'succeeded'
          ? `A ${amount} card taken offline was charged, but the register never sent its sale, so there is no order for it. ` +
            'Open the register that took it, signed in as the member who rang it, so the sale syncs.'
          : `A ${amount} card taken offline is approved but not yet charged, because the register never sent its sale. ` +
            'Open the register that took it, signed in as the member who rang it, so the sale syncs. ' +
            'If it does not sync within about two days of the sale, the card is never charged.',
      link: `/${report.hostId}/products`,
    })
  } catch (error) {
    console.error('[pos-offline-card] unsynced report failed', report.hostId, report.saleKey, error)
  }
}

/** Tells the operator a card was made out to an account that is not the store's. Never throws. */
export async function reportPosOfflineCardWrongAccount(input: {
  hostId: string
  orderId: string
  paymentIntentId: string
  status: string
  amountCents: number
  destination: string
  expected: string
}): Promise<void> {
  try {
    const host = await firebaseAdmin.app().firestore().collection('hosts').doc(input.hostId).get().catch(() => null)
    const site = host?.exists ? hostDisplayName(host.data() as Record<string, unknown>, input.hostId) : input.hostId
    await raiseOperatorAlert(COMMERCE_POS_OFFLINE_CARD_WRONG_ACCOUNT, {
      dedupeKey: `${input.hostId}:${input.orderId}`,
      hostId: input.hostId,
      context: {
        amount: formatOperatorAlertAmount(input.amountCents),
        paymentIntentId: input.paymentIntentId,
        status: input.status,
        orderId: input.orderId,
        site: `${site} (${input.hostId})`,
        destination: input.destination || 'none',
        expected: input.expected,
      },
    })
  } catch (error) {
    console.error('[pos-offline-card] wrong-account alert failed', input.hostId, input.orderId, error)
  }
}

/**
 * The hourly sweep (registered in `server.ts`): every offline card record
 * whose alert is due. Re-checks the sale first, so a sale that synced while
 * the event was in flight clears the record and tells nobody.
 *
 * One collection-group range query on `alertDueAtMs`, which is set only on a
 * record that holds money and has not synced, so the ordinary beat reads an
 * empty result. Its COLLECTION_GROUP index is declared in
 * `cloud/firebase-firestore.indexes.json` and pinned by
 * `cron-scan-indexes.spec.ts`.
 */
export async function scanUnsyncedOfflineCards(
  /** The lockdown gate, injected by the runner (AGL-2495). */
  gate: PluginJobHostGate,
  options: {
    firestore?: FirebaseFirestore.Firestore
    nowMs?: number
    limit?: number
    report?: (report: UnsyncedOfflineCardReport) => Promise<void>
  } = {},
): Promise<UnsyncedOfflineCardScan> {
  const db = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  const report = options.report ?? reportUnsyncedOfflineCard
  const scan: UnsyncedOfflineCardScan = { due: 0, alerted: 0, cleared: 0, skippedLocked: 0 }
  const due = await db
    .collectionGroup(POS_OFFLINE_CARD_CHARGES)
    .where('alertDueAtMs', '<=', nowMs)
    .orderBy('alertDueAtMs', 'asc')
    .limit(options.limit ?? 100)
    .get()
    .catch((error: unknown) => {
      console.error('[pos-offline-card] unsynced scan failed', error)
      return null
    })
  if (!due) return scan
  for (const doc of due.docs) {
    const record = (doc.data() ?? {}) as Partial<PosOfflineCardChargeRecord>
    if (typeof record.alertDueAtMs !== 'number') continue
    // `hosts/{hostId}/terminal/config/offlineCardCharges/{saleKey}`.
    const hostId = String(record.hostId || doc.ref.parent.parent?.parent?.parent?.id || '')
    const saleKey = String(record.saleKey || doc.id)
    if (!validHostId(hostId) || !posOfflineSaleKeyIsValid(saleKey)) continue
    scan.due += 1
    // A locked site is skipped, not dropped: its record stays due and is
    // told on the first beat after the lift.
    if (await gate.isLocked(hostId)) {
      scan.skippedLocked += 1
      continue
    }
    const hostRef = db.collection('hosts').doc(hostId)
    const synced = (await hostRef.collection('posOfflineSales').doc(saleKey).get()).exists
    if (synced || !HOLDS_MONEY.has(String(record.status ?? ''))) {
      await doc.ref.set(
        { ...(synced ? { synced: true } : {}), alertDueAtMs: FieldValue.delete() },
        { merge: true },
      )
      scan.cleared += 1
      continue
    }
    await report({
      hostId,
      saleKey,
      paymentIntentId: String(record.paymentIntentId ?? ''),
      status: String(record.status ?? ''),
      amountCents: Math.max(0, Math.round(Number(record.amountCents ?? 0))),
      registerId: String(record.registerId ?? ''),
      waitedMs: Math.max(0, nowMs - (record.alertDueAtMs - POS_OFFLINE_CARD_UNSYNCED_ALERT_MS)),
    })
    await doc.ref.set({ alertedAtMs: nowMs, alertDueAtMs: FieldValue.delete() }, { merge: true })
    scan.alerted += 1
  }
  return scan
}
