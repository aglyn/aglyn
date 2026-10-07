/**
 * @jest-environment node
 */
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
} from '../model/commerce-printers'
import { MemoryFirestore } from '../testing/memory-firestore'
import {
  claimNextPrintJob,
  claimPrintJob,
  enqueuePrintJob,
  finishPrintJob,
  nextPrintJobFor,
} from './print-queue'

const HOST = 'host1'
const PRINTER = 'printer1'
const T0 = 1_790_000_000_000

const job = (firestore: MemoryFirestore, id: string) =>
  firestore.read(`hosts/${HOST}/printJobs/${id}`) as Record<string, any>

describe('the print job queue (AGL-3619)', () => {
  let firestore: MemoryFirestore
  beforeEach(() => {
    firestore = new MemoryFirestore()
  })

  it('queues a job with its deadline and a week of retention', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'drawer', reason: 'paid_out' }, T0)
    expect(job(firestore, jobId)).toMatchObject({
      printerId: PRINTER,
      kind: 'drawer',
      status: 'queued',
      attempts: 0,
      deliverByMs: T0 + PRINT_JOB_DELIVER_WITHIN_MS.drawer,
    })
    expect(job(firestore, jobId)['expiresAt']).toBeInstanceOf(Date)
  })

  it('queues a repeated cause once', async () => {
    const first = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'receipt', jobId: 'sale-o1-p1' }, T0)
    const second = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'receipt', jobId: 'sale-o1-p1' }, T0 + 5)
    expect(first).toEqual({ jobId: 'sale-o1-p1', created: true })
    expect(second).toEqual({ jobId: 'sale-o1-p1', created: false })
    expect(job(firestore, 'sale-o1-p1')['createdAtMs']).toBe(T0)
  })

  it('offers the oldest job first and only this printer’s', async () => {
    await enqueuePrintJob(firestore, HOST, 'other', { kind: 'test' }, T0)
    const a = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'test' }, T0 + 1)
    await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'test' }, T0 + 2)
    expect((await nextPrintJobFor(firestore, HOST, PRINTER, T0 + 10))?.id).toBe(a.jobId)
  })

  it('claiming moves a job to printing and counts the attempt; a re-GET is the same delivery', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'test' }, T0)
    const claimed = await claimPrintJob(firestore, HOST, PRINTER, jobId, T0 + 10)
    expect(claimed?.job).toMatchObject({ status: 'printing', attempts: 1, claimedAtMs: T0 + 10 })
    const again = await claimPrintJob(firestore, HOST, PRINTER, jobId, T0 + 20)
    expect(again?.job.attempts).toBe(1)
    expect(job(firestore, jobId)['attempts']).toBe(1)
  })

  it('never hands one printer another printer’s job', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, 'other', { kind: 'test' }, T0)
    expect(await claimPrintJob(firestore, HOST, PRINTER, jobId, T0)).toBeNull()
    expect(await finishPrintJob(firestore, HOST, PRINTER, jobId, { ok: true, code: '200 OK' }, T0)).toBeNull()
    expect(job(firestore, jobId)['status']).toBe('queued')
  })

  it('two polls that arrive together take different jobs (the claim is a transaction)', async () => {
    const a = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'test' }, T0)
    const b = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'test' }, T0 + 1)
    const [first, second] = await Promise.all([
      claimNextPrintJob(firestore, HOST, PRINTER, T0 + 10),
      claimNextPrintJob(firestore, HOST, PRINTER, T0 + 10),
    ])
    expect(new Set([first?.id, second?.id])).toEqual(new Set([a.jobId, b.jobId]))
    expect(firestore.retries).toBeGreaterThan(0)
    expect(job(firestore, a.jobId)['attempts']).toBe(1)
    expect(job(firestore, b.jobId)['attempts']).toBe(1)
  })

  it('two polls racing for ONE job: exactly one gets it', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'drawer' }, T0)
    const results = await Promise.all([
      claimNextPrintJob(firestore, HOST, PRINTER, T0 + 10),
      claimNextPrintJob(firestore, HOST, PRINTER, T0 + 10),
      claimNextPrintJob(firestore, HOST, PRINTER, T0 + 10),
    ])
    expect(results.filter(Boolean).map((result) => result?.id)).toEqual([jobId])
    expect(job(firestore, jobId)['attempts']).toBe(1)
  })

  it('re-delivers a job taken and never confirmed, then fails it after its attempts', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'receipt' }, T0)
    let now = T0
    for (let attempt = 1; attempt <= PRINT_JOB_MAX_ATTEMPTS; attempt += 1) {
      const claimed = await claimNextPrintJob(firestore, HOST, PRINTER, now)
      expect(claimed?.job.attempts).toBe(attempt)
      // Fresh claim: an Epson poll right after is told nothing.
      expect(await claimNextPrintJob(firestore, HOST, PRINTER, now + 1000)).toBeNull()
      now += PRINT_JOB_CLAIM_TIMEOUT_MS + 1
    }
    expect(await claimNextPrintJob(firestore, HOST, PRINTER, now)).toBeNull()
    expect(job(firestore, jobId)).toMatchObject({ status: 'failed', attempts: PRINT_JOB_MAX_ATTEMPTS })
  })

  it('a printer failure puts the job back until its attempts are used', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'receipt' }, T0)
    await claimPrintJob(firestore, HOST, PRINTER, jobId, T0 + 1)
    expect(await finishPrintJob(firestore, HOST, PRINTER, jobId, { ok: false, code: '410 Out of paper' }, T0 + 2)).toBe(
      'queued',
    )
    expect(job(firestore, jobId)['resultCode']).toBe('410 Out of paper')
    for (let attempt = 2; attempt <= PRINT_JOB_MAX_ATTEMPTS; attempt += 1) {
      const claimed = await claimPrintJob(firestore, HOST, PRINTER, jobId, T0 + attempt * 10)
      expect(claimed?.job.attempts).toBe(attempt)
      const outcome = await finishPrintJob(firestore, HOST, PRINTER, jobId, { ok: false, code: '520' }, T0 + attempt * 10 + 1)
      expect(outcome).toBe(attempt === PRINT_JOB_MAX_ATTEMPTS ? 'failed' : 'queued')
    }
  })

  it('success closes the job; a repeated confirmation changes nothing', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'receipt' }, T0)
    await claimPrintJob(firestore, HOST, PRINTER, jobId, T0 + 1)
    expect(await finishPrintJob(firestore, HOST, PRINTER, jobId, { ok: true, code: '200 OK' }, T0 + 2)).toBe('done')
    expect(await finishPrintJob(firestore, HOST, PRINTER, jobId, { ok: false, code: '520' }, T0 + 3)).toBe('done')
    expect(job(firestore, jobId)).toMatchObject({ status: 'done', finishedAtMs: T0 + 2, resultCode: '200 OK' })
  })

  it('never opens a drawer late: an undelivered kick expires', async () => {
    const { jobId } = await enqueuePrintJob(firestore, HOST, PRINTER, { kind: 'drawer' }, T0)
    const late = T0 + PRINT_JOB_DELIVER_WITHIN_MS.drawer + 1
    expect(await nextPrintJobFor(firestore, HOST, PRINTER, late)).toBeNull()
    expect(job(firestore, jobId)['status']).toBe('expired')
    expect(await claimPrintJob(firestore, HOST, PRINTER, jobId, late)).toBeNull()
  })

  it('refuses a job id that is a path', async () => {
    expect(await claimPrintJob(firestore, HOST, PRINTER, '../x', T0)).toBeNull()
    expect(await finishPrintJob(firestore, HOST, PRINTER, 'a/b', { ok: true, code: '' }, T0)).toBeNull()
  })
})
