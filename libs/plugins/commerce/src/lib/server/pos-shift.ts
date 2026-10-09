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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import {
  computePosShiftReport,
  posShiftPrintReport,
  posCashVarianceCents,
  type PosCashEvent,
  type PosCashEventType,
  type PosShift,
  type PosShiftRefund,
  type PosShiftReport,
  type PosShiftSale,
} from '../model/commerce-pos-ops'
import {
  authorizePosOps,
  defaultPosOpsDeps,
  posOpsBody,
  posOpsCleanId,
  readPosRegister,
  resolvePosCashier,
  type PosOpsDeps,
  type PosOpsStaff,
} from './pos-ops-gate'

/*==========================================
 * SHIFTS AND THE CASH DRAWER (AGL-3609): `POST /api/commerce/pos-shift`.
 *
 *   open        a starting float; refused while the register has a shift open
 *   cash-event  paid in, paid out or a safe drop, with a reason
 *   x-report    the open shift's figures so far, changing nothing
 *   close       the counted cash, the Z report frozen onto the shift
 *   current     the register's open shift, or none
 *
 * ONE OPEN SHIFT PER REGISTER is the register document's `openShiftId`,
 * claimed and released inside the same transaction as the shift it names.
 * Two tablets opening the same till at once both read the register; the
 * transaction that commits second re-reads it, finds the first one's shift
 * and refuses — there is no window in which both stand.
 *=========================================*/

/** The most sales one report reads; past it the report says it is partial. */
export const POS_SHIFT_SALES_CEILING = 5000
/** The largest float or cash movement the drawer records in one entry. */
export const POS_CASH_ENTRY_MAX_CENTS = 10_000_000

const CASH_EVENT_TYPES: ReadonlySet<PosCashEventType> = new Set(['paid_in', 'paid_out', 'drop'])

function cents(value: unknown): number | null {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const rounded = Math.round(number)
  return rounded >= 0 && rounded <= POS_CASH_ENTRY_MAX_CENTS ? rounded : null
}

/**
 * The figures for a shift, read from the sales stamped with it and the
 * returns rung against it. Inside a transaction when one is given, so a Z
 * report and the close it freezes see the same sales.
 */
export async function readPosShiftReport(
  registerRef: FirebaseFirestore.DocumentReference,
  hostRef: FirebaseFirestore.DocumentReference,
  shiftId: string,
  shift: Pick<PosShift, 'openingFloatCents' | 'cashEvents'>,
  transaction?: FirebaseFirestore.Transaction,
): Promise<PosShiftReport> {
  const salesQuery = hostRef
    .collection('orders')
    .where('shiftId', '==', shiftId)
    .limit(POS_SHIFT_SALES_CEILING + 1)
  const returnsQuery = registerRef.collection('returns').where('shiftId', '==', shiftId).limit(2000)
  const [salesSnapshot, returnsSnapshot] = transaction
    ? await Promise.all([transaction.get(salesQuery), transaction.get(returnsQuery)])
    : await Promise.all([salesQuery.get(), returnsQuery.get()])
  const sales = salesSnapshot.docs
    .slice(0, POS_SHIFT_SALES_CEILING)
    .map((doc) => (doc.data() ?? {}) as PosShiftSale)
  const refunds: PosShiftRefund[] = returnsSnapshot.docs.map((doc) => {
    const data = (doc.data() ?? {}) as Record<string, any>
    const tenders = Array.isArray(data['tenders']) ? data['tenders'] : []
    return {
      refundedCents: Number(data['refundedCents'] ?? 0),
      tenders: tenders
        .filter((tender: any) => tender?.status !== 'failed')
        .map((tender: any) => ({ method: tender.method, amountCents: Number(tender.amountCents ?? 0) })),
    }
  })
  return computePosShiftReport({
    shift,
    sales,
    refunds,
    truncated: salesSnapshot.docs.length > POS_SHIFT_SALES_CEILING,
  })
}

function shiftOf(data: Record<string, any> | undefined): PosShift | null {
  if (!data) return null
  return {
    ...(data as PosShift),
    cashEvents: Array.isArray(data['cashEvents']) ? (data['cashEvents'] as PosCashEvent[]) : [],
    openingFloatCents: Number(data['openingFloatCents'] ?? 0),
  }
}

type Outcome = { status: number; body: Record<string, unknown> }

export async function handlePosShift(
  deps: PosOpsDeps,
  req: PluginApiRequest,
): Promise<Outcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = posOpsBody(req)
  const gate = await authorizePosOps(deps, req, body['hostId'])
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const staff = gate.staff
  const register = await readPosRegister(staff, body['registerId'])
  if ('error' in register) return { status: register.status, body: { error: register.error } }
  const registerId = register.ref.id
  const { cashierId } = await resolvePosCashier(deps, staff, registerId, body['cashierAssertion'])
  const action = String(body['action'] ?? '')
  const firestore = deps.firestore()
  const shifts = register.ref.collection('shifts')

  switch (action) {
    case 'current': {
      const openShiftId = String(register.data['openShiftId'] ?? '')
      if (!openShiftId) return { status: 200, body: { shift: null } }
      const shift = shiftOf((await shifts.doc(openShiftId).get()).data())
      return {
        status: 200,
        body: { shift: shift && shift.status === 'open' ? { id: openShiftId, ...shift } : null },
      }
    }

    case 'open': {
      const float = cents(body['openingFloatCents'] ?? 0)
      if (float == null) return { status: 400, body: { error: 'Enter the starting cash as an amount.' } }
      const shiftRef = shifts.doc(createResourceUid())
      const now = deps.now()
      const openedByName = await deps.memberName(cashierId)
      return await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(register.ref)
        const standing = String(fresh.get('openShiftId') ?? '')
        if (standing) {
          const standingShift = await transaction.get(shifts.doc(standing))
          if (standingShift.exists && standingShift.get('status') === 'open') {
            return {
              status: 409,
              body: {
                error: 'This register already has a shift open. Close it before opening another.',
                shiftId: standing,
              },
            }
          }
        }
        const shift: PosShift = {
          hostId: staff.hostId,
          registerId,
          status: 'open',
          openedBy: cashierId,
          openedByName,
          openedAtMs: now,
          openingFloatCents: float,
          cashEvents: [],
          // Null until the close: the history orders by each (AGL-3680).
          closedAtMs: null,
          countedCashCents: null,
          expectedCashCents: null,
          varianceCents: null,
          netSalesCents: null,
        }
        transaction.create(shiftRef, shift)
        transaction.update(register.ref, { openShiftId: shiftRef.id })
        return { status: 200, body: { shift: { id: shiftRef.id, ...shift } } }
      })
    }

    case 'cash-event': {
      const type = String(body['type'] ?? '') as PosCashEventType
      if (!CASH_EVENT_TYPES.has(type)) {
        return { status: 400, body: { error: 'Choose paid in, paid out or a safe drop.' } }
      }
      const amount = cents(body['amountCents'])
      if (!amount) return { status: 400, body: { error: 'Enter an amount above zero.' } }
      const reason = String(body['reason'] ?? '').trim().slice(0, 200)
      if (!reason && type !== 'drop') {
        return { status: 400, body: { error: 'Say what the cash was for.' } }
      }
      const eventId = posOpsCleanId(body['eventId']) || createResourceUid()
      const recorded: Outcome = await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(register.ref)
        const shiftId = String(fresh.get('openShiftId') ?? '')
        if (!shiftId) return { status: 409, body: { error: 'Open a shift first.' } }
        const shiftRef = shifts.doc(shiftId)
        const shift = shiftOf((await transaction.get(shiftRef)).data())
        if (!shift || shift.status !== 'open') {
          return { status: 409, body: { error: 'Open a shift first.' } }
        }
        // A retried tap carries the same id: recorded once, answered twice.
        if (shift.cashEvents.some((event) => event.id === eventId)) {
          return { status: 200, body: { shift: { id: shiftId, ...shift }, replayed: true } }
        }
        const event: PosCashEvent = {
          id: eventId,
          type,
          amountCents: amount,
          reason,
          by: cashierId,
          atMs: deps.now(),
        }
        const cashEvents = [...shift.cashEvents, event]
        transaction.update(shiftRef, { cashEvents })
        return { status: 200, body: { shift: { id: shiftId, ...shift, cashEvents } } }
      })
      // The drawer opens for the cash once it is on the record; a replayed
      // tap kicked it the first time.
      if (recorded.status === 200 && !recorded.body['replayed']) {
        await deps.printer.kickDrawer({
          hostId: staff.hostId,
          registerId,
          reason: type as Exclude<PosCashEventType, 'refund'>,
          causeId: eventId,
          createdBy: cashierId,
        })
      }
      return recorded
    }

    case 'print-report': {
      // An X report of the open shift, or the Z report a closed one froze, on
      // the register's receipt printer. `printed: false` tells the register
      // there is no cloud printer, and it prints through the browser instead.
      const requested = posOpsCleanId(body['shiftId']) || String(register.data['openShiftId'] ?? '')
      if (!requested) return { status: 409, body: { error: 'No shift is open on this register.' } }
      const shift = shiftOf((await shifts.doc(requested).get()).data())
      if (!shift) return { status: 404, body: { error: 'Unknown shift' } }
      const closed = shift.status === 'closed' && shift.report
      const report = closed
        ? (shift.report as PosShiftReport)
        : await readPosShiftReport(register.ref, staff.hostRef, requested, shift)
      const host = await staff.hostRef.get()
      const by = closed ? shift.closedByName : shift.openedByName
      const printed = await deps.printer.printReport({
        hostId: staff.hostId,
        registerId,
        shiftId: requested,
        report: posShiftPrintReport({
          title: closed ? 'Z REPORT' : 'X REPORT',
          storeName: String(host.get('displayName') ?? '') || 'Register',
          ...(register.data['name'] ? { registerName: String(register.data['name']) } : {}),
          ...(by ? { subtitle: `${closed ? 'Closed' : 'Opened'} by ${by}` } : {}),
          report,
          ...(closed ? { shift } : {}),
        }),
        createdBy: cashierId,
        attemptKey: posOpsCleanId(body['attemptKey']) || String(deps.now()),
      })
      return { status: 200, body: { printed: printed.jobIds.length > 0, jobIds: printed.jobIds } }
    }

    case 'x-report': {
      const shiftId = String(register.data['openShiftId'] ?? '')
      const shift = shiftId ? shiftOf((await shifts.doc(shiftId).get()).data()) : null
      if (!shift || shift.status !== 'open') {
        return { status: 409, body: { error: 'No shift is open on this register.' } }
      }
      const report = await readPosShiftReport(register.ref, staff.hostRef, shiftId, shift)
      return { status: 200, body: { shiftId, shift: { id: shiftId, ...shift }, report } }
    }

    case 'close': {
      const counted = cents(body['countedCashCents'])
      if (counted == null) return { status: 400, body: { error: 'Enter the cash you counted.' } }
      const note = String(body['note'] ?? '').trim().slice(0, 500)
      const expectedShiftId = posOpsCleanId(body['shiftId'])
      const closedByName = await deps.memberName(cashierId)
      return await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(register.ref)
        const shiftId = String(fresh.get('openShiftId') ?? '')
        if (!shiftId) return { status: 409, body: { error: 'No shift is open on this register.' } }
        // A stale tablet closing a shift another tablet already closed and
        // reopened must not close the new one with the old count.
        if (expectedShiftId && expectedShiftId !== shiftId) {
          return {
            status: 409,
            body: { error: 'That shift is already closed. Refresh to see the open one.' },
          }
        }
        const shiftRef = shifts.doc(shiftId)
        const shift = shiftOf((await transaction.get(shiftRef)).data())
        if (!shift || shift.status !== 'open') {
          return { status: 409, body: { error: 'No shift is open on this register.' } }
        }
        const report = await readPosShiftReport(
          register.ref,
          staff.hostRef,
          shiftId,
          shift,
          transaction,
        )
        const closed: Partial<PosShift> = {
          status: 'closed',
          closedBy: cashierId,
          closedByName,
          closedAtMs: deps.now(),
          countedCashCents: counted,
          expectedCashCents: report.expectedCashCents,
          varianceCents: posCashVarianceCents(counted, report.expectedCashCents),
          netSalesCents: report.netSalesCents,
          report,
          ...(note ? { closingNote: note } : {}),
        }
        transaction.update(shiftRef, closed)
        transaction.update(register.ref, { openShiftId: null })
        return { status: 200, body: { shift: { id: shiftId, ...shift, ...closed }, report } }
      })
    }

    default:
      return { status: 400, body: { error: 'Unknown action' } }
  }
}

/** Whether a register may take a sale or pay cash out, by the site's shift rule. */
export async function posShiftForSale(
  staff: Pick<PosOpsStaff, 'settings'>,
  registerRef: FirebaseFirestore.DocumentReference,
): Promise<{ ok: true; shiftId: string | null } | { ok: false; error: string }> {
  const register = await registerRef.get()
  const shiftId = String(register.get('openShiftId') ?? '') || null
  if (!shiftId && staff.settings.requireOpenShift) {
    return { ok: false, error: 'Open a shift on this register before ringing a sale.' }
  }
  return { ok: true, shiftId }
}

export function createPosShiftHandler(deps: () => PosOpsDeps = defaultPosOpsDeps): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosShift(deps(), req)
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-shift] failed', error)
      return res.status(500).json({ error: 'The shift could not be updated' })
    }
  }
}

export const posShiftHandler = createPosShiftHandler()
