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

/*==========================================
 * THE CONSOLE'S TRANSFER CLIENT (AGL-3539) — the UI kit's `TransferClient`
 * over the job engine's routes (`api/transfer/*`).
 *
 * The kit asks in its own terms (a file as the browser read it, a dry run
 * with every conflict) and the routes answer in the core's
 * (`transfer-api.ts`); this module is the translation, and nothing else:
 *
 *  - upload sends the file in parts whose JSON-encoded size stays under
 *    `TRANSFER_UPLOAD_PART_MAX_BYTES`, never splitting a character, with
 *    the CSV delimiter and header-row choice on the first part;
 *  - apply is one route call (the route writes chunks for its time budget)
 *    and a job that failed is thrown, so the wizard's loop stops on it and
 *    offers Resume instead of calling again at once;
 *  - undo's preview pages every conflict in; its apply is one call, and the
 *    results step calls again until `done`;
 *  - every refusal is thrown as a {@link TransferRequestError} carrying the
 *    route's `code` and `details`.
 *
 * The client is bound to one workspace (and one site, for a site's
 * resource), so no request the kit makes can name another.
 *=========================================*/

import {
  TRANSFER_API_ROUTES,
  TRANSFER_UNDO_PAGE_MAX,
  TRANSFER_UPLOAD_PART_MAX_BYTES,
  summarizeTransferResults,
  type TransferAnalyzeResponse,
  type TransferApiRoute,
  type TransferApplyResponse,
  type TransferErrorCode,
  type TransferErrorResponse,
  type TransferFieldsResponse,
  type TransferPlanResponse,
  type TransferStatusResponse,
  type TransferUndoApplyResponse,
  type TransferUndoConflict,
  type TransferUndoPlanResponse,
  type TransferUploadResponse,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferAnalysis,
  TransferClient,
  TransferDryRun,
} from '@aglyn/aglyn-transfer-ui'

/** A transfer route refused the request. */
export class TransferRequestError extends Error {
  constructor(
    message: string,
    readonly code: TransferErrorCode,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'TransferRequestError'
  }
}

export interface HttpTransferClientOptions {
  orgId: string
  /** The site, for a site's resource. */
  hostId?: string | null
  /** The signed-in member's ID token, sent as the Bearer credential. */
  getIdToken(): Promise<string>
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Bytes one upload request's file text may take once JSON-encoded; defaults to the route's part limit. */
  partBytes?: number
}

/** What one character costs once `JSON.stringify` has encoded it, in UTF-8 bytes. */
function encodedBytes(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (char === '"' || char === '\\') return 2
  if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) return 2
  if (code < 0x20) return 6
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  // A lone surrogate is written as `\uXXXX`.
  if (code >= 0xd800 && code <= 0xdfff) return 6
  return code < 0x10000 ? 3 : 4
}

/**
 * `text` cut into parts each of which, JSON-encoded, takes at most `budget`
 * bytes — and so is under the route's part limit however many quotes and
 * line breaks it carries. Parts end on a character boundary, so each is
 * valid text and their bytes join back into the file.
 */
export function splitTransferUpload(text: string, budget = TRANSFER_UPLOAD_PART_MAX_BYTES): string[] {
  const parts: string[] = []
  let start = 0
  let at = 0
  let used = 0
  for (const char of text) {
    const cost = encodedBytes(char)
    if (used + cost > budget && at > start) {
      parts.push(text.slice(start, at))
      start = at
      used = 0
    }
    used += cost
    at += char.length
  }
  parts.push(text.slice(start))
  return parts
}

/** The kit's client over the routes (see the block header). */
export function createHttpTransferClient(options: HttpTransferClientOptions): TransferClient {
  const run = options.fetch ?? ((input, init) => fetch(input, init))
  const hostId = options.hostId || null

  async function post<T>(route: TransferApiRoute, body: Record<string, unknown>): Promise<T> {
    const token = await options.getIdToken()
    const response = await run(TRANSFER_API_ROUTES[route], {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: options.orgId, ...body }),
    })
    const payload = (await response.json().catch(() => null)) as (T & { ok?: true }) | TransferErrorResponse | null
    if (!response.ok || !payload || !('ok' in payload)) {
      const refusal = payload && 'code' in payload ? payload : null
      throw new TransferRequestError(
        refusal?.error || 'The request failed. Try again.',
        refusal?.code ?? 'failed',
        response.status,
        refusal?.details,
      )
    }
    return payload as T
  }

  return {
    async fields({ resource }) {
      const { ok: _ok, ...info } = await post<TransferFieldsResponse>('fields', { resource, hostId })
      return info
    },

    async upload({ resource, fileName, text, settings }) {
      const parts = splitTransferUpload(text, options.partBytes)
      const csv = settings.format === 'csv'
      let jobId: string | undefined
      let answer: TransferUploadResponse | null = null
      for (const [part, content] of parts.entries()) {
        answer = await post<TransferUploadResponse>('upload', {
          resource,
          hostId,
          fileName,
          format: settings.format,
          content,
          ...(parts.length > 1 ? { part, parts: parts.length } : {}),
          ...(jobId ? { jobId } : {}),
          ...(csv && part === 0 ? { delimiter: settings.delimiter, headerRow: settings.headerRow } : {}),
        })
        jobId = answer.job.id
      }
      if (!answer?.complete) throw new TransferRequestError('The file did not finish uploading. Try again.', 'failed', 500)
      return answer.job
    },

    async analyze(request): Promise<TransferAnalysis> {
      const answer = await post<TransferAnalyzeResponse>('analyze', {
        jobId: request.jobId,
        ...(request.mapping ? { mapping: request.mapping } : {}),
        ...(request.mapping && request.matchKeys ? { matchKeys: request.matchKeys } : {}),
        ...(request.mapping && request.dateOrders ? { dateOrders: request.dateOrders } : {}),
      })
      return {
        job: answer.job,
        headers: answer.headers,
        sampleRows: answer.samples,
        rowCount: answer.rowCount,
        proposal: answer.match,
        picklists: answer.picklists,
        ...(answer.derivations ? { derivations: answer.derivations } : {}),
        ...(answer.lookups ? { lookups: answer.lookups } : {}),
        ...(answer.matches ? { matches: answer.matches } : {}),
        ...(answer.recordLabels ? { recordLabels: answer.recordLabels } : {}),
      }
    },

    async plan(request): Promise<TransferDryRun> {
      // The route applies the resource's locked rules over whatever is sent.
      const { locked: _locked, ...policy } = request.policy
      const answer = await post<TransferPlanResponse>('plan', {
        jobId: request.jobId,
        mapping: request.mapping,
        policy,
        ...(request.matchKeys ? { matchKeys: request.matchKeys } : {}),
        ...(request.picklistChoices ? { picklistChoices: request.picklistChoices } : {}),
        ...(request.dateOrders ? { dateOrders: request.dateOrders } : {}),
        ...(request.lookupChoices ? { lookupChoices: request.lookupChoices } : {}),
        ...(request.extras ? { extras: request.extras } : {}),
      })
      return {
        job: answer.job,
        plan: {
          rows: answer.sample,
          summary: answer.summary,
          warnings: answer.warnings,
          acknowledgementsRequired: answer.acknowledgementsRequired,
        },
        rowsComplete: answer.sample.length >= answer.summary.total,
        conflicts: answer.conflicts,
        conflictCount: answer.conflictCount,
        ambiguous: answer.ambiguous,
        recordLabels: answer.recordLabels,
      }
    },

    async apply({ jobId, acknowledged }) {
      const answer = await post<TransferApplyResponse>('apply', {
        jobId,
        ...(acknowledged ? { acknowledged } : {}),
      })
      if (answer.job.status === 'failed') {
        throw new TransferRequestError(
          answer.job.error?.message ?? 'The import stopped. Resume to carry on from where it stopped.',
          'failed',
          200,
          answer.job.error,
        )
      }
      return {
        job: answer.job,
        results: answer.results,
        rowsDone: answer.progress.rowsDone,
        rowCount: answer.progress.rowCount,
        done: answer.done,
      }
    },

    async status({ jobId }) {
      return (await post<TransferStatusResponse>('status', { jobId })).job
    },

    async results({ jobId }) {
      const answer = await post<TransferStatusResponse>('status', { jobId, include: 'results' })
      const rows = answer.rows ?? []
      return { job: answer.job, summary: answer.job.results ?? summarizeTransferResults(rows), rows }
    },

    async undo(request) {
      if (request.mode === 'apply') {
        const answer = await post<TransferUndoApplyResponse>('undo', {
          jobId: request.jobId,
          action: 'apply',
          decisions: request.decisions,
          otherwise: request.otherwise ?? 'keep',
        })
        return { job: answer.job, counts: answer.undo.counts, conflicts: [], done: answer.done }
      }
      const conflicts: TransferUndoConflict[] = []
      let offset: number | null = 0
      let answer: TransferUndoPlanResponse | null = null
      while (offset !== null) {
        answer = await post<TransferUndoPlanResponse>('undo', {
          jobId: request.jobId,
          action: 'plan',
          offset,
          limit: TRANSFER_UNDO_PAGE_MAX,
        })
        conflicts.push(...answer.conflicts)
        offset = answer.next
      }
      const last = answer as TransferUndoPlanResponse
      return { job: last.job, counts: last.counts, conflicts, done: false }
    },

    async export() {
      throw new TransferRequestError('Exporting is not available here yet.', 'unavailable', 501)
    },

    async savePrefs() {
      throw new TransferRequestError('Saving export choices is not available here yet.', 'unavailable', 501)
    },
  }
}
