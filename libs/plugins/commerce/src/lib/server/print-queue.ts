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

import {
  PRINT_JOB_CLAIM_TIMEOUT_MS,
  PRINT_JOB_DELIVER_WITHIN_MS,
  PRINT_JOB_MAX_ATTEMPTS,
  PRINT_JOB_RETENTION_MS,
  printerColumns,
  type PosPrinter,
  type PrintJob,
  type PrintJobKind,
} from '../model/commerce-printers'
import type { ReceiptData } from '../model/commerce-receipt'
import {
  layoutDrawerKick,
  layoutReceipt,
  layoutTestPage,
  type PrintDocument,
} from '../printing/print-document'

/**
 * The cloud printer job queue (AGL-3619): `hosts/{hostId}/printJobs`.
 *
 * A job is `queued` until its printer takes it, `printing` once it has, and
 * `done` / `failed` / `expired` / `canceled` after. The lifecycle is driven by
 * the PRINTER — it polls, takes, and confirms — so every transition that a
 * second poll could race runs in a Firestore transaction:
 *
 *  - taking a job (`claimPrintJob`, `claimNextPrintJob`) moves it to
 *    `printing` and counts the attempt. Two polls that arrive together cannot
 *    both hand an Epson the same job, because the second transaction re-reads
 *    a fresh claim and skips it.
 *  - a printer that took a job and never confirmed (power cut, network drop)
 *    gets it again after {@link PRINT_JOB_CLAIM_TIMEOUT_MS}, up to
 *    {@link PRINT_JOB_MAX_ATTEMPTS} deliveries, then the job fails and the
 *    console says so.
 *  - nothing is delivered after its `deliverByMs`: a receipt half an hour late
 *    is confusing, and a drawer that springs open minutes after the sale that
 *    asked for it is cash exposure at an unattended till.
 *
 * Star re-requests the job it was offered (`jobToken`) after an offline spell
 * such as an empty roll, so a `printing` job is offered to its own printer
 * again — Star's GET is idempotent by design. Epson has no GET: the poll
 * response IS the delivery, so Epson only gets a job that nobody holds.
 *
 * The Firestore handle is injected so the transitions are tested against an
 * in-memory store that runs transactions optimistically, as Firestore does.
 */

type Firestore = any

export function printJobsRef(firestore: Firestore, hostId: string) {
  return firestore.collection('hosts').doc(hostId).collection('printJobs')
}

export function printersRef(firestore: Firestore, hostId: string) {
  return firestore.collection('hosts').doc(hostId).collection('printers')
}

export interface EnqueuePrintJobInput {
  kind: PrintJobKind
  receipt?: ReceiptData
  openDrawer?: boolean
  storeName?: string
  timeZone?: string
  orderId?: string
  registerId?: string
  reason?: string
  createdBy?: string
  /**
   * A deterministic id for a job that must print at most once however often
   * its cause repeats — a sale-completed event delivered twice. A second
   * enqueue under the same id is a no-op.
   */
  jobId?: string
}

/** Queues one job for one printer; returns its id (the existing one for a repeated `jobId`). */
export async function enqueuePrintJob(
  firestore: Firestore,
  hostId: string,
  printerId: string,
  input: EnqueuePrintJobInput,
  nowMs: number = Date.now(),
): Promise<{ jobId: string; created: boolean }> {
  const collection = printJobsRef(firestore, hostId)
  const ref = input.jobId ? collection.doc(input.jobId) : collection.doc()
  const job: PrintJob = {
    printerId,
    ...(input.registerId ? { registerId: input.registerId } : {}),
    kind: input.kind,
    status: 'queued',
    ...(input.receipt ? { receipt: input.receipt } : {}),
    ...(input.openDrawer ? { openDrawer: true } : {}),
    ...(input.storeName ? { storeName: input.storeName } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    ...(input.orderId ? { orderId: input.orderId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    attempts: 0,
    createdAtMs: nowMs,
    deliverByMs: nowMs + PRINT_JOB_DELIVER_WITHIN_MS[input.kind],
    expiresAt: new Date(nowMs + PRINT_JOB_RETENTION_MS),
  }
  if (!input.jobId) {
    await ref.set(job)
    return { jobId: ref.id, created: true }
  }
  try {
    await ref.create(job)
    return { jobId: ref.id, created: true }
  } catch (error: any) {
    // ALREADY_EXISTS: the same cause asked twice, and the first one stands.
    if (error?.code === 6 || /already exists/i.test(String(error?.message))) {
      return { jobId: ref.id, created: false }
    }
    throw error
  }
}

type Deliverability = 'deliver' | 'skip' | 'expire' | 'fail'

/**
 * What a poll should do with an active job, for the given brand.
 *
 * `skip` is a job someone else (this printer, a moment ago) holds and whose
 * claim is still fresh — Epson must not be handed it twice.
 */
export function printJobDeliverability(
  job: PrintJob,
  options: { nowMs: number; reofferHeld: boolean },
): Deliverability {
  const { nowMs } = options
  if (job.status === 'queued') {
    return nowMs > job.deliverByMs ? 'expire' : 'deliver'
  }
  if (job.status !== 'printing') return 'skip'
  const stale = nowMs - Number(job.claimedAtMs ?? 0) > PRINT_JOB_CLAIM_TIMEOUT_MS
  if (stale && job.attempts >= PRINT_JOB_MAX_ATTEMPTS) return 'fail'
  if (stale) return nowMs > job.deliverByMs ? 'expire' : 'deliver'
  return options.reofferHeld ? 'deliver' : 'skip'
}

function activeJobsQuery(firestore: Firestore, hostId: string, printerId: string) {
  return printJobsRef(firestore, hostId)
    .where('printerId', '==', printerId)
    .where('status', 'in', ['queued', 'printing'])
    .orderBy('createdAtMs', 'asc')
    .limit(10)
}

function closingPatch(outcome: 'expire' | 'fail', nowMs: number): Partial<PrintJob> {
  return outcome === 'expire'
    ? { status: 'expired', finishedAtMs: nowMs, error: 'The printer did not take it in time.' }
    : {
        status: 'failed',
        finishedAtMs: nowMs,
        error: 'The printer took it but never confirmed printing it.',
      }
}

/**
 * The job a Star printer should be told about on its status POST, without
 * taking it: CloudPRNT's GET does the taking. Jobs past their time are closed
 * on the way.
 */
export async function nextPrintJobFor(
  firestore: Firestore,
  hostId: string,
  printerId: string,
  nowMs: number = Date.now(),
): Promise<{ id: string; job: PrintJob } | null> {
  const snapshot = await activeJobsQuery(firestore, hostId, printerId).get()
  for (const doc of snapshot.docs) {
    const job = doc.data() as PrintJob
    const verdict = printJobDeliverability(job, { nowMs, reofferHeld: true })
    if (verdict === 'deliver') return { id: doc.id, job }
    if (verdict === 'expire' || verdict === 'fail') {
      await closeIfStill(firestore, doc.ref, job.status, closingPatch(verdict, nowMs))
    }
  }
  return null
}

async function closeIfStill(
  firestore: Firestore,
  ref: any,
  status: PrintJob['status'],
  patch: Partial<PrintJob>,
): Promise<void> {
  await firestore.runTransaction(async (transaction: any) => {
    const fresh = await transaction.get(ref)
    if (fresh.exists && fresh.get('status') === status) transaction.update(ref, patch)
  })
}

/**
 * Takes a named job for its printer (Star's GET with a `jobToken`): moves it
 * to `printing` and counts the attempt. `null` when the job is not this
 * printer's, is finished, or is past its time.
 */
export async function claimPrintJob(
  firestore: Firestore,
  hostId: string,
  printerId: string,
  jobId: string,
  nowMs: number = Date.now(),
): Promise<{ id: string; job: PrintJob } | null> {
  if (!jobId || jobId.includes('/')) return null
  const ref = printJobsRef(firestore, hostId).doc(jobId)
  return firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const job = snapshot.data() as PrintJob
    if (job.printerId !== printerId) return null
    const verdict = printJobDeliverability(job, { nowMs, reofferHeld: true })
    if (verdict === 'expire' || verdict === 'fail') {
      transaction.update(ref, closingPatch(verdict, nowMs))
      return null
    }
    if (verdict !== 'deliver') return null
    // A re-GET of a job this printer already holds (Star retries a download
    // that timed out) is the same delivery, not another attempt.
    const fresh =
      job.status === 'printing' && nowMs - Number(job.claimedAtMs ?? 0) <= PRINT_JOB_CLAIM_TIMEOUT_MS
    const patch: Partial<PrintJob> = fresh
      ? {}
      : { status: 'printing', claimedAtMs: nowMs, attempts: job.attempts + 1 }
    if (!fresh) transaction.update(ref, patch)
    return { id: snapshot.id, job: { ...job, ...patch } }
  })
}

/**
 * Takes the oldest job nobody holds (Epson's poll, which is the delivery) in
 * one transaction, so two polls that arrive together get different answers.
 */
export async function claimNextPrintJob(
  firestore: Firestore,
  hostId: string,
  printerId: string,
  nowMs: number = Date.now(),
): Promise<{ id: string; job: PrintJob } | null> {
  const query = activeJobsQuery(firestore, hostId, printerId)
  return firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(query)
    let taken: { id: string; job: PrintJob } | null = null
    for (const doc of snapshot.docs) {
      const job = doc.data() as PrintJob
      const verdict = printJobDeliverability(job, { nowMs, reofferHeld: false })
      if (verdict === 'expire' || verdict === 'fail') {
        transaction.update(doc.ref, closingPatch(verdict, nowMs))
        continue
      }
      if (verdict !== 'deliver' || taken) continue
      const patch: Partial<PrintJob> = {
        status: 'printing',
        claimedAtMs: nowMs,
        attempts: job.attempts + 1,
      }
      transaction.update(doc.ref, patch)
      taken = { id: doc.id, job: { ...job, ...patch } }
    }
    return taken
  })
}

/**
 * Records a printer's result for a job it took. Success closes it; a failure
 * puts it back in the queue until it has used its attempts. Idempotent: a
 * repeated confirmation (Star retries an unanswered DELETE) changes nothing.
 */
export async function finishPrintJob(
  firestore: Firestore,
  hostId: string,
  printerId: string,
  jobId: string,
  result: { ok: boolean; code: string },
  nowMs: number = Date.now(),
): Promise<PrintJob['status'] | null> {
  if (!jobId || jobId.includes('/')) return null
  const ref = printJobsRef(firestore, hostId).doc(jobId)
  return firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const job = snapshot.data() as PrintJob
    if (job.printerId !== printerId) return null
    if (job.status !== 'printing' && job.status !== 'queued') return job.status
    const code = String(result.code ?? '').slice(0, 120)
    let patch: Partial<PrintJob>
    if (result.ok) {
      patch = { status: 'done', finishedAtMs: nowMs, resultCode: code }
    } else if (job.attempts >= PRINT_JOB_MAX_ATTEMPTS || nowMs > job.deliverByMs) {
      patch = {
        status: 'failed',
        finishedAtMs: nowMs,
        resultCode: code,
        error: `The printer could not print it (${code || 'no reason given'}).`,
      }
    } else {
      patch = { status: 'queued', resultCode: code }
    }
    transaction.update(ref, patch)
    return patch.status ?? job.status
  })
}

/** The oldest job a printer holds, for a Star confirmation that carries no `jobToken` (older firmware). */
export async function heldPrintJobId(
  firestore: Firestore,
  hostId: string,
  printerId: string,
): Promise<string | null> {
  const snapshot = await activeJobsQuery(firestore, hostId, printerId).get()
  const held = snapshot.docs.find((doc: any) => doc.get('status') === 'printing')
  return held?.id ?? null
}

/** The printer-neutral document a job prints, for this printer's paper and logo. */
export function printJobDocument(
  job: PrintJob,
  printer: Pick<PosPrinter, 'paperWidthMm' | 'logoKey' | 'name'>,
): PrintDocument {
  const columns = printerColumns(printer.paperWidthMm)
  const logo = Boolean(printer.logoKey)
  if (job.kind === 'receipt' && job.receipt) {
    return layoutReceipt(job.receipt, { columns, logo, openDrawer: job.openDrawer })
  }
  if (job.kind === 'test') {
    return layoutTestPage({
      columns,
      printerName: printer.name,
      storeName: job.storeName ?? '',
      atMs: job.createdAtMs,
      timeZone: job.timeZone,
      logo,
      openDrawer: job.openDrawer,
    })
  }
  return layoutDrawerKick(columns)
}
