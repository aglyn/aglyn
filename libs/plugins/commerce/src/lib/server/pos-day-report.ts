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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import {
  computePosDayReport,
  posDayReportCsv,
  posDayReportRange,
  POS_ORDER_REFUNDS_COLLECTION,
  POS_DAY_REPORT_RETURNS_CEILING,
  POS_DAY_REPORT_SALES_CEILING,
  POS_DAY_REPORT_SHIFTS_CEILING,
  type PosDayReport,
  type PosDayReturn,
  type PosDaySale,
  type PosDayShift,
} from '../model/commerce-pos-day-report'
import type { PosCashEvent, PosShift } from '../model/commerce-pos-ops'
import { authorizePosOps, defaultPosOpsDeps, type PosOpsDeps } from './pos-ops-gate'
import { readPosShiftReport } from './pos-shift'
import { POS_CURRENCY } from './pos-stripe'

/*==========================================
 * DAY AND EVENT TOTALS (AGL-4037): `GET /api/commerce/pos-day-report`.
 *
 *   ?hostId=…              the site (required)
 *   &from=YYYY-MM-DD       the first day; today in the store's zone when absent
 *   &to=YYYY-MM-DD         the last day, inclusive; `from` when absent; 31 days at most
 *   &format=csv            the same report as a spreadsheet download
 *
 * Who may read it is who may work the register (`authorizePosOps`): a site
 * admin or editor whose Manage POS permission is on, on a plan with POS. The
 * dispatcher's lockdown gate runs before this, as for every register route.
 *
 * Every read is a query an index serves, never a loaded window filtered here:
 *
 *   orders   channel == 'pos', createdAtMs in range   (channel ASC, createdAtMs DESC)
 *   returns  per register, atMs in range               automatic single field
 *   refunds  per register, atMs in range               automatic single field
 *            (`orderRefunds`: a register sale refunded from the order dialog
 *            or in Stripe, on the day it was given; AGL-4037)
 *   shifts   per register, openedAtMs in range         automatic single field
 *   shifts   per register, closedAtMs in range         automatic single field
 *   shifts   the open one and those a sale names       by id (`getAll`)
 *
 * The figures are `computePosDayReport`, which is the shift report's own
 * calculator over the range.
 *=========================================*/

/** The most registers a report walks: the console lists 25. */
const REGISTERS_CEILING = 50

type Outcome =
  | { status: number; body: Record<string, unknown> }
  | { status: 200; csv: string; filename: string }

const queryValue = (value: unknown): string =>
  String(Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()

function shiftOf(id: string, data: Record<string, any> | undefined): PosDayShift | null {
  if (!data) return null
  return {
    ...(data as PosShift),
    id,
    status: data['status'] === 'closed' ? 'closed' : 'open',
    openedAtMs: Number(data['openedAtMs'] ?? 0),
    openingFloatCents: Number(data['openingFloatCents'] ?? 0),
    cashEvents: Array.isArray(data['cashEvents']) ? (data['cashEvents'] as PosCashEvent[]) : [],
  }
}

/** The store's currency (`settings/store.currency`), lower case; the register's when unset. */
async function storeCurrency(hostRef: FirebaseFirestore.DocumentReference): Promise<string> {
  const snapshot = await hostRef.collection('settings').doc('store').get().catch(() => null)
  const chosen = String(snapshot?.exists ? (snapshot.get('currency') ?? '') : '')
    .trim()
    .toLowerCase()
  return /^[a-z]{3}$/.test(chosen) ? chosen : POS_CURRENCY
}

/** Reads the range and computes the report; the route and its specs both call this. */
export async function readPosDayReport(
  deps: PosOpsDeps,
  input: {
    hostRef: FirebaseFirestore.DocumentReference
    hostId: string
    org: Record<string, any> | null
    from?: unknown
    to?: unknown
  },
): Promise<{ ok: true; report: PosDayReport } | { ok: false; status: number; error: string }> {
  const { hostRef } = input
  const [hostSnapshot, currency] = await Promise.all([hostRef.get(), storeCurrency(hostRef)])
  const timeZone = resolveSiteTimeZone(
    input.org as { timeZone?: string } | null,
    (hostSnapshot.data() ?? null) as { timeZone?: string } | null,
  )
  const nowMs = deps.now()
  const range = posDayReportRange({ from: input.from, to: input.to, nowMs, timeZone })
  if ('error' in range) return { ok: false, status: 400, error: range.error }
  const { startMs, endMs } = range

  const registersSnapshot = await hostRef.collection('registers').limit(REGISTERS_CEILING).get()
  const registers = registersSnapshot.docs
  const registerNames: Record<string, string> = {}
  for (const register of registers) registerNames[register.id] = String(register.get('name') ?? '')

  const salesSnapshot = await hostRef
    .collection('orders')
    .where('channel', '==', 'pos')
    .where('createdAtMs', '>=', startMs)
    .where('createdAtMs', '<', endMs)
    .orderBy('createdAtMs', 'desc')
    .limit(POS_DAY_REPORT_SALES_CEILING + 1)
    .get()
  let truncated = salesSnapshot.docs.length > POS_DAY_REPORT_SALES_CEILING
  const sales = salesSnapshot.docs
    .slice(0, POS_DAY_REPORT_SALES_CEILING)
    .map((doc) => (doc.data() ?? {}) as PosDaySale)

  const perRegister = await Promise.all(
    registers.map(async (register) => {
      const [returnsSnapshot, refundsSnapshot, openedSnapshot, closedSnapshot] = await Promise.all([
        register.ref
          .collection('returns')
          .where('atMs', '>=', startMs)
          .where('atMs', '<', endMs)
          .limit(POS_DAY_REPORT_RETURNS_CEILING + 1)
          .get(),
        // Every other refund of this register's sales, given in the range:
        // from the order dialog or in Stripe (AGL-4037). Read as stored, its
        // amount and tender written when the money went back.
        register.ref
          .collection(POS_ORDER_REFUNDS_COLLECTION)
          .where('atMs', '>=', startMs)
          .where('atMs', '<', endMs)
          .limit(POS_DAY_REPORT_RETURNS_CEILING + 1)
          .get(),
        register.ref
          .collection('shifts')
          .where('openedAtMs', '>=', startMs)
          .where('openedAtMs', '<', endMs)
          .limit(POS_DAY_REPORT_SHIFTS_CEILING + 1)
          .get(),
        register.ref
          .collection('shifts')
          .where('closedAtMs', '>=', startMs)
          .where('closedAtMs', '<', endMs)
          .limit(POS_DAY_REPORT_SHIFTS_CEILING + 1)
          .get(),
      ])
      if (
        returnsSnapshot.docs.length > POS_DAY_REPORT_RETURNS_CEILING ||
        refundsSnapshot.docs.length > POS_DAY_REPORT_RETURNS_CEILING ||
        openedSnapshot.docs.length > POS_DAY_REPORT_SHIFTS_CEILING ||
        closedSnapshot.docs.length > POS_DAY_REPORT_SHIFTS_CEILING
      ) {
        truncated = true
      }
      const returns: PosDayReturn[] = returnsSnapshot.docs
        .slice(0, POS_DAY_REPORT_RETURNS_CEILING)
        .map((doc) => {
          const data = (doc.data() ?? {}) as Record<string, any>
          const tenders = Array.isArray(data['tenders']) ? data['tenders'] : []
          return {
            registerId: register.id,
            ...(data['cashierId'] ? { cashierId: String(data['cashierId']) } : {}),
            refundedCents: Number(data['refundedCents'] ?? 0),
            // A tender whose refund failed gave nothing back, as on a Z report.
            tenders: tenders
              .filter((tender: any) => tender?.status !== 'failed')
              .map((tender: any) => ({ method: tender.method, amountCents: Number(tender.amountCents ?? 0) })),
          }
        })
      for (const doc of refundsSnapshot.docs.slice(0, POS_DAY_REPORT_RETURNS_CEILING)) {
        const data = (doc.data() ?? {}) as Record<string, any>
        const tenders = Array.isArray(data['tenders']) ? data['tenders'] : []
        returns.push({
          registerId: register.id,
          // Who gave it back; a refund made in Stripe names nobody.
          ...(data['cashierId'] ? { cashierId: String(data['cashierId']) } : {}),
          refundedCents: Number(data['refundedCents'] ?? 0),
          tenders: tenders.map((tender: any) => ({
            method: tender.method,
            amountCents: Number(tender.amountCents ?? 0),
          })),
        })
      }
      return {
        register,
        returns,
        shiftDocs: [...openedSnapshot.docs, ...closedSnapshot.docs].slice(0, 2 * POS_DAY_REPORT_SHIFTS_CEILING),
      }
    }),
  )

  // Every shift in the range, once: opened or closed in it, the open one on
  // each register, and the shift each sale in the range was rung in (a shift
  // that ran across the whole range).
  const shifts = new Map<string, PosDayShift>()
  const keyOf = (registerId: string, shiftId: string) => `${registerId}/${shiftId}`
  for (const entry of perRegister) {
    for (const doc of entry.shiftDocs) {
      const shift = shiftOf(doc.id, doc.data())
      if (shift) shifts.set(keyOf(entry.register.id, doc.id), { ...shift, registerId: entry.register.id })
    }
  }
  const byId: Array<{ registerId: string; shiftId: string }> = []
  for (const register of registers) {
    const openShiftId = String(register.get('openShiftId') ?? '')
    if (openShiftId) byId.push({ registerId: register.id, shiftId: openShiftId })
  }
  for (const sale of sales) {
    if (sale.shiftId && sale.registerId) byId.push({ registerId: sale.registerId, shiftId: sale.shiftId })
  }
  const missing = [
    ...new Map(
      byId
        .filter((ref) => registerNames[ref.registerId] !== undefined && !shifts.has(keyOf(ref.registerId, ref.shiftId)))
        .map((ref) => [keyOf(ref.registerId, ref.shiftId), ref]),
    ).values(),
  ]
  if (missing.length) {
    const firestore = deps.firestore()
    const snapshots = await firestore.getAll(
      ...missing.map((ref) => hostRef.collection('registers').doc(ref.registerId).collection('shifts').doc(ref.shiftId)),
    )
    snapshots.forEach((snapshot, index) => {
      const ref = missing[index]!
      const shift = shiftOf(snapshot.id, snapshot.exists ? snapshot.data() : undefined)
      // The open shift counts only if it began before the range ended.
      if (shift && shift.openedAtMs < endMs) {
        shifts.set(keyOf(ref.registerId, ref.shiftId), { ...shift, registerId: ref.registerId })
      }
    })
  }
  let shiftList = [...shifts.values()].sort((a, b) => a.openedAtMs - b.openedAtMs || a.id.localeCompare(b.id))
  if (shiftList.length > POS_DAY_REPORT_SHIFTS_CEILING) {
    truncated = true
    shiftList = shiftList.slice(-POS_DAY_REPORT_SHIFTS_CEILING)
  }

  // An open shift's drawer is read live, through the X report's own reader.
  shiftList = await Promise.all(
    shiftList.map(async (shift) =>
      shift.status === 'open'
        ? {
            ...shift,
            liveReport: await readPosShiftReport(
              hostRef.collection('registers').doc(shift.registerId),
              hostRef,
              shift.id,
              shift,
            ),
          }
        : shift,
    ),
  )

  const memberIds = new Set<string>()
  for (const sale of sales) if (sale.cashierId) memberIds.add(String(sale.cashierId))
  for (const entry of perRegister) for (const refund of entry.returns) if (refund.cashierId) memberIds.add(refund.cashierId)
  for (const shift of shiftList) {
    if (!shift.openedByName && shift.openedBy) memberIds.add(shift.openedBy)
    if (!shift.closedByName && shift.closedBy) memberIds.add(shift.closedBy)
  }
  const memberNames: Record<string, string> = {}
  await Promise.all(
    [...memberIds].map(async (uid) => {
      memberNames[uid] = await deps.memberName(uid)
    }),
  )

  return {
    ok: true,
    report: computePosDayReport({
      hostId: input.hostId,
      storeName: String(hostSnapshot.get('displayName') ?? ''),
      currency,
      timeZone,
      range,
      generatedAtMs: nowMs,
      sales,
      returns: perRegister.flatMap((entry) => entry.returns),
      shifts: shiftList,
      registerNames,
      memberNames,
      truncated,
    }),
  }
}

export async function handlePosDayReport(deps: PosOpsDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }
  const query = req.query ?? {}
  const gate = await authorizePosOps(deps, req, queryValue(query['hostId']))
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const format = queryValue(query['format']).toLowerCase()
  if (format && format !== 'json' && format !== 'csv') {
    return { status: 400, body: { error: 'Choose json or csv.' } }
  }
  const read = await readPosDayReport(deps, {
    hostRef: gate.staff.hostRef,
    hostId: gate.staff.hostId,
    org: gate.staff.org,
    from: queryValue(query['from']),
    to: queryValue(query['to']),
  })
  if ('error' in read) return { status: read.status, body: { error: read.error } }
  if (format === 'csv') {
    const { from, to } = read.report
    return {
      status: 200,
      csv: posDayReportCsv(read.report),
      filename: `day-totals-${from}${to === from ? '' : `-to-${to}`}.csv`,
    }
  }
  return { status: 200, body: { report: read.report } }
}

export function createPosDayReportHandler(deps: () => PosOpsDeps = defaultPosOpsDeps): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosDayReport(deps(), req)
      res.setHeader('Cache-Control', 'private, no-store')
      if ('csv' in outcome) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${outcome.filename}"`)
        return res.status(200).send(outcome.csv)
      }
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-day-report] failed', error)
      return res.status(500).json({ error: 'The day totals could not be read' })
    }
  }
}

export const posDayReportHandler = createPosDayReportHandler()
