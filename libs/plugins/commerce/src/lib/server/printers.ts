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

import * as Aglyn from '@aglyn/aglyn/server'
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  normalizePrinterDeviceId,
  PRINTER_BRANDS,
  type PosPrinter,
  type PrinterBrand,
  type PrintReport,
} from '../model/commerce-printers'
import { receiptDataFromOrder, type ReceiptData } from '../model/commerce-receipt'
import type { HostOrder } from '../model/commerce-orders'
import { enqueuePrintJob, printJobsRef, printersRef } from './print-queue'
import { printerPollUrl } from './printer-secret'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'

/**
 * `POST /api/commerce/printers` (AGL-3619): a register's cloud receipt
 * printers, from the Hardware card, and the jobs a manager sends them by hand
 * (a test page, a reprint, "open drawer").
 *
 * Every write to `printers` and `printJobs` is here or in the poll routes:
 * the Firestore rules deny both to every client, so a printer's identity, its
 * secret's version and its queue cannot be edited around this gate.
 */

/** A counter seldom has more than two; the cap keeps a typo loop from minting dozens. */
export const MAX_PRINTERS_PER_REGISTER = 4

interface PrinterManager {
  uid: string
  hostId: string
}

/**
 * The register's gate (`pos-order.ts`): `admin` or `editor` on THIS site,
 * `managePos` on the member's permissions, and `pos` on the owning plan.
 */
export async function authorizePrinterManager(
  req: PluginApiRequest,
  hostId: string,
): Promise<{ ok: true; manager: PrinterManager } | { ok: false; status: number; error: string }> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) return { ok: false, status: 400, error: 'Missing hostId' }
  let uid: string
  try {
    uid = (await firebaseAdmin.app().auth().verifyIdToken(idToken)).uid
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
  if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
  const role = (host.get('memberRoles') ?? {})[uid]
  if (role !== 'admin' && role !== 'editor') return { ok: false, status: 403, error: 'Not permitted' }
  const membership = await resolveOrgPermissions(uid, { hostId })
  if (!membership.permissions.managePos) return { ok: false, status: 403, error: 'Not permitted' }
  const owner = await getOrgForHost(hostId)
  if (!Aglyn.checkEntitlement(owner?.org as any, 'pos')) {
    return { ok: false, status: 403, error: 'POS requires the Pro plan or above' }
  }
  return { ok: true, manager: { uid, hostId } }
}

function requestBody(req: PluginApiRequest): Record<string, any> {
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {}
}

const text = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)

/** The editable settings in a create or update body, validated. */
export function printerSettingsFromBody(
  body: Record<string, any>,
  brand: PrinterBrand,
): { ok: true; patch: Partial<PosPrinter> } | { ok: false; error: string } {
  const patch: Partial<PosPrinter> = {}
  if ('name' in body) {
    const name = text(body['name'], 60)
    if (!name) return { ok: false, error: 'Name the printer' }
    patch.name = name
  }
  if ('model' in body) patch.model = text(body['model'], 40)
  if ('deviceId' in body) {
    const deviceId = normalizePrinterDeviceId(brand, body['deviceId'])
    if (!deviceId) {
      return {
        ok: false,
        error:
          brand === 'star'
            ? 'Enter the printer’s MAC address, e.g. 00:11:62:12:34:56'
            : 'Enter the Server Direct Print ID: 1-30 letters, digits, dots, dashes or underscores',
      }
    }
    patch.deviceId = deviceId
  }
  if ('paperWidthMm' in body) patch.paperWidthMm = Number(body['paperWidthMm']) === 58 ? 58 : 80
  if ('autoPrintReceipts' in body) patch.autoPrintReceipts = body['autoPrintReceipts'] === true
  if ('kickDrawer' in body) patch.kickDrawer = body['kickDrawer'] === true
  if ('kitchenTickets' in body) patch.kitchenTickets = body['kitchenTickets'] === true
  if ('logoKey' in body) {
    const logoKey = text(body['logoKey'], 10)
    const valid =
      !logoKey ||
      (brand === 'star'
        ? /^\d{1,3}$/.test(logoKey) && Number(logoKey) >= 1 && Number(logoKey) <= 255
        : /^\d{2,3}\s*,\s*\d{2,3}$/.test(logoKey))
    if (!valid) {
      return {
        ok: false,
        error:
          brand === 'star'
            ? 'The logo number is 1-255, as stored with Star Quick Setup Utility'
            : 'The logo key is two numbers, e.g. 48,48, as stored with Epson TM Utility',
      }
    }
    patch.logoKey = logoKey.replace(/\s+/g, '')
  }
  return { ok: true, patch }
}

/** What the card shows a manager to paste into the printer's web configuration. */
export function printerCredentials(hostId: string, printerId: string, printer: PosPrinter) {
  return {
    printerId,
    brand: printer.brand,
    pollUrl: printerPollUrl(printer.brand, hostId, printerId, printer.secretVersion),
    deviceId: printer.deviceId,
  }
}

/** What a receipt needs from the site, the location and the register. */
export async function receiptContextFor(
  hostId: string,
  order: Pick<HostOrder, 'locationId'> & { registerId?: string },
  firestore: any = firebaseAdmin.app().firestore(),
) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [host, owner, location, register] = await Promise.all([
    hostRef.get(),
    getOrgForHost(hostId).catch(() => null),
    order.locationId ? hostRef.collection('locations').doc(order.locationId).get() : null,
    order.registerId ? hostRef.collection('registers').doc(order.registerId).get() : null,
  ])
  const storeLines = [location?.get?.('address')].filter(Boolean).map(String)
  return {
    storeName: String(host.get('displayName') ?? host.get('subdomain') ?? 'Receipt'),
    ...(storeLines.length ? { storeLines } : {}),
    ...(register?.exists ? { registerName: String(register.get('name') ?? '') } : {}),
    timeZone: resolveSiteTimeZone(owner?.org as any, host.data?.() ?? {}),
  }
}

/** The receipt an order prints, with the site's name, address and time zone. */
export async function orderReceipt(
  hostId: string,
  orderId: string,
  order: HostOrder & Record<string, any>,
  options: { banner?: string; firestore?: any } = {},
): Promise<ReceiptData> {
  const context = await receiptContextFor(hostId, order, options.firestore)
  return receiptDataFromOrder(orderId, order, {
    ...context,
    ...(options.banner ? { banner: options.banner } : {}),
  })
}

/**
 * Queues work for a register's printers (AGL-3619): a receipt for every
 * printer set to auto-print, and a drawer kick on the FIRST printer set to
 * kick the drawer (a till has one drawer; two kicks would be one too many).
 * When the receipt printer is also the drawer printer, the kick rides the
 * receipt job so the drawer opens as the receipt starts.
 *
 * `kitchenTicket` prints on every printer set to print kitchen tickets, and
 * only when asked for: a Z-report or a paid-out slip is not an order to make.
 *
 * `receiptChoice` is what the customer said at the register: `none` (or a
 * receipt sent by email or text) prints no customer receipt; `print` prints
 * one even when no printer auto-prints, on the register's first printer.
 * Absent, the printers' own "every sale" setting decides.
 *
 * `idempotencyKey` names the cause (a sale's order id, a shift event's id): a
 * cause delivered twice queues its jobs once.
 */
export async function queueRegisterPrint(input: {
  hostId: string
  registerId: string
  receipt?: ReceiptData
  /** A shift report (AGL-3609): printed once, on the register's receipt printer. */
  report?: PrintReport
  kitchenTicket?: ReceiptData
  receiptChoice?: 'print' | 'none'
  openDrawer?: boolean
  orderId?: string
  reason: string
  idempotencyKey?: string
  createdBy?: string
  firestore?: any
  nowMs?: number
}): Promise<{ jobIds: string[] }> {
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  if (!input.registerId) return { jobIds: [] }
  const snapshot = await printersRef(firestore, input.hostId)
    .where('registerId', '==', input.registerId)
    .limit(MAX_PRINTERS_PER_REGISTER)
    .get()
  const printers = snapshot.docs
    .map((doc: any) => ({ id: doc.id, printer: doc.data() as PosPrinter }))
    .sort((a: any, b: any) => a.printer.createdAtMs - b.printer.createdAtMs || a.id.localeCompare(b.id))
  const drawerPrinter = input.openDrawer
    ? printers.find((entry: any) => entry.printer.kickDrawer)
    : undefined
  const jobIds: string[] = []
  const key = (suffix: string) =>
    input.idempotencyKey
      ? `${input.reason}-${input.idempotencyKey}-${suffix}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
      : undefined
  let drawerHandled = false
  const receiptPrinters =
    input.receiptChoice === 'none'
      ? []
      : printers.filter((entry: any) => entry.printer.autoPrintReceipts)
  if (input.receiptChoice === 'print' && !receiptPrinters.length && printers.length) {
    receiptPrinters.push(printers[0])
  }
  if (input.receipt) {
    for (const entry of receiptPrinters) {
      const openDrawer = drawerPrinter?.id === entry.id
      drawerHandled ||= openDrawer
      const { jobId } = await enqueuePrintJob(
        firestore,
        input.hostId,
        entry.id,
        {
          kind: 'receipt',
          receipt: input.receipt,
          openDrawer,
          orderId: input.orderId,
          registerId: input.registerId,
          reason: input.reason,
          createdBy: input.createdBy,
          jobId: key(entry.id),
        },
        input.nowMs,
      )
      jobIds.push(jobId)
    }
  }
  if (input.report) {
    // One copy, on the printer that prints receipts — or the till's only one.
    const target = printers.find((entry: any) => entry.printer.autoPrintReceipts) ?? printers[0]
    if (target) {
      const { jobId } = await enqueuePrintJob(
        firestore,
        input.hostId,
        target.id,
        {
          kind: 'report',
          report: input.report,
          registerId: input.registerId,
          reason: input.reason,
          createdBy: input.createdBy,
          jobId: key(`${target.id}-report`),
        },
        input.nowMs,
      )
      jobIds.push(jobId)
    }
  }
  if (input.kitchenTicket) {
    for (const entry of printers) {
      if (!entry.printer.kitchenTickets) continue
      const { jobId } = await enqueuePrintJob(
        firestore,
        input.hostId,
        entry.id,
        {
          kind: 'kitchen',
          receipt: input.kitchenTicket,
          orderId: input.orderId,
          registerId: input.registerId,
          reason: input.reason,
          createdBy: input.createdBy,
          jobId: key(`${entry.id}-kitchen`),
        },
        input.nowMs,
      )
      jobIds.push(jobId)
    }
  }
  if (drawerPrinter && !drawerHandled) {
    const { jobId } = await enqueuePrintJob(
      firestore,
      input.hostId,
      drawerPrinter.id,
      {
        kind: 'drawer',
        orderId: input.orderId,
        registerId: input.registerId,
        reason: input.reason,
        createdBy: input.createdBy,
        jobId: key(`${drawerPrinter.id}-drawer`),
      },
      input.nowMs,
    )
    jobIds.push(jobId)
  }
  return { jobIds }
}

export const printersHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = requestBody(req)
  const hostId = text(body['hostId'], 128)
  const gate = await authorizePrinterManager(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const { uid } = gate.manager
  const firestore = firebaseAdmin.app().firestore()
  const printers = printersRef(firestore, hostId)
  const action = text(body['action'], 20)
  const printerId = text(body['printerId'], 128)
  const loadPrinter = async () => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(printerId)) return null
    const snapshot = await printers.doc(printerId).get()
    return snapshot.exists ? { ref: snapshot.ref, printer: snapshot.data() as PosPrinter } : null
  }
  try {
    switch (action) {
      case 'create': {
        const brand = text(body['brand'], 10) as PrinterBrand
        if (!PRINTER_BRANDS.includes(brand)) return res.status(400).json({ error: 'Choose Star or Epson' })
        const registerId = text(body['registerId'], 128)
        const register = /^[A-Za-z0-9_-]{1,128}$/.test(registerId)
          ? await firestore.collection('hosts').doc(hostId).collection('registers').doc(registerId).get()
          : null
        if (!register?.exists) return res.status(404).json({ error: 'Unknown register' })
        const settings = printerSettingsFromBody(
          { name: '', deviceId: '', ...body },
          brand,
        )
        if ('error' in settings) return res.status(400).json({ error: settings.error })
        const siblings = await printers.where('registerId', '==', registerId).limit(MAX_PRINTERS_PER_REGISTER).get()
        if (siblings.size >= MAX_PRINTERS_PER_REGISTER) {
          return res.status(409).json({
            error: `A register can have up to ${MAX_PRINTERS_PER_REGISTER} printers.`,
          })
        }
        const duplicate = await printers.where('deviceId', '==', settings.patch.deviceId).limit(1).get()
        if (!duplicate.empty) {
          return res.status(409).json({ error: 'That printer is already added to this site.' })
        }
        const ref = printers.doc(createResourceUid())
        const printer: PosPrinter = {
          name: settings.patch.name!,
          brand,
          model: settings.patch.model ?? '',
          deviceId: settings.patch.deviceId!,
          registerId,
          paperWidthMm: settings.patch.paperWidthMm ?? 80,
          autoPrintReceipts: settings.patch.autoPrintReceipts ?? true,
          kickDrawer: settings.patch.kickDrawer ?? false,
          kitchenTickets: settings.patch.kitchenTickets ?? false,
          ...(settings.patch.logoKey ? { logoKey: settings.patch.logoKey } : {}),
          secretVersion: 1,
          createdAtMs: Date.now(),
          createdBy: uid,
        }
        await ref.set(printer)
        return res.status(200).json(printerCredentials(hostId, ref.id, printer))
      }
      case 'update': {
        const loaded = await loadPrinter()
        if (!loaded) return res.status(404).json({ error: 'Unknown printer' })
        const settings = printerSettingsFromBody(body, loaded.printer.brand)
        if ('error' in settings) return res.status(400).json({ error: settings.error })
        if (settings.patch.deviceId && settings.patch.deviceId !== loaded.printer.deviceId) {
          const duplicate = await printers.where('deviceId', '==', settings.patch.deviceId).limit(1).get()
          if (!duplicate.empty) {
            return res.status(409).json({ error: 'That printer is already added to this site.' })
          }
        }
        await loaded.ref.set({ ...settings.patch, updatedAtMs: Date.now() }, { merge: true })
        return res.status(200).json({ ok: true })
      }
      case 'remove': {
        const loaded = await loadPrinter()
        if (!loaded) return res.status(200).json({ ok: true })
        const active = await printJobsRef(firestore, hostId)
          .where('printerId', '==', printerId)
          .where('status', 'in', ['queued', 'printing'])
          .orderBy('createdAtMs', 'asc')
          .limit(50)
          .get()
        const batch = firestore.batch()
        for (const doc of active.docs) {
          batch.update(doc.ref, { status: 'canceled', finishedAtMs: Date.now() })
        }
        batch.delete(loaded.ref)
        await batch.commit()
        return res.status(200).json({ ok: true })
      }
      case 'credentials': {
        const loaded = await loadPrinter()
        if (!loaded) return res.status(404).json({ error: 'Unknown printer' })
        return res.status(200).json(printerCredentials(hostId, printerId, loaded.printer))
      }
      case 'regenerate': {
        const loaded = await loadPrinter()
        if (!loaded) return res.status(404).json({ error: 'Unknown printer' })
        const secretVersion = Math.max(1, Number(loaded.printer.secretVersion) || 1) + 1
        await loaded.ref.set({ secretVersion, updatedAtMs: Date.now() }, { merge: true })
        return res
          .status(200)
          .json(printerCredentials(hostId, printerId, { ...loaded.printer, secretVersion }))
      }
      case 'test':
      case 'drawer': {
        const loaded = await loadPrinter()
        if (!loaded) return res.status(404).json({ error: 'Unknown printer' })
        const context = action === 'test' ? await receiptContextFor(hostId, {}, firestore) : null
        const { jobId } = await enqueuePrintJob(firestore, hostId, printerId, {
          kind: action,
          registerId: loaded.printer.registerId,
          reason: action === 'test' ? 'test' : 'open_drawer',
          createdBy: uid,
          ...(context ? { storeName: context.storeName, timeZone: context.timeZone } : {}),
          ...(action === 'test' && body['openDrawer'] === true ? { openDrawer: true } : {}),
        })
        return res.status(200).json({ jobId })
      }
      case 'reprint': {
        const orderId = text(body['orderId'], 128)
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) return res.status(400).json({ error: 'Missing orderId' })
        const orderSnapshot = await firestore.collection('hosts').doc(hostId).collection('orders').doc(orderId).get()
        if (!orderSnapshot.exists) return res.status(404).json({ error: 'Unknown order' })
        const order = orderSnapshot.data() as HostOrder & Record<string, any>
        let target = printerId ? await loadPrinter() : null
        if (!target && order['registerId']) {
          const candidates = await printers
            .where('registerId', '==', String(order['registerId']))
            .limit(MAX_PRINTERS_PER_REGISTER)
            .get()
          const doc = candidates.docs.find((d: any) => d.get('autoPrintReceipts')) ?? candidates.docs[0]
          if (doc) target = { ref: doc.ref, printer: doc.data() as PosPrinter }
        }
        if (!target) return res.status(404).json({ error: 'No printer for this register' })
        const receipt = await orderReceipt(hostId, orderId, order, { banner: 'REPRINT', firestore })
        const { jobId } = await enqueuePrintJob(firestore, hostId, target.ref.id, {
          kind: 'receipt',
          receipt,
          orderId,
          registerId: target.printer.registerId,
          reason: 'reprint',
          createdBy: uid,
        })
        return res.status(200).json({ jobId })
      }
      case 'cancel': {
        const jobId = text(body['jobId'], 128)
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return res.status(400).json({ error: 'Missing jobId' })
        const ref = printJobsRef(firestore, hostId).doc(jobId)
        const outcome = await firestore.runTransaction(async (transaction: any) => {
          const snapshot = await transaction.get(ref)
          if (!snapshot.exists) return 'missing'
          if (snapshot.get('status') !== 'queued') return 'started'
          transaction.update(ref, { status: 'canceled', finishedAtMs: Date.now() })
          return 'canceled'
        })
        if (outcome === 'missing') return res.status(404).json({ error: 'Unknown job' })
        if (outcome === 'started') {
          return res.status(409).json({ error: 'The printer already has it.' })
        }
        return res.status(200).json({ ok: true })
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[printers]', action, error)
    return res.status(500).json({ error: 'The printer could not be updated' })
  }
}
