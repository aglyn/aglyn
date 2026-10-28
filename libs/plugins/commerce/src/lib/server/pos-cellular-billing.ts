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

import { normalizeOrgLockdown } from '@aglyn/aglyn/app-utils/lockdown'
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
  COMMERCE_POS_CELLULAR_TURNED_OFF_UNPAID,
} from '../constants/operator-alerts'
import {
  closePosCellularPeriod,
  parsePosCellularConfig,
  posCellularChargeCents,
  posCellularGraceEndsAtMs,
  posCellularMonthBounds,
  posCellularMonthKey,
  posCellularMonthLabel,
  posCellularOverdue,
  posCellularPreviousMonthKey,
  posCellularReadersByWorkspace,
  posCellularWarningDue,
  POS_CELLULAR_CHARGE_KIND,
  POS_CELLULAR_CHARGES_COLLECTION,
  POS_CELLULAR_READERS_COLLECTION,
  POS_CELLULAR_SETTLED_STATES,
  type PosCellularCharge,
  type PosCellularChargeState,
  type PosCellularConfig,
  type PosCellularReaderRecord,
  type PosCellularSuspension,
} from '../model/pos-cellular'
import {
  posCellularInvoiceStatus,
  settleSuspendedPosCellularCharge,
  turnOffPosCellularConfiguration,
} from './pos-cellular'

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
 *
 * WARN, THEN TURN OFF. A charge left open is asked about each day: paid
 * since, it is settled as paid; voided by staff, as voided. The first time
 * Stripe says it is still unpaid (the same run that left it open, unless
 * Stripe could not be asked), the members who manage the workspace's billing
 * are warned, once (`warnedAtMs`), of the amount and of the day 4G turns off
 * unless it is paid; paid before then, nothing else is sent. Still unpaid
 * once the grace period (`POS_CELLULAR_GRACE_DAYS`, 14 by default) has run
 * from the day it was left open, 4G is turned off at Stripe for every store
 * of the workspace, the members who manage its billing are emailed and
 * notified again, and staff are alerted. Stripe that cannot be asked is never
 * read as unpaid.
 * Paying does not turn 4G back on: the merchant does, once it is paid
 * (`pos-cellular.ts` refuses it until then). Each step is idempotent, so a run
 * that dies half-way is finished by the next.
 *
 * A WORKSPACE DELETED MID-MONTH is charged for that final month as it is
 * erased, before its data goes, through the same claim as the monthly run
 * (and last month too, if the run had not charged it yet), so the two never
 * charge one month twice. A failure there alerts staff and never holds the
 * erasure.
 *=========================================*/

const LABEL = '[pos-cellular] billing'

/** A charge claimed this long ago and not settled was abandoned by its run. */
const CLAIM_STALE_MS = 30 * 60 * 1000

/** How many times a charge that never reached Stripe is tried before staff hear of it. */
const ALERT_AFTER_ATTEMPTS = 3

type Charge = (request: OrgUsageInvoiceRequest) => Promise<OrgUsageInvoiceResult>

type InvoiceStatus = (invoiceId: string) => Promise<{ status: string; amountPaidCents: number } | null>

export interface PosCellularBillingDeps {
  now?: () => number
  config?: PosCellularConfig | null
  charge?: Charge
  readBilling?: (orgId: string) => Promise<{ stripeCustomerId?: unknown }>
  turnOff?: (configurationId: string) => Promise<boolean>
  alert?: typeof raiseOperatorAlert
  /** Stripe's word on a charge's invoice now, or null when it cannot be asked. */
  invoiceStatus?: InvoiceStatus
  /** Tells the workspace 4G was turned off; true once told (or there is nobody to tell). */
  notify?: (notice: import('./pos-cellular-notify').PosCellularTurnedOffNotice) => Promise<boolean>
  /** Warns the workspace 4G turns off unless the charge is paid; true once told (or there is nobody to tell). */
  warn?: (notice: import('./pos-cellular-notify').PosCellularPaymentDueNotice) => Promise<boolean>
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
  /** Open charges paid since, found by asking Stripe. */
  paidLate: number
  /** Workspaces warned that 4G turns off unless a charge left open is paid. */
  warned: number
  /** Workspaces whose 4G was turned off for a month unpaid past its grace. */
  turnedOff: number
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
  patch: {
    state: PosCellularChargeState
    invoiceId?: string | null
    paidCents?: number
    openedAtMs?: number
    final?: boolean
  },
  now: number,
): Promise<void> {
  await chargesRef()
    .doc(posCellularChargeId(orgId, month))
    .set({ ...patch, updatedAtMs: now }, { merge: true })
}

type ChargeOutcome = 'paid' | 'open' | 'failed' | 'unbillable' | 'settled'

/**
 * Charges one workspace's month once: claimed in a transaction first, so the
 * monthly run and a workspace erasure never both charge it, and keyed by the
 * month so a retried run lands on the same invoice. `final` marks the charge
 * an erasure made, which alerts staff at once on a failure, since nothing
 * retries it.
 */
async function chargeWorkspaceMonth(
  input: { orgId: string; month: string; readers: number; final?: boolean },
  context: {
    config: PosCellularConfig
    now: number
    charge: Charge
    readBilling: NonNullable<PosCellularBillingDeps['readBilling']>
    alert: typeof raiseOperatorAlert
  },
): Promise<ChargeOutcome> {
  const { orgId, month, readers } = input
  const { config, now, alert } = context
  const amountCents = posCellularChargeCents(readers, config)
  const claim = await claimMonth(orgId, month, readers, amountCents, now)
  if (!claim) return 'settled'
  const stored = (await chargesRef().doc(posCellularChargeId(orgId, month)).get()).data() as PosCellularCharge
  const final = input.final ? { final: true } : {}
  const raise = (reason: string) =>
    alert(COMMERCE_POS_CELLULAR_CHARGE_FAILED, {
      dedupeKey: posCellularChargeId(orgId, month),
      orgId,
      context: {
        orgId,
        month: posCellularMonthLabel(month),
        readers: String(stored.readers),
        amount: formatOperatorAlertAmount(stored.amountCents),
        reason: input.final ? `${reason} (charged as the workspace was deleted)` : reason,
      },
    }).catch((error: unknown) => console.error(`${LABEL}: the alert was not raised`, orgId, error))

  const org = await firestore().collection('orgs').doc(orgId).get()
  if (!org.exists) {
    await settleMonth(orgId, month, { state: 'no-workspace', ...final }, now)
    if (input.final) await raise('the workspace was already gone')
    return 'unbillable'
  }
  if (stored.amountCents < USAGE_INVOICE_MIN_CHARGE_CENTS) {
    await settleMonth(orgId, month, { state: 'below-minimum', ...final }, now)
    return 'unbillable'
  }
  const billing = await context.readBilling(orgId).catch(() => ({}) as { stripeCustomerId?: unknown })
  const stripeCustomerId = String(billing.stripeCustomerId ?? '')
  if (!stripeCustomerId) {
    await settleMonth(orgId, month, { state: 'no-customer', ...final }, now)
    await raise('the workspace has no payment method on file')
    return 'unbillable'
  }
  const label = posCellularMonthLabel(month)
  const result = await context
    .charge({
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
    .catch(
      (error: unknown): OrgUsageInvoiceResult => ({
        ok: false,
        invoiceId: null,
        status: null,
        totalCents: 0,
        amountPaidCents: 0,
        requiresAction: false,
        error: error instanceof Error ? error.message : 'the charge threw',
      }),
    )
  if (result.ok) {
    await settleMonth(orgId, month, { state: 'paid', invoiceId: result.invoiceId, paidCents: result.amountPaidCents, ...final }, now)
    return 'paid'
  }
  if (result.invoiceId) {
    // The invoice stays open on their Billing page, where they can pay it;
    // the grace period runs from today.
    await settleMonth(orgId, month, { state: 'open', invoiceId: result.invoiceId, openedAtMs: now, ...final }, now)
    await raise(result.requiresAction ? 'the card needs the cardholder to authenticate' : result.error || 'the card was declined')
    return 'open'
  }
  await settleMonth(orgId, month, { state: 'failed', ...final }, now)
  console.error(`${LABEL}: the charge did not reach Stripe`, orgId, month, result.error)
  // Nothing retries a charge made at erasure: staff hear of it now.
  if (input.final || claim.attempts >= ALERT_AFTER_ATTEMPTS) await raise(result.error || 'Stripe did not answer')
  return 'failed'
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
    paidLate: 0,
    warned: 0,
    turnedOff: 0,
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
    const outcome = await chargeWorkspaceMonth({ orgId, month, readers }, { config, now, charge, readBilling, alert })
    if (outcome === 'paid') report.paid += 1
    else if (outcome === 'open') report.open += 1
    else if (outcome === 'failed') report.failed += 1
    else if (outcome === 'unbillable') report.unbillable += 1
  }

  const grace = await enforcePosCellularGrace({
    config,
    now,
    alert,
    turnOff,
    invoiceStatus: deps.invoiceStatus ?? posCellularInvoiceStatus,
    notify:
      deps.notify ??
      (async (notice) => (await import('./pos-cellular-notify')).sendPosCellularTurnedOffNotice(notice)),
    warn:
      deps.warn ??
      (async (notice) => (await import('./pos-cellular-notify')).sendPosCellularPaymentDueNotice(notice)),
  })
  report.paidLate = grace.paidLate
  report.warned = grace.warned
  report.turnedOff = grace.turnedOff
  return report
}

/**
 * WARN, THEN TURN OFF (AGL-4038): every charge left open is asked about at
 * Stripe; paid or voided since, it is settled so; still unpaid within its
 * grace, the workspace is warned once of the day 4G turns off; still unpaid
 * past it, 4G goes off for the workspace. A charge already suspended is
 * finished if a run died half-way (a store still on, nobody told yet) and
 * settled once paid.
 */
async function enforcePosCellularGrace(context: {
  config: PosCellularConfig
  now: number
  alert: typeof raiseOperatorAlert
  turnOff: (configurationId: string) => Promise<boolean>
  invoiceStatus: InvoiceStatus
  notify: NonNullable<PosCellularBillingDeps['notify']>
  warn: NonNullable<PosCellularBillingDeps['warn']>
}): Promise<{ paidLate: number; warned: number; turnedOff: number }> {
  const { config, now } = context
  let paidLate = 0
  let warned = 0
  let turnedOff = 0
  for (const state of ['open', 'suspended'] as const) {
    const snapshot = await chargesRef().where('state', '==', state).limit(200).get()
    for (const doc of snapshot.docs as unknown as Array<{ id: string; data: () => PosCellularCharge }>) {
      const id = String(doc.id)
      const stored = doc.data()
      const invoice = stored.invoiceId ? await context.invoiceStatus(stored.invoiceId).catch(() => null) : null
      if (invoice?.status === 'paid' || invoice?.status === 'void') {
        const settled = invoice.status === 'paid' ? 'paid' : 'voided'
        if (state === 'suspended') {
          await settleSuspendedPosCellularCharge(id, stored, settled, invoice.amountPaidCents, now)
        } else {
          await settleMonth(stored.orgId, stored.month, { state: settled, ...(settled === 'paid' ? { paidCents: invoice.amountPaidCents } : {}) }, now)
        }
        if (settled === 'paid') paidLate += 1
        continue
      }
      // Stripe could not be asked: never read as unpaid.
      if (!invoice) continue
      if (state === 'open') {
        if (!posCellularOverdue(stored, config.graceDays, now)) {
          if (posCellularWarningDue(stored) && (await warnPaymentDue(id, context))) warned += 1
          continue
        }
        const claimed = await claimSuspension(id, now)
        if (!claimed) continue
        turnedOff += 1
        await context
          .alert(COMMERCE_POS_CELLULAR_TURNED_OFF_UNPAID, {
            dedupeKey: id,
            orgId: stored.orgId,
            context: {
              orgId: stored.orgId,
              month: posCellularMonthLabel(stored.month),
              amount: formatOperatorAlertAmount(stored.amountCents),
              graceDays: String(config.graceDays),
            },
          })
          .catch((error: unknown) => console.error(`${LABEL}: the turned-off alert was not raised`, id, error))
      }
      await finishSuspension(id, { ...stored, state: 'suspended', suspendedAtMs: stored.suspendedAtMs ?? now }, context)
    }
  }
  return { paidLate, warned, turnedOff }
}

/**
 * Claims the warning of an open charge, once: the charge as it stood, or null
 * when a run already warned of it or it is no longer open. The day its grace
 * counts from is pinned with the claim, so the day the warning states is the
 * day the turn-off keeps, even for a charge from before that day was stored.
 */
async function claimWarning(id: string, now: number): Promise<PosCellularCharge | null> {
  const ref = chargesRef().doc(id)
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    const charge = snapshot.exists ? (snapshot.data() as PosCellularCharge) : null
    if (!charge || !posCellularWarningDue(charge)) return null
    const openedAtMs = Number(charge.openedAtMs ?? charge.updatedAtMs)
    transaction.set(ref, { warnedAtMs: now, openedAtMs, updatedAtMs: now }, { merge: true })
    return { ...charge, openedAtMs }
  })
}

/**
 * WARN AT THE START (AGL-4038): the members who manage the workspace's
 * billing are told the charge is due and the day 4G turns off for its stores
 * unless it is paid. Claimed before it is sent, so two runs never both send
 * it; a warning nobody could be sent is released for the next run to try.
 */
async function warnPaymentDue(
  id: string,
  context: { config: PosCellularConfig; now: number; warn: NonNullable<PosCellularBillingDeps['warn']> },
): Promise<boolean> {
  const { config, now } = context
  const charge = await claimWarning(id, now)
  if (!charge) return false
  const told = await (async () => {
    // The stores that have 4G now, which lose it on that day.
    const snapshot = await recordsRef().where('orgId', '==', charge.orgId).where('enabled', '==', true).limit(500).get()
    const hostIds = [
      ...new Set(
        (snapshot.docs as unknown as Array<{ data: () => PosCellularReaderRecord }>).map((doc) => doc.data().hostId),
      ),
    ]
    return context.warn({
      orgId: charge.orgId,
      month: charge.month,
      amount: formatOperatorAlertAmount(charge.amountCents),
      readers: charge.readers,
      openedAtMs: Number(charge.openedAtMs),
      turnsOffAtMs: posCellularGraceEndsAtMs(charge, config.graceDays),
      hostIds,
    })
  })().catch((error: unknown) => {
    console.error(`${LABEL}: the payment-due warning was not sent`, id, error)
    return false
  })
  if (!told) await chargesRef().doc(id).set({ warnedAtMs: null, updatedAtMs: now }, { merge: true })
  return told
}

/** Moves an open charge to `suspended`, once: false when a run already did, or it is no longer open. */
async function claimSuspension(id: string, now: number): Promise<boolean> {
  const ref = chargesRef().doc(id)
  return firestore().runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists || (snapshot.data() as PosCellularCharge).state !== 'open') return false
    transaction.set(ref, { state: 'suspended', suspendedAtMs: now, updatedAtMs: now }, { merge: true })
    return true
  })
}

/**
 * 4G off at Stripe for every store of the workspace that still has it, each
 * store's settings saying why, its readers' periods closed, and the workspace
 * told once. Safe to run again: a store already off and a notice already
 * sent are left alone.
 */
async function finishSuspension(
  id: string,
  charge: PosCellularCharge,
  context: {
    now: number
    alert: typeof raiseOperatorAlert
    turnOff: (configurationId: string) => Promise<boolean>
    notify: NonNullable<PosCellularBillingDeps['notify']>
  },
): Promise<void> {
  const { now } = context
  const snapshot = await recordsRef().where('orgId', '==', charge.orgId).where('enabled', '==', true).limit(500).get()
  const records = (snapshot.docs as unknown as Array<{ id: string; data: () => PosCellularReaderRecord }>).map(
    (doc) => ({ id: String(doc.id), record: doc.data() }),
  )
  const hostIds = new Set(charge.suspendedHostIds ?? [])
  if (records.length) {
    await turnOffConfigurations(
      records.map(({ record }) => record),
      { turnOff: context.turnOff, alert: context.alert },
    )
    const suspension: PosCellularSuspension = { month: charge.month, invoiceId: charge.invoiceId, atMs: now }
    for (const hostId of new Set(records.map(({ record }) => record.hostId))) {
      hostIds.add(hostId)
      const terminal = firestore().collection('hosts').doc(hostId).collection('terminal').doc('config')
      if (!(await terminal.get()).exists) continue
      await terminal.set(
        { cellularEnabled: false, cellularChangedAtMs: now, cellularChangedBy: 'unpaid', cellularSuspended: suspension },
        { merge: true },
      )
    }
    for (const { id: recordId, record } of records) await recordsRef().doc(recordId).set(closePosCellularPeriod(record, now))
  }
  const patch: Partial<PosCellularCharge> = {}
  if (records.length || hostIds.size !== (charge.suspendedHostIds ?? []).length) patch.suspendedHostIds = [...hostIds]
  if (!charge.noticeSentAtMs) {
    const told = await context.notify({
      orgId: charge.orgId,
      month: charge.month,
      amount: formatOperatorAlertAmount(charge.amountCents),
      readers: charge.readers,
      openedAtMs: Number(charge.openedAtMs ?? charge.updatedAtMs),
      turnedOffAtMs: Number(charge.suspendedAtMs ?? now),
      hostIds: [...hostIds],
    })
    if (told) patch.noticeSentAtMs = now
  }
  // A suspension already finished, and still unpaid, writes nothing.
  if (Object.keys(patch).length) await chargesRef().doc(id).set({ ...patch, updatedAtMs: now }, { merge: true })
}

/**
 * Commerce's 4G share of a WORKSPACE erasure (AGL-4038), before its data
 * goes:
 *
 * 1. CHARGE IT. The month the workspace is deleted in is charged now, for
 *    each S710 that had 4G in it, as the monthly run would have charged it a
 *    month later; and last month too, if the run had not charged it yet.
 *    Through the run's own claim and key, so the two never charge one month
 *    twice. A workspace that is locked is not charged (its card may be the
 *    stolen one the lock is about): staff are alerted instead. Any failure
 *    alerts staff and goes on.
 * 2. TURN IT OFF. Every store of the workspace with 4G on has cellular turned
 *    off at Stripe, so the platform stops paying for readers nobody will be
 *    charged for, and their periods are closed.
 *
 * Never fails the erasure: a refusal is a must alert. A dry run only counts.
 */
export function createPosCellularOrgEraser(
  deps: Pick<PosCellularBillingDeps, 'turnOff' | 'alert' | 'now' | 'config' | 'charge' | 'readBilling'> = {},
): PluginOrgEraser {
  return async ({ orgId, dryRun }) => {
    const empty = { cellularStoresTurnedOff: 0, cellularTurnOffFailed: 0, cellularFinalMonthsCharged: 0, cellularFinalChargeFailed: 0 }
    if (!orgId) return empty
    const now = (deps.now ?? Date.now)()
    const alert = deps.alert ?? raiseOperatorAlert
    const snapshot = await recordsRef().where('orgId', '==', orgId).limit(500).get()
    const all = (snapshot.docs as unknown as Array<{ id: string; data: () => PosCellularReaderRecord }>).map((doc) => ({
      id: String(doc.id),
      record: doc.data(),
    }))
    const records = all.filter(({ record }) => record.enabled)
    const stores = new Set(records.map(({ record }) => record.stripeConfigurationId).filter(Boolean)).size

    // 1. The final month (and last month, if it is still owed).
    const config = deps.config === undefined ? parsePosCellularConfig(process.env) : deps.config
    // The months with readers that no run has settled yet.
    const months: Array<{ month: string; readers: number }> = []
    for (const month of config ? [posCellularPreviousMonthKey(now), posCellularMonthKey(now)] : []) {
      const readers = posCellularReadersByWorkspace(all.map(({ record }) => record), month).get(orgId)?.readers ?? 0
      if (!readers) continue
      const existing = await chargesRef().doc(posCellularChargeId(orgId, month)).get()
      const state = existing.exists ? (existing.data() as PosCellularCharge).state : null
      if (!state || !POS_CELLULAR_SETTLED_STATES.includes(state)) months.push({ month, readers })
    }
    let charged = 0
    let chargeFailed = 0
    if (dryRun) return { ...empty, cellularStoresTurnedOff: stores, cellularFinalMonthsCharged: months.length }
    if (config && months.length) {
      const org = await firestore().collection('orgs').doc(orgId).get().catch(() => null)
      const locked = org?.exists ? normalizeOrgLockdown(org.data() as never) !== null : false
      for (const { month, readers } of months) {
        try {
          if (locked) {
            chargeFailed += 1
            await alert(COMMERCE_POS_CELLULAR_CHARGE_FAILED, {
              dedupeKey: posCellularChargeId(orgId, month),
              orgId,
              context: {
                orgId,
                month: posCellularMonthLabel(month),
                readers: String(readers),
                amount: formatOperatorAlertAmount(posCellularChargeCents(readers, config)),
                reason: 'the workspace is locked, so it was not charged as it was deleted',
              },
            })
            continue
          }
          const outcome = await chargeWorkspaceMonth(
            { orgId, month, readers, final: true },
            {
              config,
              now,
              charge: deps.charge ?? ((request: OrgUsageInvoiceRequest) => chargeOrgUsageInvoice(request)),
              readBilling:
                deps.readBilling ?? ((id: string) => readOrgBilling(id) as Promise<{ stripeCustomerId?: unknown }>),
              alert,
            },
          )
          if (outcome === 'paid') charged += 1
          else if (outcome !== 'settled') chargeFailed += 1
        } catch (error) {
          chargeFailed += 1
          console.error(`${LABEL}: the final month was not charged`, orgId, month, error)
          await alert(COMMERCE_POS_CELLULAR_CHARGE_FAILED, {
            dedupeKey: posCellularChargeId(orgId, month),
            orgId,
            context: {
              orgId,
              month: posCellularMonthLabel(month),
              readers: String(readers),
              amount: formatOperatorAlertAmount(posCellularChargeCents(readers, config)),
              reason: 'the charge failed as the workspace was deleted',
            },
          }).catch(() => undefined)
        }
      }
    }

    // 2. Off at Stripe, so the platform stops paying for it.
    if (!records.length) return { ...empty, cellularFinalMonthsCharged: charged, cellularFinalChargeFailed: chargeFailed }
    const { off, failed } = await turnOffConfigurations(
      records.map(({ record }) => record),
      { turnOff: deps.turnOff ?? turnOffPosCellularConfiguration, alert },
    )
    for (const { id, record } of records) await recordsRef().doc(id).set(closePosCellularPeriod(record, now))
    return {
      cellularStoresTurnedOff: off,
      cellularTurnOffFailed: failed,
      cellularFinalMonthsCharged: charged,
      cellularFinalChargeFailed: chargeFailed,
    }
  }
}

/** The eraser over the platform's own Firestore and Stripe, as the declarations register it. */
export const posCellularOrgEraser: PluginOrgEraser = (request) => createPosCellularOrgEraser()(request)
