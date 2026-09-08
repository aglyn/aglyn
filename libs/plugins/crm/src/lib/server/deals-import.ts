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

/**
 * `POST /api/crm/deals-import` — one chunk of a deals file, written
 * (AGL-2662).
 *
 * The browser has already read the file and applied the operator's column
 * mapping; what arrives here is up to {@link DEAL_IMPORT_CHUNK_SIZE} raw
 * rows in the vocabulary `crm-deal-import.ts` defines. This route judges
 * each one through the same normalizer, resolves the two names a deal is
 * filed under, and writes it with the stamp every CRM creator writes.
 *
 * ## The pipeline and the stage are looked up ONCE per request
 *
 * The org's pipelines are read once — the active ones the caller's scope
 * can see — and every row resolves against that list by name. A row
 * naming no pipeline lands in the default one (or the only one); a row
 * naming no stage lands in its pipeline's first open stage. A name that
 * matches nothing refuses the row by name, before any write, so the
 * operator's skipped file says exactly which cell to fix.
 *
 * ## A deal's status is its stage's kind
 *
 * Landing in a `won` or `lost` stage closes the deal on creation, stamped
 * with the same clock as `stageChangedAtMs`, the way the REST create does.
 * No `dealWon` event fires for an imported win: the deal was won before it
 * was filed here, and an automation on the event is for what happens next.
 *
 * ## The band is counted once per request
 *
 * A deal is a CRM record and meets the records band (AGL-2611), judged
 * the way the companies import judges it: one aggregate at the first
 * create, re-judged locally as the request creates more.
 */

import {
  checkCrmRecordsQuota,
  CRM_COLLECTIONS,
  type CrmDealStage,
  type CrmPipeline,
  DEAL_IMPORT_CHUNK_SIZE,
  DEAL_IMPORT_MAX_BODY_BYTES,
  type DealImportChunkResult,
  type DealImportRawRow,
  type DealImportRow,
  type DealImportSkippedRow,
  dealImportNameKey,
  isPipelineArchived,
  nameSearchKey,
  normalizeDealImportRow,
  type PluginApiHandler,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import { crmRecordsQuotaForOrg, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type ImportContext,
  ownerDirectory,
  readImportRows,
  resolveImportContext,
} from './import-context'

/** The default currency a deal carries when the file names none. */
const DEFAULT_CURRENCY = 'usd'

/** One pipeline the request can file into, with its stages by name. */
interface PipelineChoice {
  id: string
  pipeline: CrmPipeline
  stages: CrmDealStage[]
}

/** The active pipelines the caller's scope can see, in read order. */
async function readPipelines(
  orgRef: FirebaseFirestore.DocumentReference,
  readTokens: readonly string[],
): Promise<PipelineChoice[]> {
  const snapshot = await orgRef.collection(CRM_COLLECTIONS.pipelines).get()
  const choices: PipelineChoice[] = []
  for (const doc of snapshot.docs) {
    const pipeline = doc.data() as CrmPipeline
    if (isPipelineArchived(pipeline)) continue
    if (!visibleToTokens(pipeline.visibleTo, readTokens)) continue
    const stages = [...(pipeline.stages ?? [])].sort((a, b) => a.order - b.order)
    choices.push({ id: doc.id, pipeline, stages })
  }
  return choices
}

/**
 * Where one row lands: its pipeline and its stage, or which of the two
 * names the org does not have.
 */
export function placeDealImportRow(
  choices: readonly PipelineChoice[],
  row: Pick<DealImportRow, 'pipeline' | 'stage'>,
):
  | { ok: true; pipeline: PipelineChoice; stage: CrmDealStage }
  | { ok: false; reason: 'unknown-pipeline' | 'unknown-stage' } {
  let pipeline: PipelineChoice | undefined
  if (row.pipeline) {
    const wanted = dealImportNameKey(row.pipeline)
    pipeline = choices.find((choice) => dealImportNameKey(choice.pipeline.name ?? '') === wanted)
  } else {
    pipeline = choices.find((choice) => choice.pipeline.isDefault) ?? (choices.length === 1 ? choices[0] : undefined)
  }
  if (!pipeline) return { ok: false, reason: 'unknown-pipeline' }
  let stage: CrmDealStage | undefined
  if (row.stage) {
    const wanted = dealImportNameKey(row.stage)
    stage = pipeline.stages.find((candidate) => dealImportNameKey(candidate.name ?? '') === wanted)
  } else {
    stage = pipeline.stages.find((candidate) => candidate.kind === 'open') ?? pipeline.stages[0]
  }
  if (!stage) return { ok: false, reason: 'unknown-stage' }
  return { ok: true, pipeline, stage }
}

/**
 * `POST crm/deals-import` — `{ hostId, rows }` → a {@link DealImportChunkResult}.
 *
 * Rows are written one after another so the band's local count stays
 * honest across the request.
 */
export const crmDealsImportHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const read = readImportRows<DealImportRawRow>(req, {
    maxBodyBytes: DEAL_IMPORT_MAX_BODY_BYTES,
    chunkSize: DEAL_IMPORT_CHUNK_SIZE,
  })
  if ('error' in read) return res.status(read.status).json({ error: read.error })
  try {
    const context = await resolveImportContext(req)
    if (context.ok === false) return res.status(context.status).json(context.body)

    const skipped: DealImportSkippedRow[] = []
    const dropped: Record<string, number> = {}
    const normalized: { index: number; row: DealImportRow }[] = []
    read.rows.forEach((raw, index) => {
      const verdict = normalizeDealImportRow(raw)
      if (verdict.ok === false) {
        skipped.push({ index, title: verdict.input, reason: verdict.reason })
        return
      }
      for (const entry of verdict.row.dropped) {
        dropped[entry.field] = (dropped[entry.field] ?? 0) + 1
      }
      normalized.push({ index, row: verdict.row })
    })

    const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(context.orgId)
    const [owners, pipelines] = await Promise.all([
      ownerDirectory(
        context.orgId,
        normalized.map((entry) => entry.row),
      ),
      normalized.length ? readPipelines(orgRef, context.readTokens) : Promise.resolve([]),
    ])
    const ownersUnresolved = new Set<string>()
    const deals = orgRef.collection(CRM_COLLECTIONS.deals)
    const stamp = creationStamp(context)
    let counted: { crmRecordsCount: number } | null = null
    let createdHere = 0
    let created = 0

    for (const { index, row } of normalized) {
      const placed = placeDealImportRow(pipelines, row)
      if (placed.ok === false) {
        skipped.push({ index, title: row.title, reason: placed.reason })
        continue
      }
      let ownerUid: string | undefined
      if (row.ownerEmail) {
        ownerUid = owners.get(row.ownerEmail)
        if (!ownerUid) ownersUnresolved.add(row.ownerEmail)
      }
      if (!counted) counted = await crmRecordsQuotaForOrg(context.org as never, orgRef)
      const room = checkCrmRecordsQuota(
        context.org as never,
        counted.crmRecordsCount + createdHere,
      )
      if (!room.allowed) {
        skipped.push({ index, title: row.title, reason: 'records-band' })
        continue
      }
      const nowMs = Date.now()
      const { stage } = placed
      const status = stage.kind === 'won' ? 'won' : stage.kind === 'lost' ? 'lost' : 'open'
      await deals.add({
        title: row.title,
        titleLower: nameSearchKey(row.title),
        pipelineId: placed.pipeline.id,
        stageId: stage.id,
        status,
        stageChangedAtMs: nowMs,
        closedAtMs: status === 'open' ? null : nowMs,
        currency: row.currency ?? DEFAULT_CURRENCY,
        ...(typeof row.amountCents === 'number' ? { amountCents: row.amountCents } : {}),
        ...(ownerUid ? { ownerUid } : {}),
        ...(typeof row.expectedCloseAtMs === 'number'
          ? { expectedCloseAtMs: row.expectedCloseAtMs }
          : {}),
        ...(row.notes ? { notes: row.notes } : {}),
        ...stamp,
      })
      createdHere += 1
      created += 1
    }

    const result: DealImportChunkResult = {
      received: read.rows.length,
      created,
      merged: 0,
      skipped: skipped.sort((a, b) => a.index - b.index),
      dropped,
      ownersUnresolved: [...ownersUnresolved],
    }
    return res.status(200).json(result)
  } catch (error) {
    console.error('crm/deals-import failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}

/** The scope, the site, the importer and the clocks every created deal carries. */
function creationStamp(
  context: Extract<ImportContext, { ok: true }>,
): Record<string, unknown> {
  return {
    hostId: context.hostId,
    visibleTo: context.scopeTokens,
    createdByUid: context.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
