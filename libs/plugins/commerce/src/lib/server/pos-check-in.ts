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
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import {
  changedCheckInCustomerFields,
  checkInCustomerKey,
  checkInCustomers,
  checkInDayCsv,
  checkInDayMs,
  checkInDayTotals,
  checkInSearchToken,
  CHECK_IN_BATCH_MAX,
  CHECK_IN_DAY_CEILING,
  CHECK_IN_SEARCH_CUSTOMERS,
  CHECK_IN_SEARCH_ROWS,
  dueCheckInsForOrder,
  dueCheckInsForReservation,
  newCheckInDocument,
  normalizeWristband,
  sortCheckInRows,
  type CheckInRow,
  type CheckInWristband,
  type DueCheckIn,
  type HostCheckIn,
} from '../model/commerce-check-in'
import { posDayReportRange } from '../model/commerce-pos-day-report'
import type { HostOrder } from '../model/commerce-orders'
import {
  authorizePosOps,
  defaultPosOpsDeps,
  posOpsBody,
  posOpsCleanId,
  posOpsIdempotencyKey,
  resolvePosCashier,
  type PosOpsDeps,
  type PosOpsStaff,
} from './pos-ops-gate'
import { onPosSaleCompleted, type PosSaleCompletedEvent } from './pos-sale'

/*==========================================
 * CHECK-IN AT THE WINDOW (AGL-4043): `/api/commerce/pos-check-in`.
 *
 *   POST { hostId, action: 'search',   text, day? }
 *   POST { hostId, action: 'customer', customerKey | email | contactId, day?, reconcile?: false | 'if-used' }
 *   POST { hostId, action: 'check_in', checkIns: [{ id, wristband? }], registerId?, cashierAssertion? }
 *   POST { hostId, action: 'undo',     id }
 *   POST { hostId, action: 'wristband', id, wristband }
 *   GET  ?hostId=…&day=YYYY-MM-DD[&format=csv]   the day's list
 *
 * `day` is today in the site's time zone when absent. Who may use it is who
 * may work the register (`authorizePosOps`). A check-in is idempotent on the
 * `Idempotency-Key` header: a retried tap answers the check-in it made, not
 * "already checked in".
 *
 * WHAT IS DUE is written down, not filtered at read: each due person is a
 * `checkIns` document (see `model/commerce-check-in.ts`), so a search is a
 * query on `dayKey ==` and `searchTokens array-contains` with an index. The
 * documents are written from their sources:
 *
 *  - a register sale, the moment it completes (the sale-completed seam);
 *  - and every source, by {@link reconcileCheckInDay}: the day's orders
 *    (`createdAtMs` in the day, the automatic single-field index) and the
 *    stays that began within a year before it (`checkInDayMs`, likewise),
 *    at most every {@link CHECK_IN_RECONCILE_MS} per day, on the next search
 *    or list. So an online order paid a minute ago is found on the next
 *    search after that.
 *
 * Reconciling only ever CREATES what is missing, refreshes a waiting
 * person's name and address, and removes a waiting person whose order was
 * refunded or cancelled. A checked-in person is never touched: each change
 * to an existing document is a transaction that re-reads it first.
 *=========================================*/

/** How stale a day's reconcile may be before a search or the list redoes it. */
export const CHECK_IN_RECONCILE_MS = 30_000

/** How far back a stay may have begun and still cover the day. */
const STAY_LOOKBACK_MS = 366 * 86_400_000

type Outcome =
  | { status: number; body: Record<string, unknown> }
  | { status: 200; csv: string; filename: string }

const queryValue = (value: unknown): string =>
  String(Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()

/** A check-in id as the routes accept one. */
function cleanCheckInId(value: unknown): string {
  const id = String(value ?? '').trim()
  return /^[or]_[A-Za-z0-9_-]{1,300}$/.test(id) ? id : ''
}

export interface CheckInDay {
  dayKey: string
  startMs: number
  endMs: number
  timeZone: string
}

/** The day asked for, in the site's zone; today there when absent. */
export async function readCheckInDay(
  deps: PosOpsDeps,
  hostRef: FirebaseFirestore.DocumentReference,
  org: Record<string, any> | null,
  rawDay: unknown,
): Promise<({ ok: true } & CheckInDay) | { ok: false; error: string }> {
  const host = await hostRef.get()
  const timeZone = resolveSiteTimeZone(
    org as { timeZone?: string } | null,
    (host.data() ?? null) as { timeZone?: string } | null,
  )
  const day = String(rawDay ?? '').trim()
  const range = posDayReportRange({ from: day, to: day, nowMs: deps.now(), timeZone })
  if ('error' in range) return { ok: false, error: 'Choose the day as YYYY-MM-DD.' }
  return { ok: true, dayKey: range.from, startMs: range.startMs, endMs: range.endMs, timeZone }
}

/** Reads documents by reference, a few hundred at a time. */
async function readAll(
  firestore: FirebaseFirestore.Firestore,
  refs: FirebaseFirestore.DocumentReference[],
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const out: FirebaseFirestore.DocumentSnapshot[] = []
  for (let at = 0; at < refs.length; at += 300) {
    out.push(...(await firestore.getAll(...refs.slice(at, at + 300))))
  }
  return out
}

/** The products an order set names, as stored now. */
async function productsFor(
  deps: PosOpsDeps,
  hostRef: FirebaseFirestore.DocumentReference,
  orders: ReadonlyArray<Partial<HostOrder>>,
): Promise<Map<string, Record<string, any>>> {
  const ids = new Set<string>()
  for (const order of orders) {
    for (const line of Array.isArray(order.lineItems) ? order.lineItems : []) {
      if (line?.productId && posOpsCleanId(line.productId)) ids.add(line.productId)
    }
  }
  const snapshots = await readAll(
    deps.firestore(),
    [...ids].map((id) => hostRef.collection('products').doc(id)),
  )
  const products = new Map<string, Record<string, any>>()
  for (const snapshot of snapshots) {
    if (snapshot.exists) products.set(snapshot.id, (snapshot.data() ?? {}) as Record<string, any>)
  }
  return products
}

const isAlreadyExists = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code
  return code === 6 || code === 'already-exists' || /ALREADY_EXISTS/.test(String((error as Error)?.message))
}

/** Creates the due check-ins that are missing; an existing one is left exactly as it is. */
async function createMissing(
  checkIns: FirebaseFirestore.CollectionReference,
  due: ReadonlyMap<string, DueCheckIn>,
  existing: ReadonlySet<string>,
  nowMs: number,
): Promise<number> {
  const missing = [...due].filter(([id]) => !existing.has(id))
  let created = 0
  for (let at = 0; at < missing.length; at += 100) {
    await Promise.all(
      missing.slice(at, at + 100).map(async ([id, entry]) => {
        try {
          await checkIns.doc(id).create(newCheckInDocument(entry, nowMs))
          created += 1
        } catch (error) {
          // Another device wrote it first, which is the same document.
          if (!isAlreadyExists(error)) throw error
        }
      }),
    )
  }
  return created
}

/**
 * Brings a day's check-ins in line with its orders and stays, at most every
 * {@link CHECK_IN_RECONCILE_MS} unless `force`. Answers whether a source
 * held more than one day reads.
 */
export async function reconcileCheckInDay(
  deps: PosOpsDeps,
  hostRef: FirebaseFirestore.DocumentReference,
  day: CheckInDay,
  options: { force?: boolean; onlyIfUsed?: boolean } = {},
): Promise<{ truncated: boolean }> {
  const nowMs = deps.now()
  const markerRef = hostRef.collection('checkInDays').doc(day.dayKey)
  if (!options.force) {
    const marker = await markerRef.get()
    // A day nobody has checked anyone in on yet is left alone by a caller
    // that only asks in passing: a store that never checks anybody in pays
    // nothing for the register's customer panel.
    if (!marker.exists && options.onlyIfUsed) return { truncated: false }
    if (marker.exists && nowMs - Number(marker.get('reconciledAtMs') ?? 0) < CHECK_IN_RECONCILE_MS) {
      return { truncated: marker.get('truncated') === true }
    }
  }
  const dayMs = checkInDayMs(day.dayKey) ?? 0
  const checkIns = hostRef.collection('checkIns')
  const [ordersSnapshot, staysSnapshot, existingSnapshot] = await Promise.all([
    hostRef
      .collection('orders')
      .where('createdAtMs', '>=', day.startMs)
      .where('createdAtMs', '<', day.endMs)
      .orderBy('createdAtMs')
      .limit(CHECK_IN_DAY_CEILING + 1)
      .get(),
    hostRef
      .collection('reservations')
      .where('checkInDayMs', '<=', dayMs)
      .where('checkInDayMs', '>', dayMs - STAY_LOOKBACK_MS)
      .orderBy('checkInDayMs', 'desc')
      .limit(CHECK_IN_DAY_CEILING + 1)
      .get(),
    checkIns.where('dayKey', '==', day.dayKey).limit(CHECK_IN_DAY_CEILING + 1).get(),
  ])
  const truncated =
    ordersSnapshot.docs.length > CHECK_IN_DAY_CEILING ||
    staysSnapshot.docs.length > CHECK_IN_DAY_CEILING ||
    existingSnapshot.docs.length > CHECK_IN_DAY_CEILING
  const orders = ordersSnapshot.docs.slice(0, CHECK_IN_DAY_CEILING)
  const stays = staysSnapshot.docs.slice(0, CHECK_IN_DAY_CEILING)

  const products = await productsFor(
    deps,
    hostRef,
    orders.map((doc) => doc.data() as Partial<HostOrder>),
  )
  const resourceIds = [
    ...new Set(stays.map((doc) => String(doc.get('resourceId') ?? '')).filter((id) => posOpsCleanId(id))),
  ]
  const resourceNames = new Map<string, string>()
  for (const snapshot of await readAll(
    deps.firestore(),
    resourceIds.map((id) => hostRef.collection('resources').doc(id)),
  )) {
    if (snapshot.exists) resourceNames.set(snapshot.id, String(snapshot.get('name') ?? ''))
  }

  const due = new Map<string, DueCheckIn>()
  const readOrders = new Set<string>()
  const readStays = new Set<string>()
  for (const doc of orders) {
    readOrders.add(doc.id)
    for (const [id, entry] of dueCheckInsForOrder({
      orderId: doc.id,
      order: doc.data() as Partial<HostOrder>,
      products,
      dayKey: day.dayKey,
    })) {
      due.set(id, entry)
    }
  }
  for (const doc of stays) {
    readStays.add(doc.id)
    for (const [id, entry] of dueCheckInsForReservation({
      reservationId: doc.id,
      reservation: doc.data() as Record<string, any>,
      resourceName: resourceNames.get(String(doc.get('resourceId') ?? '')) ?? null,
      dayKey: day.dayKey,
    })) {
      due.set(id, entry)
    }
  }

  const existing = new Set(existingSnapshot.docs.map((doc) => doc.id))
  await createMissing(checkIns, due, existing, nowMs)

  // A waiting person whose source this pass READ and no longer finds due
  // goes; one whose name or address changed is refreshed. Each re-reads its
  // document in a transaction, so a check-in made meanwhile stands.
  const changes = existingSnapshot.docs.slice(0, CHECK_IN_DAY_CEILING).flatMap((doc) => {
    const stored = doc.data() as Partial<HostCheckIn>
    if (stored.status !== 'expected') return []
    const wanted = due.get(doc.id)
    if (!wanted) {
      const sourceRead =
        (stored.source === 'order' && stored.orderId && readOrders.has(stored.orderId)) ||
        (stored.source === 'reservation' && stored.reservationId && readStays.has(stored.reservationId))
      return sourceRead ? [{ ref: doc.ref, patch: null }] : []
    }
    const patch = changedCheckInCustomerFields(stored, wanted)
    return patch ? [{ ref: doc.ref, patch }] : []
  })
  const firestore = deps.firestore()
  for (const change of changes) {
    await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(change.ref)
      if (!fresh.exists || fresh.get('status') !== 'expected') return
      if (change.patch) transaction.update(change.ref, { ...change.patch, updatedAtMs: nowMs })
      else transaction.delete(change.ref)
    })
  }
  await markerRef.set({ dayKey: day.dayKey, reconciledAtMs: nowMs, truncated })
  return { truncated }
}

/**
 * The check-ins a register sale makes, written the moment it completes so
 * the person who just paid at the window is found on the next search. The
 * day is the sale's own, in the site's zone.
 */
export async function recordSaleCheckIns(deps: PosOpsDeps, event: PosSaleCompletedEvent): Promise<number> {
  const hostId = posOpsCleanId(event.hostId)
  const orderId = posOpsCleanId(event.orderId)
  if (!hostId || !orderId) return 0
  const lines = Array.isArray(event.order?.lineItems) ? event.order.lineItems : []
  if (!lines.length) return 0
  const hostRef = deps.firestore().collection('hosts').doc(hostId)
  const products = await productsFor(deps, hostRef, [event.order])
  if (![...products.values()].length) return 0
  const [host, owner] = await Promise.all([hostRef.get(), deps.orgForHost(hostId)])
  const timeZone = resolveSiteTimeZone(
    (owner?.org ?? null) as { timeZone?: string } | null,
    (host.data() ?? null) as { timeZone?: string } | null,
  )
  const dayKey = zonedDayKey(Number(event.order.createdAtMs ?? deps.now()), timeZone)
  const due = dueCheckInsForOrder({ orderId, order: event.order, products, dayKey })
  if (!due.size) return 0
  return createMissing(hostRef.collection('checkIns'), due, new Set(), deps.now())
}

let subscribed = false

/** Writes a register sale's check-ins as it completes. Never throws into the sale. */
export function registerPosSaleCheckIns(): void {
  if (subscribed) return
  subscribed = true
  onPosSaleCompleted(async (event) => {
    try {
      await recordSaleCheckIns(defaultPosOpsDeps(), event)
    } catch (error) {
      console.error('[pos-check-in] sale check-ins not written', event.orderId, error)
    }
  })
}

/*==========================================
 * THE ROUTE
 *=========================================*/

const rowOf = (doc: FirebaseFirestore.DocumentSnapshot): CheckInRow =>
  ({ ...(doc.data() as HostCheckIn), id: doc.id })

/** Who checks people in: the member a PIN put at the register, else the signed-in one. */
async function checkerOf(
  deps: PosOpsDeps,
  staff: PosOpsStaff,
  body: Record<string, any>,
): Promise<{ uid: string; name: string }> {
  const registerId = posOpsCleanId(body['registerId'])
  const uid = registerId
    ? (await resolvePosCashier(deps, staff, registerId, body['cashierAssertion'])).cashierId
    : staff.uid
  return { uid, name: await deps.memberName(uid) }
}

export async function handlePosCheckIn(deps: PosOpsDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method === 'GET') return handleDayList(deps, req)
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = posOpsBody(req)
  const gate = await authorizePosOps(deps, req, body['hostId'])
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const staff = gate.staff
  const checkIns = staff.hostRef.collection('checkIns')
  const action = String(body['action'] ?? '')

  switch (action) {
    case 'search': {
      const day = await readCheckInDay(deps, staff.hostRef, staff.org, body['day'])
      if ('error' in day) return { status: 400, body: { error: day.error } }
      const text = String(body['text'] ?? '').trim().slice(0, 120)
      const token = checkInSearchToken(text)
      if (text.length < 2 || !token) {
        return { status: 200, body: { dayKey: day.dayKey, timeZone: day.timeZone, customers: [] } }
      }
      await reconcileCheckInDay(deps, staff.hostRef, day)
      const snapshot = await checkIns
        .where('dayKey', '==', day.dayKey)
        .where('searchTokens', 'array-contains', token)
        .limit(CHECK_IN_SEARCH_ROWS)
        .get()
      return {
        status: 200,
        body: {
          dayKey: day.dayKey,
          timeZone: day.timeZone,
          customers: checkInCustomers(snapshot.docs.map(rowOf)).slice(0, CHECK_IN_SEARCH_CUSTOMERS),
        },
      }
    }

    case 'customer': {
      const day = await readCheckInDay(deps, staff.hostRef, staff.org, body['day'])
      if ('error' in day) return { status: 400, body: { error: day.error } }
      const typedKey = String(body['customerKey'] ?? '').trim().slice(0, 300)
      const customerKey =
        typedKey ||
        checkInCustomerKey({
          email: String(body['email'] ?? '').slice(0, 200),
          contactId: posOpsCleanId(body['contactId']) || null,
          fallback: '',
        })
      if (!customerKey) {
        return { status: 400, body: { error: 'Choose a customer.' } }
      }
      // The register's customer panel asks on every customer it attaches
      // (`reconcile: 'if-used'`), so it brings the day in line only on a day
      // the window is already checking people in.
      if (body['reconcile'] !== false) {
        await reconcileCheckInDay(deps, staff.hostRef, day, { onlyIfUsed: body['reconcile'] === 'if-used' })
      }
      const snapshot = await checkIns
        .where('dayKey', '==', day.dayKey)
        .where('customerKey', '==', customerKey)
        .limit(CHECK_IN_DAY_CEILING)
        .get()
      const rows = sortCheckInRows(snapshot.docs.map(rowOf))
      return {
        status: 200,
        body: {
          dayKey: day.dayKey,
          timeZone: day.timeZone,
          customer: checkInCustomers(rows)[0] ?? null,
          checkIns: rows,
        },
      }
    }

    case 'check_in': {
      const entries = Array.isArray(body['checkIns']) ? (body['checkIns'] as unknown[]) : []
      if (!entries.length) return { status: 400, body: { error: 'Choose who to check in.' } }
      if (entries.length > CHECK_IN_BATCH_MAX) {
        return { status: 400, body: { error: `Check in ${CHECK_IN_BATCH_MAX} people or fewer at a time.` } }
      }
      const wanted = new Map<string, CheckInWristband | null>()
      for (const entry of entries) {
        const id = cleanCheckInId((entry as Record<string, unknown>)?.['id'])
        if (!id) return { status: 400, body: { error: 'That is not a check-in.' } }
        const wristband = normalizeWristband((entry as Record<string, unknown>)['wristband'])
        if ('error' in wristband) return { status: 400, body: { error: wristband.error } }
        wanted.set(id, wristband.wristband)
      }
      const attempt = posOpsIdempotencyKey(req) || null
      const checker = await checkerOf(deps, staff, body)
      const nowMs = deps.now()
      const outcome = await deps.firestore().runTransaction(async (transaction) => {
        const done: CheckInRow[] = []
        const already: CheckInRow[] = []
        const missing: string[] = []
        const writes: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Partial<HostCheckIn> }> = []
        for (const [id, wristband] of wanted) {
          const ref = checkIns.doc(id)
          const snapshot = await transaction.get(ref)
          if (!snapshot.exists) {
            missing.push(id)
            continue
          }
          const row = rowOf(snapshot)
          if (row.status === 'checked_in') {
            if (attempt && row.checkInAttempt === attempt) done.push(row)
            else already.push(row)
            continue
          }
          const patch: Partial<HostCheckIn> = {
            status: 'checked_in',
            checkedInAtMs: nowMs,
            checkedInBy: checker.uid,
            checkedInByName: checker.name,
            wristband,
            checkInAttempt: attempt,
            updatedAtMs: nowMs,
          }
          writes.push({ ref, patch })
          done.push({ ...row, ...patch })
        }
        for (const write of writes) transaction.update(write.ref, write.patch)
        return { done, already, missing }
      })
      if (outcome.missing.length && !outcome.done.length && !outcome.already.length) {
        return { status: 404, body: { error: 'That check-in is no longer due.' } }
      }
      return {
        status: 200,
        body: { checkedIn: outcome.done, alreadyCheckedIn: outcome.already, missing: outcome.missing },
      }
    }

    case 'undo':
    case 'wristband': {
      const id = cleanCheckInId(body['id'])
      if (!id) return { status: 400, body: { error: 'That is not a check-in.' } }
      let wristband: CheckInWristband | null = null
      if (action === 'wristband') {
        const parsed = normalizeWristband(body['wristband'])
        if ('error' in parsed) return { status: 400, body: { error: parsed.error } }
        wristband = parsed.wristband
      }
      const checker = action === 'undo' ? await checkerOf(deps, staff, body) : null
      const nowMs = deps.now()
      const ref = checkIns.doc(id)
      const outcome = await deps.firestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return { status: 404, error: 'That check-in is no longer due.' } as const
        const row = rowOf(snapshot)
        if (row.status !== 'checked_in') {
          return { status: 409, error: 'They are not checked in yet.' } as const
        }
        const patch: Partial<HostCheckIn> =
          action === 'undo'
            ? {
                status: 'expected',
                checkedInAtMs: null,
                checkedInBy: null,
                checkedInByName: null,
                wristband: null,
                checkInAttempt: null,
                undoneAtMs: nowMs,
                undoneBy: checker?.uid ?? staff.uid,
                updatedAtMs: nowMs,
              }
            : { wristband, updatedAtMs: nowMs }
        transaction.update(ref, patch)
        return { status: 200, row: { ...row, ...patch } } as const
      })
      if ('error' in outcome) return { status: outcome.status, body: { error: outcome.error } }
      return { status: 200, body: { checkIn: outcome.row } }
    }

    default:
      return { status: 400, body: { error: 'Unknown action' } }
  }
}

async function handleDayList(deps: PosOpsDeps, req: PluginApiRequest): Promise<Outcome> {
  const query = req.query ?? {}
  const gate = await authorizePosOps(deps, req, queryValue(query['hostId']))
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const format = queryValue(query['format']).toLowerCase()
  if (format && format !== 'json' && format !== 'csv') {
    return { status: 400, body: { error: 'Choose json or csv.' } }
  }
  const { staff } = gate
  const day = await readCheckInDay(deps, staff.hostRef, staff.org, queryValue(query['day']))
  if ('error' in day) return { status: 400, body: { error: day.error } }
  const { truncated } = await reconcileCheckInDay(deps, staff.hostRef, day)
  const snapshot = await staff.hostRef
    .collection('checkIns')
    .where('dayKey', '==', day.dayKey)
    .limit(CHECK_IN_DAY_CEILING + 1)
    .get()
  const rows = sortCheckInRows(snapshot.docs.slice(0, CHECK_IN_DAY_CEILING).map(rowOf))
  if (format === 'csv') {
    return { status: 200, csv: checkInDayCsv(rows, day.timeZone), filename: `check-ins-${day.dayKey}.csv` }
  }
  return {
    status: 200,
    body: {
      dayKey: day.dayKey,
      timeZone: day.timeZone,
      totals: checkInDayTotals(rows),
      checkIns: rows,
      truncated: truncated || snapshot.docs.length > CHECK_IN_DAY_CEILING,
    },
  }
}

export function createPosCheckInHandler(deps: () => PosOpsDeps = defaultPosOpsDeps): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosCheckIn(deps(), req)
      res.setHeader('Cache-Control', 'private, no-store')
      if ('csv' in outcome) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${outcome.filename}"`)
        return res.status(200).send(outcome.csv)
      }
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-check-in] failed', error)
      return res.status(500).json({ error: 'Check-in failed. Try again.' })
    }
  }
}

export const posCheckInHandler = createPosCheckInHandler()
