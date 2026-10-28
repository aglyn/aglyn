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
import type { PluginOrgEraser } from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import type { PluginJobHostGate } from '@aglyn/aglyn/server'
import { firebaseAdmin, raiseOperatorAlert, readOrgBilling } from '@aglyn/tenant-data-admin'
import {
  chargeOrgUsageInvoice,
  USAGE_INVOICE_MIN_CHARGE_CENTS,
  type OrgUsageInvoiceRequest,
  type OrgUsageInvoiceResult,
} from '@aglyn/tenant-data-admin/server/usage-invoice'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  COMMERCE_POS_CELLULAR_CHARGE_FAILED,
  COMMERCE_POS_CELLULAR_TURN_OFF_FAILED,
} from '../constants/operator-alerts'
import {
  closePosCellularPeriod,
  parsePosCellularConfig,
  posCellularChargeCents,
  posCellularMonthBounds,
  posCellularMonthLabel,
  posCellularPreviousMonthKey,
  posCellularReadersByWorkspace,
  POS_CELLULAR_CHARGE_KIND,
  POS_CELLULAR_CHARGES_COLLECTION,
  POS_CELLULAR_READERS_COLLECTION,
  POS_CELLULAR_SETTLED_STATES,
  type PosCellularCharge,
  type PosCellularChargeState,
  type PosCellularConfig,
  type PosCellularReaderRecord,
} from '../model/pos-cellular'
import { turnOffPosCellularConfiguration } from './pos-cellular'

/*==========================================
 * THE MONTHLY 4G CHARGE (AGL-4038).
 *
 * Once a day, for the calendar month that has just ended, each workspace
 * whose Stripe Reader S710s had 4G at any time in it is charged once: Stripe's
 * price per reader, plus what collecting it costs (`posCellularChargeCents`),
 * on a one-off invoice to its card through core's usage-invoice charge, the
 * path domains and AI overages take. That is the month Stripe bills the
 * platform for, in arrears, so a reader turned off on the 3rd is charged for
 * that month and not the next.
 *
 * Once per workspace per month: `posCellularCharges/{orgId}_{month}` is
 * claimed in a transaction before Stripe is called, and the invoice's
 * idempotency key is the same pair, so a run that died mid-charge and the
 * next day's run land on the same invoice. A charge that did not collect is
 * left open on the workspace's Billing page (nothing retries it) and staff
 * are alerted; a workspace with no one to bill is recorded and alerted, and
 * never charged later for that month.
 *
 * Daily rather than monthly: a month whose charge failed to START (Stripe
 * unreachable) is retried the next day; one that settled costs a read.
 *
 * A STORE THAT IS GONE stops costing the platform: a reader record whose
 * store no longer exists has its period closed and the store's Configuration
 * told to turn cellular off; a workspace being erased does the same for all
 * of its stores first ({@link posCellularOrgEraser}).
 *=========================================*/

const LABEL = '[pos-cellular] billing'

/** A charge claimed this long ago and not settled was abandoned by its run. */
const CLAIM_STALE_MS = 30 * 60 * 1000

/** How many times a charge that never reached Stripe is tried before staff hear of it. */
const ALERT_AFTER_ATTEMPTS = 3

type Charge = (request: OrgUsageInvoiceRequest) => Promise<OrgUsageInvoiceResult>

export interface PosCellularBillingDeps {
  now?: () => number
  config?: PosCellularConfig | null
  charge?: Charge
  readBilling?: (orgId: string) => Promise<{ stripeCustomerId?: unknown }>
  turnOff?: (configurationId: string) => Promise<boolean>
  alert?: typeof raiseOperatorAlert
}

export interface PosCellularBillingReport {
  month: string | null
  workspaces: number
  paid: number
  open: number
  failed: number
  unbillable: number
  deferred: number
  storesGone: number
}

function firestore() {
  return firebaseAdmin.app().firestore()
}

function recordsRef() {
  return firestore().collection(POS_CELLULAR_READERS_COLLECTION)
}

function chargesRef() {
  return firestore().collection(POS_CELLULAR_CHARGES_COLLECTION)
}

/** A workspace's charge for one month, `{orgId}_{month}`: one per pair, so a rerun finds it. */
function posCellularChargeId(orgId: string, month: string): string {
  return `${orgId}_${month}`
}

/** The reader records that may count for a month: on now, or turned off since it began. */
async function recordsForMonth(startMs: number): Promise<Array<{ id: string; record: PosCellularReaderRecord }>> {
  const [on, off] = await Promise.all([
    recordsRef().where('enabled', '==', true).limit(1_000).get(),
    recordsRef().where('disabledAtMs', '>=', startMs).limit(1_000).get(),
  ])
  const byId = new Map<string, PosCellularReaderRecord>()
  for (const doc of [...on.docs, ...off.docs] as unknown as Array<{ id: string; data: () => PosCellularReaderRecord }>) {
    byId.set(String(doc.id), doc.data())
  }
  return [...byId].map(([id, record]) => ({ id, record }))
}

/**
 * Closes the records of stores that no longer exist and turns cellular off
 * on their Configuration, alerting staff when Stripe refuses. Returns how
 * many stores it found gone.
 */
async function closeGoneStores(
  records: ReadonlyArray<{ id: string; record: PosCellularReaderRecord }>,
  deps: Required<Pick<PosCellularBillingDeps, 'turnOff' | 'alert'>>,
  now: number,
): Promise<number> {
  const open = records.filter(({ record }) => record.enabled)
  const hostIds = [...new Set(open.map(({ record }) => record.hostId))]
  let gone = 0
  for (const hostId of hostIds) {
    const host = await firestore().collection('hosts').doc(hostId).get()
    if (host.exists) continue
    gone += 1
    const mine = open.filter(({ record }) => record.hostId === hostId)
    await turnOffConfigurations(mine.map(({ record }) => record), deps)
    for (const { id, record } of mine) await recordsRef().doc(id).set(closePosCellularPeriod(record, now))
  }
  return gone
}

/** Turns cellular off on each distinct Configuration the records name, alerting a refusal. */
async function turnOffConfigurations(
  records: ReadonlyArray<PosCellularReaderRecord>,
  deps: Required<Pick<PosCellularBillingDeps, 'turnOff' | 'alert'>>,
): Promise<{ off: number; failed: number }> {
  const configurations = new Map<string, PosCellularReaderRecord>()
  for (const record of records) {
    if (record.stripeConfigurationId) configurations.set(record.stripeConfigurationId, record)
  }
  let off = 0
  let failed = 0
  for (const [configurationId, record] of configurations) {
    const done = await deps.turnOff(configurationId).catch(() => false)
    if (done) {
      off += 1
      continue
    }
    failed += 1
    await deps
      .alert(COMMERCE_POS_CELLULAR_TURN_OFF_FAILED, {
        dedupeKey: configurationId,
        orgId: record.orgId,
        hostId: record.hostId,
        context: { configurationId, hostId: record.hostId, orgId: record.orgId },
      })
      .catch((error: unknown) => console.error(`${LABEL}: the turn-off alert was not raised`, configurationId, error))
  }
  return { off, failed }
}

/**
 * Claims a workspace's month for this run, or says it is not this run's:
 * settled already, or claimed by a run still within its window. The claim
 * counts the attempt.
 */
async function claimMonth(
  orgId: string,
  month: string,
  readers: number,
  amountCents: number,
  now: number,
): Promise<{ attempts: number } | null> {
  const ref = chargesRef().doc(posCellularChargeId(orgId, month))
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    const existing = snapshot.exists ? (snapshot.data() as PosCellularCharge) : null
    if (existing && POS_CELLULAR_SETTLED_STATES.includes(existing.state)) return null
    if (existing?.state === 'charging' && now - existing.updatedAtMs < CLAIM_STALE_MS) return null
    const attempts = (existing?.attempts ?? 0) + 1
    const claim: PosCellularCharge = {
      orgId,
      month,
      // The figures of the FIRST attempt stand: the invoice's key is the
      // month's, and Stripe refuses a key reused with other parameters.
      readers: existing?.readers ?? readers,
      amountCents: existing?.amountCents ?? amountCents,
      state: 'charging',
      invoiceId: existing?.invoiceId ?? null,
      paidCents: 0,
      attempts,
      createdAtMs: existing?.createdAtMs ?? now,
      updatedAtMs: now,
    }
    transaction.set(ref, claim)
    return { attempts }
  })
}

async function settleMonth(
  orgId: string,
  month: string,
  patch: { state: PosCellularChargeState; invoiceId?: string | null; paidCents?: number },
  now: number,
): Promise<void> {
  await chargesRef()
    .doc(posCellularChargeId(orgId, month))
    .set({ ...patch, updatedAtMs: now }, { merge: true })
}

/** The charge of every workspace whose readers had 4G last month, once each. */
export async function runPosCellularBilling(
  gate: PluginJobHostGate,
  deps: PosCellularBillingDeps = {},
): Promise<PosCellularBillingReport> {
  const config = deps.config === undefined ? parsePosCellularConfig(process.env) : deps.config
  const now = (deps.now ?? Date.now)()
  const report: PosCellularBillingReport = {
    month: null,
    workspaces: 0,
    paid: 0,
    open: 0,
    failed: 0,
    unbillable: 0,
    deferred: 0,
    storesGone: 0,
  }
  if (!config) return report
  const charge = deps.charge ?? ((request: OrgUsageInvoiceRequest) => chargeOrgUsageInvoice(request))
  const readBilling = deps.readBilling ?? ((orgId: string) => readOrgBilling(orgId) as Promise<{ stripeCustomerId?: unknown }>)
  const alert = deps.alert ?? raiseOperatorAlert
  const turnOff = deps.turnOff ?? turnOffPosCellularConfiguration

  const month = posCellularPreviousMonthKey(now)
  report.month = month
  const bounds = posCellularMonthBounds(month) as { startMs: number; endMs: number }
  const records = await recordsForMonth(bounds.startMs)
  report.storesGone = await closeGoneStores(records, { turnOff, alert }, now)

  const byOrg = posCellularReadersByWorkspace(
    records.map(({ record }) => record),
    month,
  )
  report.workspaces = byOrg.size
  for (const [orgId, { readers, hostIds }] of byOrg) {
    // A store locked for security or abuse is charged nothing while it is:
    // its card may be the stolen one the lock is about. Tried again daily.
    const locked = await Promise.all(hostIds.map((hostId) => gate.isLocked(hostId).catch(() => true)))
    if (locked.some(Boolean)) {
      report.deferred += 1
      continue
    }
    const amountCents = posCellularChargeCents(readers, config)
    const claim = await claimMonth(orgId, month, readers, amountCents, now)
    if (!claim) continue
    const stored = (await chargesRef().doc(posCellularChargeId(orgId, month)).get()).data() as PosCellularCharge
    const raise = (reason: string) =>
      alert(COMMERCE_POS_CELLULAR_CHARGE_FAILED, {
        dedupeKey: posCellularChargeId(orgId, month),
        orgId,
        context: {
          orgId,
          month: posCellularMonthLabel(month),
          readers: String(stored.readers),
          amount: formatOperatorAlertAmount(stored.amountCents),
          reason,
        },
      }).catch((error: unknown) => console.error(`${LABEL}: the alert was not raised`, orgId, error))

    const org = await firestore().collection('orgs').doc(orgId).get()
    if (!org.exists) {
      await settleMonth(orgId, month, { state: 'no-workspace' }, now)
      report.unbillable += 1
      continue
    }
    if (stored.amountCents < USAGE_INVOICE_MIN_CHARGE_CENTS) {
      await settleMonth(orgId, month, { state: 'below-minimum' }, now)
      report.unbillable += 1
      continue
    }
    const billing = await readBilling(orgId).catch(() => ({}) as { stripeCustomerId?: unknown })
    const stripeCustomerId = String(billing.stripeCustomerId ?? '')
    if (!stripeCustomerId) {
      await settleMonth(orgId, month, { state: 'no-customer' }, now)
      await raise('the workspace has no payment method on file')
      report.unbillable += 1
      continue
    }
    const label = posCellularMonthLabel(month)
    const result = await charge({
      orgId,
      stripeCustomerId,
      productId: config.productId,
      amountCents: stored.amountCents,
      currency: 'usd',
      description: `4G for ${stored.readers} Stripe Reader S710 card reader${stored.readers === 1 ? '' : 's'}, ${label}`,
      metadata: {
        orgId,
        pluginId: BUNDLE_ID,
        kind: POS_CELLULAR_CHARGE_KIND,
        month,
        readers: String(stored.readers),
      },
      idempotencyKey: `pos-cellular-${orgId}-${month}`,
    })
    if (result.ok) {
      await settleMonth(orgId, month, { state: 'paid', invoiceId: result.invoiceId, paidCents: result.amountPaidCents }, now)
      report.paid += 1
    } else if (result.invoiceId) {
      // The invoice stays open on their Billing page, where they can pay it.
      await settleMonth(orgId, month, { state: 'open', invoiceId: result.invoiceId }, now)
      await raise(result.requiresAction ? 'the card needs the cardholder to authenticate' : result.error || 'the card was declined')
      report.open += 1
    } else {
      await settleMonth(orgId, month, { state: 'failed' }, now)
      console.error(`${LABEL}: the charge did not reach Stripe`, orgId, month, result.error)
      if (claim.attempts >= ALERT_AFTER_ATTEMPTS) await raise(result.error || 'Stripe did not answer')
      report.failed += 1
    }
  }
  return report
}

/**
 * Commerce's 4G share of a WORKSPACE erasure (AGL-4038): every store of the
 * workspace with 4G on has cellular turned off at Stripe first, so the
 * platform stops paying for readers nobody will be charged for. The month in
 * progress is not charged: the workspace is gone. Never fails the erasure; a
 * refusal is a must alert. A dry run only counts.
 */
export function createPosCellularOrgEraser(
  deps: Pick<PosCellularBillingDeps, 'turnOff' | 'alert' | 'now'> = {},
): PluginOrgEraser {
  return async ({ orgId, dryRun }) => {
    if (!orgId) return { cellularStoresTurnedOff: 0, cellularTurnOffFailed: 0 }
    const snapshot = await recordsRef().where('orgId', '==', orgId).limit(500).get()
    const records = (snapshot.docs as unknown as Array<{ id: string; data: () => PosCellularReaderRecord }>)
      .map((doc) => ({ id: String(doc.id), record: doc.data() }))
      .filter(({ record }) => record.enabled)
    const stores = new Set(records.map(({ record }) => record.stripeConfigurationId).filter(Boolean)).size
    if (dryRun || !records.length) return { cellularStoresTurnedOff: dryRun ? stores : 0, cellularTurnOffFailed: 0 }
    const { off, failed } = await turnOffConfigurations(
      records.map(({ record }) => record),
      { turnOff: deps.turnOff ?? turnOffPosCellularConfiguration, alert: deps.alert ?? raiseOperatorAlert },
    )
    const now = (deps.now ?? Date.now)()
    for (const { id, record } of records) await recordsRef().doc(id).set(closePosCellularPeriod(record, now))
    return { cellularStoresTurnedOff: off, cellularTurnOffFailed: failed }
  }
}

/** The eraser over the platform's own Firestore and Stripe, as the declarations register it. */
export const posCellularOrgEraser: PluginOrgEraser = (request) => createPosCellularOrgEraser()(request)
