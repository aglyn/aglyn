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
 * THE FIELD-SELECTABLE EXPORT (AGL-3525) — any resource, the fields the
 * person chose, in their order, streamed.
 *
 * The resource's plugin reads its own records (`readPage`, page by page,
 * holding only the chosen fields) and this module writes them as CSV, JSON
 * or NDJSON (`export-file.ts` in the core), so every resource's file reads
 * the same way and maps straight back in on import.
 *
 * ## The file says how many rows it promised
 *
 * A stream that dies halfway is a well-formed shorter file. So the rows are
 * counted BEFORE the first byte — by the resource's `count` hook, or by
 * reading ahead up to `TRANSFER_EXPORT_PREFETCH_ROWS` — and the route sends
 * the count as `X-Aglyn-Export-Rows`, which the console's client checks the
 * download against (`exportShortfall`'s convention). A resource that cannot
 * count and holds more than the read-ahead sends no count rather than a
 * wrong one.
 *
 * ## Scope is the plugin's to honor
 *
 * The export reads through the Admin SDK, past the rules, so a collaborator
 * scoped to some sites is handed to `readPage` as `scopeTokens`, the tokens
 * a row's `visibleTo` must hold one of — what the rules would have asked.
 *
 * ## Remembered choices
 *
 * `users/{uid}/transferPrefs/{resourceKey}` holds a person's last export
 * choice and saved presets; the owner reads and writes it (rules), and the
 * `fields` route reads it here to open the dialog where they left it.
 *=========================================*/

import {
  TRANSFER_EXPORT_PAGE_ROWS,
  TRANSFER_EXPORT_PREFETCH_ROWS,
  TRANSFER_EXPORT_SELECTION_MAX,
  TRANSFER_PREFS_COLLECTION,
  normalizeTransferPrefs,
  resolveTransferFieldSelection,
  transferContentType,
  transferExportCsvHeader,
  transferExportCsvLine,
  transferExportFileName,
  transferExportHeaders,
  transferExportRecord,
  type TransferExportChoice,
  type TransferFormat,
  type TransferPrefs,
} from '@aglyn/aglyn/data-transfer'
import {
  transferRecordsHooks,
  transferResourceCatalog,
  type TransferReadOptions,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  TransferEngineError,
  resolveTransferRecordsResource,
  transferHostIdFor,
  type TransferEngineDeps,
} from './transfer-jobs'

const FORMATS: readonly TransferFormat[] = ['csv', 'json', 'ndjson']

export interface TransferExportInput extends TransferExportChoice {
  orgId: string
  actorUid: string
  hostId?: string | null
  /** A scoped collaborator's tokens; absent for a reader who sees the whole workspace. */
  scopeTokens?: readonly string[]
}

export interface TransferExportFile {
  stream: ReadableStream<Uint8Array>
  /** The rows the file holds, when they could be counted before the first byte. */
  rows: number | null
  fileName: string
  contentType: string
  /** The fields written, in order. */
  fieldIds: string[]
  /** The resource's name, for the audit and the file. */
  label: string
}

/** The read options an export's scope makes, or the refusal. */
function readOptionsFor(input: TransferExportInput): TransferReadOptions {
  const options: TransferReadOptions = { pageSize: TRANSFER_EXPORT_PAGE_ROWS }
  const scope = input.scope as TransferExportChoice['scope'] | undefined
  if (scope?.kind === 'selection') {
    const ids = [...new Set((Array.isArray(scope.ids) ? scope.ids : []).filter((id) => typeof id === 'string' && id))]
    if (!ids.length) throw new TransferEngineError('invalid', 400, 'Select the records to export.')
    if (ids.length > TRANSFER_EXPORT_SELECTION_MAX) {
      throw new TransferEngineError(
        'tooLarge',
        413,
        `Select at most ${TRANSFER_EXPORT_SELECTION_MAX.toLocaleString('en-US')} records, or export the filter or everything.`,
      )
    }
    options.ids = ids
  } else if (scope?.kind === 'filter') {
    if (!scope.filter || typeof scope.filter !== 'object' || Array.isArray(scope.filter)) {
      throw new TransferEngineError('invalid', 400, 'The filter could not be read.')
    }
    options.filter = scope.filter as Readonly<Record<string, unknown>>
  } else if (scope?.kind !== 'all') {
    throw new TransferEngineError('invalid', 400, 'Say which records to export.')
  }
  if (input.scopeTokens) options.scopeTokens = [...input.scopeTokens]
  return options
}

/**
 * The export, ready to stream (see the block header): the resource
 * resolved, the fields checked against its catalog in the person's order,
 * the rows counted when they can be, and a stream that reads the rest page
 * by page. A field the catalog no longer has, a format the resource does not
 * write, or an empty selection is refused before a byte is sent.
 */
export async function streamTransferExport(
  deps: Pick<TransferEngineDeps, 'resolveResource' | 'now'>,
  input: TransferExportInput,
): Promise<TransferExportFile> {
  const resource = await resolveTransferRecordsResource(deps, String(input.resource ?? '').trim())
  const ctx: TransferResourceContext = {
    resource: resource.key,
    orgId: input.orgId,
    hostId: transferHostIdFor(resource, input.hostId),
    actorUid: input.actorUid,
  }
  const format = input.format
  if (!FORMATS.includes(format) || !resource.formats.includes(format)) {
    throw new TransferEngineError(
      'unsupportedFormat',
      415,
      `${resource.label} can be exported as ${resource.formats.join(', ').toUpperCase()}.`,
    )
  }
  const catalog = await transferResourceCatalog(resource, ctx)
  const selection = resolveTransferFieldSelection(
    catalog,
    (Array.isArray(input.fieldIds) ? input.fieldIds : []).filter((id): id is string => typeof id === 'string'),
  )
  if (selection.unknown.length) {
    throw new TransferEngineError('invalid', 400, 'Some chosen fields no longer exist. Choose the fields again.', {
      unknown: selection.unknown,
    })
  }
  const fieldIds = selection.fieldIds
  if (!fieldIds.length) throw new TransferEngineError('invalid', 400, 'Choose at least one field to export.')
  const options = readOptionsFor(input)
  const hooks = transferRecordsHooks(resource)

  // Counted before the first byte: by the resource, or by reading ahead.
  const buffered: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  let exhausted = false
  let rows: number | null = null
  if (hooks.count) {
    const { pageSize: _pageSize, ...countOptions } = options
    rows = Math.max(0, Math.floor(Number(await hooks.count(ctx, countOptions)) || 0))
  } else {
    while (buffered.length < TRANSFER_EXPORT_PREFETCH_ROWS) {
      const page = await hooks.readPage(ctx, cursor, fieldIds, options)
      buffered.push(...page.rows)
      cursor = page.next
      if (!cursor) {
        exhausted = true
        break
      }
    }
    if (exhausted) rows = buffered.length
  }

  const encoder = new TextEncoder()
  // A preset's column names (another product's layout) stand in for labels.
  const headers = transferExportHeaders(fieldIds, input.headers)
  const label = (fieldId: string) => headers[fieldId] ?? catalog.byId.get(fieldId)?.label ?? fieldId
  let written = 0
  const write = (batch: ReadonlyArray<Readonly<Record<string, unknown>>>): string => {
    let text = ''
    for (const row of batch) {
      if (format === 'csv') text += `\r\n${transferExportCsvLine(row, fieldIds)}`
      else {
        const json = JSON.stringify(transferExportRecord(row, fieldIds))
        text += format === 'ndjson' ? `${json}\n` : `${written ? ',' : ''}\n${json}`
      }
      written += 1
    }
    return text
  }
  let phase: 'head' | 'buffered' | 'pages' | 'tail' = 'head'
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (phase === 'head') {
          phase = 'buffered'
          const head =
            format === 'csv'
              ? `${input.bom ? '﻿' : ''}${transferExportCsvHeader(fieldIds, label)}`
              : format === 'json'
                ? '['
                : ''
          if (head) {
            controller.enqueue(encoder.encode(head))
            return
          }
        }
        if (phase === 'buffered') {
          phase = exhausted ? 'tail' : 'pages'
          if (buffered.length) {
            controller.enqueue(encoder.encode(write(buffered)))
            buffered.length = 0
            return
          }
        }
        if (phase === 'pages') {
          const page = await hooks.readPage(ctx, cursor, fieldIds, options)
          cursor = page.next
          if (!cursor) phase = 'tail'
          if (page.rows.length) {
            controller.enqueue(encoder.encode(write(page.rows)))
            return
          }
          if (phase === 'pages') return
        }
        controller.enqueue(encoder.encode(format === 'csv' ? '\r\n' : format === 'json' ? '\n]\n' : ''))
        controller.close()
      } catch (error) {
        // Erroring the stream fails the download rather than completing it
        // short: a half-written file the browser reports as failed.
        controller.error(error)
      }
    },
  })

  return {
    stream,
    rows,
    fileName: transferExportFileName(resource.key, format, new Date((deps.now ?? Date.now)())),
    contentType: transferContentType(format),
    fieldIds,
    label: resource.label,
  }
}

/** A person's remembered choices for one resource, as far as they can be trusted. */
export async function readTransferPrefs(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  resource: string,
): Promise<TransferPrefs> {
  const key = String(resource ?? '').trim()
  if (!uid || !key || key.includes('/')) return { presets: [] }
  const snapshot = await firestore.collection('users').doc(uid).collection(TRANSFER_PREFS_COLLECTION).doc(key).get()
  return normalizeTransferPrefs(snapshot.exists ? snapshot.data() : null)
}
