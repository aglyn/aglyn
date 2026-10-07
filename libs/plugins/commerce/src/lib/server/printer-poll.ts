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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  epsonPrinterState,
  normalizePrinterDeviceId,
  starPrinterState,
  type PosPrinter,
  type PrinterBrand,
  type PrinterState,
  type PrinterStatus,
} from '../model/commerce-printers'
import { renderEpsonServerDirectPrint, parseEpsonPrintResults } from '../printing/render-epson'
import { renderStar, STAR_MEDIA_TYPE } from '../printing/render-star'
import { renderText } from '../printing/render-text'
import {
  claimNextPrintJob,
  claimPrintJob,
  finishPrintJob,
  heldPrintJobId,
  nextPrintJobFor,
  printersRef,
  printJobDocument,
} from './print-queue'
import { printerSecretMatches } from './printer-secret'

/**
 * The two doors a cloud receipt printer polls (AGL-3619), registered as
 * MACHINE routes on the console dispatcher: a printer names no member and no
 * site cookie, so the dispatcher's enablement and release gates cannot judge
 * it, and its write limit would refuse a device that polls every few seconds.
 * The route authenticates the printer itself — the per-printer secret in the
 * path and the device identity in the request — and asks the plan before it
 * hands over a job.
 *
 *   /api/commerce/cloudprnt/{hostId}/{printerId}/{secret}   Star CloudPRNT
 *   /api/commerce/epson-sdp/{hostId}/{printerId}/{secret}   Epson Server Direct Print
 *
 * Every refusal is a bare 404 that says nothing about which part was wrong.
 */

const NO_STORE = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
}

/** A status write at most this often while nothing changes, so a 5-second poll is not 17,000 writes a day. */
const STATUS_HEARTBEAT_MS = 60 * 1000

/** Polls report bodies this small; anything larger is not a printer. */
const MAX_BODY_BYTES = 64 * 1024

type RouteParams = { params: Record<string, string | string[]> }

function param(context: RouteParams, name: string): string {
  const value = context.params?.[name]
  return String(Array.isArray(value) ? value[0] : (value ?? ''))
}

const notFound = () => new Response(null, { status: 404, headers: NO_STORE })

export interface ResolvedPrinter {
  hostId: string
  printerId: string
  printer: PosPrinter
  ref: any
}

/** The printer the URL names, when its secret is right and its brand matches the door. */
export async function resolvePolledPrinter(
  context: RouteParams,
  brand: PrinterBrand,
  firestore: any = firebaseAdmin.app().firestore(),
): Promise<ResolvedPrinter | null> {
  const hostId = param(context, 'hostId')
  const printerId = param(context, 'printerId')
  const secret = param(context, 'secret')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId) || !/^[A-Za-z0-9_-]{1,128}$/.test(printerId)) {
    return null
  }
  const ref = printersRef(firestore, hostId).doc(printerId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return null
  const printer = snapshot.data() as PosPrinter
  if (printer.brand !== brand) return null
  if (!printerSecretMatches(hostId, printerId, printer.secretVersion, secret)) return null
  return { hostId, printerId, printer, ref }
}

/** The device on the wire is the device on the record. */
function deviceMatches(printer: PosPrinter, reported: unknown): boolean {
  const presented = normalizePrinterDeviceId(printer.brand, reported)
  return Boolean(presented) && presented === printer.deviceId
}

/** May this site's printers be handed work now: the plan still carries POS. */
async function printingAllowed(hostId: string): Promise<boolean> {
  try {
    const owner = await getOrgForHost(hostId)
    return Aglyn.checkEntitlement(owner?.org as any, 'pos')
  } catch {
    return false
  }
}

/** Writes the printer's status when it changed or the heartbeat is due. */
export async function recordPrinterStatus(
  resolved: ResolvedPrinter,
  next: { state: PrinterState; detail?: string; pollSeconds?: number },
  nowMs: number,
): Promise<void> {
  const previous = resolved.printer.status
  const changed =
    !previous ||
    previous.state !== next.state ||
    (previous.detail ?? '') !== (next.detail ?? '') ||
    (next.pollSeconds !== undefined && previous.pollSeconds !== next.pollSeconds)
  if (!changed && nowMs - Number(previous?.atMs ?? 0) < STATUS_HEARTBEAT_MS) return
  const status: PrinterStatus = {
    state: next.state,
    atMs: nowMs,
    ...(next.detail ? { detail: next.detail.slice(0, 120) } : {}),
    ...((next.pollSeconds ?? previous?.pollSeconds) !== undefined
      ? { pollSeconds: next.pollSeconds ?? previous?.pollSeconds }
      : {}),
  }
  await resolved.ref.set({ status }, { merge: true })
}

async function readBody(request: Request): Promise<string> {
  const text = await request.text()
  return text.length > MAX_BODY_BYTES ? '' : text
}

/*==========================================
 * STAR CLOUDPRNT
 *=========================================*/

/** The media types we serve a Star job in, preferred first. */
export const STAR_JOB_MEDIA_TYPES = [STAR_MEDIA_TYPE, 'text/plain'] as const

/**
 * The status POST: record what the printer says, and tell it whether a job is
 * waiting. The job is OFFERED (with its id as the `jobToken`), not taken; the
 * printer's GET takes it.
 */
export async function handleStarPoll(
  resolved: ResolvedPrinter,
  body: Record<string, any>,
  options: { firestore?: any; nowMs?: number; allowed?: () => Promise<boolean> } = {},
): Promise<Record<string, unknown> | null> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  if (!deviceMatches(resolved.printer, body['printerMAC'])) return null
  const { state, detail } = starPrinterState(body['statusCode'])
  const actions: any[] = Array.isArray(body['clientAction']) ? body['clientAction'] : []
  const interval = Number(
    actions.find((action) => action?.request === 'GetPollInterval')?.result,
  )
  const pollSeconds = Number.isFinite(interval) && interval > 0 ? Math.round(interval) : undefined
  await recordPrinterStatus(resolved, { state, detail, pollSeconds }, nowMs)
  const next = await nextPrintJobFor(firestore, resolved.hostId, resolved.printerId, nowMs)
  if (next && (await (options.allowed ?? (() => printingAllowed(resolved.hostId)))())) {
    return {
      jobReady: true,
      mediaTypes: [...STAR_JOB_MEDIA_TYPES],
      jobToken: next.id,
      deleteMethod: 'DELETE',
    }
  }
  // Ask once how often it polls, so the console can say when it will next
  // look. A client action and a job are never sent together: the printer would
  // answer the action and hold the job until the next poll.
  if (resolved.printer.status?.pollSeconds === undefined && pollSeconds === undefined) {
    return { jobReady: false, clientAction: [{ request: 'GetPollInterval', options: '' }] }
  }
  return { jobReady: false }
}

/** The job download: take it and render it in the media type the printer chose. */
export async function handleStarJobRequest(
  resolved: ResolvedPrinter,
  query: URLSearchParams,
  options: { firestore?: any; nowMs?: number; allowed?: () => Promise<boolean> } = {},
): Promise<{ contentType: string; body: Uint8Array | string } | null> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  if (!deviceMatches(resolved.printer, query.get('mac'))) return null
  if (!(await (options.allowed ?? (() => printingAllowed(resolved.hostId)))())) return null
  let jobId = query.get('token') ?? ''
  if (!jobId) {
    const next = await nextPrintJobFor(firestore, resolved.hostId, resolved.printerId, nowMs)
    jobId = next?.id ?? ''
  }
  const claimed = await claimPrintJob(firestore, resolved.hostId, resolved.printerId, jobId, nowMs)
  if (!claimed) return null
  const document = printJobDocument(claimed.job, resolved.printer)
  const type = (query.get('type') ?? STAR_MEDIA_TYPE).toLowerCase()
  if (type.startsWith('text/plain')) {
    return { contentType: 'text/plain; charset=us-ascii', body: renderText(document) }
  }
  return {
    contentType: STAR_MEDIA_TYPE,
    body: renderStar(document, { logoKey: resolved.printer.logoKey }),
  }
}

/** The confirmation: `code` 2xx is printed; anything else is a failure to retry or give up on. */
export async function handleStarConfirmation(
  resolved: ResolvedPrinter,
  query: URLSearchParams,
  options: { firestore?: any; nowMs?: number } = {},
): Promise<boolean> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  if (!deviceMatches(resolved.printer, query.get('mac'))) return false
  const jobId =
    query.get('token') || (await heldPrintJobId(firestore, resolved.hostId, resolved.printerId))
  if (!jobId) return true
  const code = query.get('code') ?? ''
  await finishPrintJob(
    firestore,
    resolved.hostId,
    resolved.printerId,
    jobId,
    { ok: code.trim().startsWith('2'), code },
    nowMs,
  )
  const { state, detail } = starPrinterState(code)
  if (state !== 'online' && state !== 'unknown') {
    await recordPrinterStatus(resolved, { state, detail }, nowMs)
  }
  return true
}

/** `/api/commerce/cloudprnt/:hostId/:printerId/:secret` */
export async function cloudPrntRoute(request: Request, context: RouteParams): Promise<Response> {
  const resolved = await resolvePolledPrinter(context, 'star')
  if (!resolved) return notFound()
  const query = new URL(request.url).searchParams
  const method = request.method.toUpperCase()
  if (method === 'POST') {
    let body: Record<string, any>
    try {
      body = JSON.parse(await readBody(request))
    } catch {
      return notFound()
    }
    const answer = await handleStarPoll(resolved, body ?? {})
    if (!answer) return notFound()
    return Response.json(answer, { headers: NO_STORE })
  }
  // A server that cannot take DELETE may ask for `deleteMethod: GET`, which
  // arrives as a GET carrying `delete`; this one asks for DELETE, but a
  // printer configured either way is answered.
  if (method === 'DELETE' || (method === 'GET' && query.has('delete'))) {
    const ok = await handleStarConfirmation(resolved, query)
    return ok ? new Response(null, { status: 200, headers: NO_STORE }) : notFound()
  }
  if (method === 'GET') {
    const job = await handleStarJobRequest(resolved, query)
    if (!job) return notFound()
    const body =
      typeof job.body === 'string'
        ? job.body
        : job.body.buffer.slice(job.body.byteOffset, job.body.byteOffset + job.body.byteLength)
    return new Response(body as BodyInit, {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': job.contentType },
    })
  }
  return new Response(null, { status: 405, headers: NO_STORE })
}

/*==========================================
 * EPSON SERVER DIRECT PRINT
 *=========================================*/

/**
 * One Epson POST. `GetRequest` is a poll whose answer is the job itself, so
 * the job is TAKEN here; `SetResponse` reports how each job went. Returns the
 * XML to send back, `''` for "nothing to print", or `null` to refuse.
 */
export async function handleEpsonPost(
  resolved: ResolvedPrinter,
  form: URLSearchParams,
  options: { firestore?: any; nowMs?: number; allowed?: () => Promise<boolean> } = {},
): Promise<string | null> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  if (!deviceMatches(resolved.printer, form.get('ID'))) return null
  const connection = form.get('ConnectionType') ?? ''
  if (connection === 'GetRequest') {
    // A poll says the printer is reachable; what it looks like comes with results.
    const last = resolved.printer.status
    const state: PrinterState =
      last && last.state !== 'unknown' && nowMs - last.atMs < 10 * 60 * 1000 ? last.state : 'online'
    await recordPrinterStatus(resolved, { state, detail: last?.detail }, nowMs)
    if (!(await (options.allowed ?? (() => printingAllowed(resolved.hostId)))())) return ''
    const claimed = await claimNextPrintJob(firestore, resolved.hostId, resolved.printerId, nowMs)
    if (!claimed) return ''
    return renderEpsonServerDirectPrint(printJobDocument(claimed.job, resolved.printer), {
      jobId: claimed.id,
      logoKey: resolved.printer.logoKey,
    })
  }
  if (connection === 'SetResponse') {
    const results = parseEpsonPrintResults(form.get('ResponseFile') ?? '')
    for (const result of results) {
      await finishPrintJob(
        firestore,
        resolved.hostId,
        resolved.printerId,
        result.jobId,
        { ok: result.success, code: result.code || (result.success ? 'success' : 'failed') },
        nowMs,
      )
    }
    const last = results[results.length - 1]
    if (last) {
      const { state, detail } = epsonPrinterState(last)
      await recordPrinterStatus(resolved, { state, detail }, nowMs)
    }
    return ''
  }
  return null
}

/** `/api/commerce/epson-sdp/:hostId/:printerId/:secret` */
export async function epsonServerDirectPrintRoute(
  request: Request,
  context: RouteParams,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return new Response(null, { status: 405, headers: NO_STORE })
  }
  const resolved = await resolvePolledPrinter(context, 'epson')
  if (!resolved) return notFound()
  const answer = await handleEpsonPost(resolved, new URLSearchParams(await readBody(request)))
  if (answer === null) return notFound()
  return new Response(answer, {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'text/xml; charset=utf-8' },
  })
}
