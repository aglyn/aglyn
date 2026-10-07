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

import type { ReceiptData } from './commerce-receipt'

/**
 * Cloud receipt printers (AGL-3619).
 *
 * A browser register cannot reach a USB or LAN printer without a driver, and
 * an https console cannot talk to a printer's plain-http web service. Both
 * vendors that matter at a counter solve this the same way: the PRINTER polls
 * an https URL, and the server answers with the next job.
 *
 *  - Star CloudPRNT (mC-Print3, TSP100IV, mC-Label3): the printer POSTs its
 *    status as JSON, GETs the job when told one is ready, and DELETEs it to
 *    confirm, with the result in a `code` query parameter.
 *  - Epson Server Direct Print (TM-m30III, TM-m50, TM-T88VII): the printer
 *    POSTs a form (`ConnectionType=GetRequest`) and receives ePOS-Print XML in
 *    the response, then POSTs `ConnectionType=SetResponse` with the result.
 *
 * Every printer belongs to one register and polls one URL that carries the
 * site, the printer and a per-printer secret. The secret is not stored: it is
 * an HMAC of those ids and a rotation counter (`server/printer-secret.ts`), so
 * the console can show it to a manager again and "Regenerate" invalidates the
 * old URL by bumping the counter.
 *
 * `hosts/{hostId}/printers/{printerId}` and `hosts/{hostId}/printJobs/{jobId}`
 * are written only by the server (the Firestore rules deny every client
 * write); the console reads both to show status and recent jobs.
 */

export type PrinterBrand = 'star' | 'epson'

export const PRINTER_BRANDS: readonly PrinterBrand[] = ['star', 'epson']

export const PRINTER_BRAND_LABELS: Record<PrinterBrand, string> = {
  star: 'Star Micronics (CloudPRNT)',
  epson: 'Epson (Server Direct Print)',
}

/** The models we document and test against, per brand. Free text is allowed. */
export const PRINTER_MODEL_SUGGESTIONS: Record<PrinterBrand, readonly string[]> = {
  star: ['mC-Print3', 'TSP143IV', 'TSP100IV SK', 'mC-Label3'],
  epson: ['TM-m30III', 'TM-m30II', 'TM-m50II', 'TM-T88VII'],
}

/** Roll width; it sets the characters per line. */
export type PrinterPaperWidth = 80 | 58

/** Characters per line in the printer's default font A, by roll width. */
export function printerColumns(paperWidthMm: PrinterPaperWidth | undefined): number {
  return paperWidthMm === 58 ? 32 : 48
}

/**
 * What the printer last told us about itself. `online` means it can print;
 * `paper_low` still prints. Everything else stops printing until a person
 * fixes it.
 */
export type PrinterState =
  | 'online'
  | 'paper_low'
  | 'paper_out'
  | 'cover_open'
  | 'error'
  | 'unknown'

export const PRINTER_STATE_LABELS: Record<PrinterState, string> = {
  online: 'Online',
  paper_low: 'Paper low',
  paper_out: 'Out of paper',
  cover_open: 'Cover open',
  error: 'Printer error',
  unknown: 'Waiting for the printer',
}

/** A printer that has not polled for this long is shown as offline. */
export const PRINTER_OFFLINE_AFTER_MS = 2 * 60 * 1000

export interface PrinterStatus {
  state: PrinterState
  /** The printer's own words, e.g. Star's `410 Out of paper` or Epson's `EPTR_COVER_OPEN`. */
  detail?: string
  /** Last time the printer polled, ms since epoch. */
  atMs: number
  /** Polling interval the printer reported (Star `GetPollInterval`), seconds. */
  pollSeconds?: number
}

/** `hosts/{hostId}/printers/{printerId}` (AGL-3619). Server-written only. */
export interface PosPrinter {
  name: string
  brand: PrinterBrand
  model?: string
  /**
   * The printer's identity as it reports it: the Ethernet MAC for Star
   * (`00:11:62:aa:bb:cc`, lower case), the Server Direct Print `ID` set in
   * Epson's WebConfig. A poll that names a different device is refused, so a
   * leaked URL alone cannot drain the queue from another printer.
   */
  deviceId: string
  registerId: string
  paperWidthMm?: PrinterPaperWidth
  /** Print a customer receipt when a sale on this register completes. */
  autoPrintReceipts: boolean
  /** Open the cash drawer wired to this printer on cash sales, cash refunds and paid-outs. */
  kickDrawer: boolean
  /**
   * The NV logo stored in the printer with the vendor's utility, printed at the
   * top of every receipt: Star's logo number (1-255), Epson's `key1,key2`
   * (e.g. `48,48`). Empty prints no logo.
   */
  logoKey?: string
  /** Bumped by "Regenerate URL"; part of the HMAC that makes the secret. */
  secretVersion: number
  status?: PrinterStatus
  createdAtMs: number
  createdBy?: string
  updatedAtMs?: number
}

export type PrintJobKind = 'receipt' | 'drawer' | 'test' | 'report'

/**
 * A titled report printed on the receipt roll (AGL-3609): a register shift's
 * X or Z report. Rows are already formatted, so every printer prints the
 * figures the console shows.
 */
export interface PrintReport {
  title: string
  storeName: string
  subtitle?: string
  sections: Array<{ section: string; rows: Array<{ label: string; value: string; strong?: boolean }> }>
}

export type PrintJobStatus = 'queued' | 'printing' | 'done' | 'failed' | 'expired' | 'canceled'

export const PRINT_JOB_ACTIVE_STATUSES: readonly PrintJobStatus[] = ['queued', 'printing']

export const PRINT_JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  queued: 'Waiting',
  printing: 'Printing',
  done: 'Printed',
  failed: 'Failed',
  expired: 'Expired',
  canceled: 'Canceled',
}

/** `hosts/{hostId}/printJobs/{jobId}` (AGL-3619). Server-written only. */
export interface PrintJob {
  printerId: string
  registerId?: string
  kind: PrintJobKind
  status: PrintJobStatus
  /** The receipt to render; the printer's brand and width decide the bytes at delivery. */
  receipt?: ReceiptData
  /** The report a `report` job prints. */
  report?: PrintReport
  /** Open the drawer as this job starts (a cash sale's receipt). */
  openDrawer?: boolean
  /** The store a test page names. */
  storeName?: string
  /** IANA zone a test page prints its time in. */
  timeZone?: string
  orderId?: string
  /** Why it was printed, for the jobs list: `sale`, `reprint`, `paid_out`, … */
  reason?: string
  /** Deliveries so far; each GET (Star) or poll hand-off (Epson) counts one. */
  attempts: number
  createdAtMs: number
  claimedAtMs?: number
  finishedAtMs?: number
  /** After this the job is never delivered: a drawer that opens minutes later is a hazard. */
  deliverByMs: number
  /** The printer's last result for this job, e.g. `200 OK`, `EPTR_REC_EMPTY`. */
  resultCode?: string
  error?: string
  createdBy?: string
  /** Firestore TTL: the row is removed a week after it is written. */
  expiresAt?: unknown
}

/** A job is re-offered if its printer took it and never confirmed within this. */
export const PRINT_JOB_CLAIM_TIMEOUT_MS = 90 * 1000

/** Deliveries before a job that keeps failing is given up on. */
export const PRINT_JOB_MAX_ATTEMPTS = 3

/**
 * How long each kind may wait for its printer. A receipt still matters for a
 * while after the customer leaves; a drawer kick must never fire long after
 * the sale that asked for it, because by then the drawer opening is unexpected
 * cash exposure at an unattended till.
 */
export const PRINT_JOB_DELIVER_WITHIN_MS: Record<PrintJobKind, number> = {
  receipt: 30 * 60 * 1000,
  test: 10 * 60 * 1000,
  drawer: 2 * 60 * 1000,
  report: 30 * 60 * 1000,
}

/** Print-job rows are kept for a week, then removed by the Firestore TTL policy. */
export const PRINT_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Star MACs and Epson IDs as we store them. */
export function normalizePrinterDeviceId(brand: PrinterBrand, raw: unknown): string {
  const value = String(raw ?? '').trim()
  if (brand === 'star') {
    const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '')
    if (hex.length !== 12) return ''
    return hex.match(/../g)!.join(':')
  }
  // Epson's WebConfig ID: the same 1-30 safe characters its job ids allow.
  return /^[A-Za-z0-9._-]{1,30}$/.test(value) ? value : ''
}

/**
 * A Star status code (`200 OK`, `211 Paper low`, `410%20Out%20of%20paper`) as
 * a printer state. Codes are three or four digits followed by an optional
 * description, URL-encoded because the printer also sends them as a query
 * parameter. Families: 2xx online, 41x paper, 42x cover, 4xx/5xx/1xxx errors.
 */
export function starPrinterState(rawStatusCode: unknown): { state: PrinterState; detail: string } {
  let detail = String(rawStatusCode ?? '').trim()
  try {
    detail = decodeURIComponent(detail.replace(/\+/g, ' '))
  } catch {
    // Not URL-encoded after all; keep the raw text.
  }
  const code = detail.match(/^\d{3,4}/)?.[0] ?? ''
  if (!code) return { state: 'unknown', detail }
  if (code === '211') return { state: 'paper_low', detail }
  if (code.startsWith('2')) return { state: 'online', detail }
  if (code.length === 3 && code.startsWith('41')) return { state: 'paper_out', detail }
  if (code.length === 3 && code.startsWith('42')) return { state: 'cover_open', detail }
  return { state: 'error', detail }
}

/** Epson ASB status bits we act on (ePOS-Print XML `<response status>`). */
export const EPSON_ASB = {
  OFFLINE: 0x00000008,
  COVER_OPEN: 0x00000020,
  MECHANICAL_ERROR: 0x00000400,
  AUTOCUTTER_ERROR: 0x00000800,
  UNRECOVERABLE_ERROR: 0x00002000,
  AUTORECOVER_ERROR: 0x00004000,
  RECEIPT_NEAR_END: 0x00020000,
  RECEIPT_END: 0x00080000,
} as const

/**
 * An Epson result (`success`, `code`, `status`) as a printer state. The code
 * names the failure when printing failed; the ASB bits say what the printer
 * looks like now, which matters on success too (paper near end).
 */
export function epsonPrinterState(input: {
  success: boolean
  code?: string
  status?: number
}): { state: PrinterState; detail: string } {
  const code = String(input.code ?? '')
  const status = Number.isFinite(input.status) ? Number(input.status) : 0
  if (code === 'EPTR_REC_EMPTY' || status & EPSON_ASB.RECEIPT_END) {
    return { state: 'paper_out', detail: code || 'Roll paper has run out' }
  }
  if (code === 'EPTR_COVER_OPEN' || status & EPSON_ASB.COVER_OPEN) {
    return { state: 'cover_open', detail: code || 'Cover is open' }
  }
  if (
    !input.success ||
    status &
      (EPSON_ASB.MECHANICAL_ERROR |
        EPSON_ASB.AUTOCUTTER_ERROR |
        EPSON_ASB.UNRECOVERABLE_ERROR |
        EPSON_ASB.AUTORECOVER_ERROR)
  ) {
    return { state: 'error', detail: code || 'Printer error' }
  }
  if (status & EPSON_ASB.RECEIPT_NEAR_END) {
    return { state: 'paper_low', detail: 'Roll paper is nearly out' }
  }
  return { state: 'online', detail: code }
}

/** The state a console row shows: a printer that stopped polling is offline whatever it said last. */
export function printerDisplayState(
  status: PrinterStatus | undefined,
  nowMs: number,
): PrinterState | 'offline' {
  if (!status?.atMs) return 'unknown'
  if (nowMs - status.atMs > PRINTER_OFFLINE_AFTER_MS) return 'offline'
  return status.state
}
