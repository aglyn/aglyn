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
 * UNDOING AN IMPORT (AGL-3524): `POST /api/transfer/undo`.
 *
 * Open for seven days after an import is applied, in two calls.
 * `action: 'plan'` reads every record the import touched and says what undo
 * would do — restore, delete, or nothing — and lists each record edited
 * since as a conflict, with what it holds now and what undo would put back;
 * it writes nothing. `action: 'apply'` carries undo out with the person's
 * decision for each conflict (`otherwise` for a record edited after the plan
 * was read), chunk by chunk; called again until `done`. Audited when it
 * starts. Body: `TransferUndoPlanRequest` or `TransferUndoApplyRequest`;
 * answer: `TransferUndoPlanResponse` or `TransferUndoApplyResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import type {
  TransferUndoApplyResponse,
  TransferUndoDecision,
  TransferUndoPlanResponse,
} from '@aglyn/aglyn/data-transfer'
import { applyTransferJobUndo, planTransferJobUndo } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import {
  auditTransfer,
  transferErrorResponse,
  transferGate,
  transferRefusal,
} from '../../../../utils/server/transfer-gate'

/** How long one request reverts before it answers with its progress. */
const UNDO_BUDGET_MS = 45_000

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'undo')
  if (caller instanceof Response) return caller
  const { body } = caller
  const jobId = String(body['jobId'] ?? '')
  try {
    if (body['action'] === 'plan') {
      const plan = await planTransferJobUndo(caller.deps, {
        orgId: caller.orgId,
        jobId,
        actorUid: caller.uid,
        offset: Number(body['offset'] ?? 0),
        limit: Number(body['limit'] ?? 50),
      })
      const answer: TransferUndoPlanResponse = { ok: true, ...plan }
      return Response.json(answer, { status: 200 })
    }
    if (body['action'] !== 'apply') return transferRefusal(400, 'invalid', 'Unknown action')
    const result = await applyTransferJobUndo(caller.deps, {
      orgId: caller.orgId,
      jobId,
      actorUid: caller.uid,
      decisions:
        body['decisions'] && typeof body['decisions'] === 'object'
          ? (body['decisions'] as Record<string, TransferUndoDecision>)
          : undefined,
      otherwise: body['otherwise'] as TransferUndoDecision,
      deadlineMs: caller.startedAt + UNDO_BUDGET_MS,
      driver: caller.driver,
    })
    if (result.started) {
      await auditTransfer(caller, 'data.transfer.undo', jobId, {
        resource: result.job.resource,
        fileName: result.job.fileName ?? null,
        otherwise: result.undo.otherwise,
        decisions: Object.keys((body['decisions'] as object) ?? {}).length,
      })
    }
    const answer: TransferUndoApplyResponse = { ok: true, job: result.job, undo: result.undo, done: result.done }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'undo')
  }
}

export const dynamic = 'force-dynamic'
/** `UNDO_BUDGET_MS` stops starting chunks; this is the ceiling past it. */
export const maxDuration = 60
export { handler as POST }
