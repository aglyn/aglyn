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
 * APPLYING AN IMPORT (AGL-3524): `POST /api/transfer/apply`.
 *
 * Writes the stored dry run chunk by chunk, through the resource's own write
 * paths, until this request's budget is spent; the wizard calls again until
 * `done`, and the cron sweep (`/api/admin/transfer-jobs`) resumes a job
 * whose tab closed. The first call needs every warning class the dry run
 * requires acknowledged; a second import of the same records waits for the
 * first. A retried chunk never writes a row twice. Audited when the job
 * starts or resumes. Body: `TransferApplyRequest`; answer:
 * `TransferApplyResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import type { TransferApplyResponse, TransferWarningClass } from '@aglyn/aglyn/data-transfer'
import { applyTransferJob } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { auditTransfer, transferErrorResponse, transferGate } from '../../../../utils/server/transfer-gate'

/** How long one request writes before it answers with its progress. */
const APPLY_BUDGET_MS = 45_000

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'apply')
  if (caller instanceof Response) return caller
  const { body } = caller
  const jobId = String(body['jobId'] ?? '')
  try {
    const result = await applyTransferJob(caller.deps, {
      orgId: caller.orgId,
      jobId,
      actorUid: caller.uid,
      acknowledged: Array.isArray(body['acknowledged']) ? (body['acknowledged'] as TransferWarningClass[]) : undefined,
      deadlineMs: caller.startedAt + APPLY_BUDGET_MS,
      driver: caller.driver,
    })
    if (result.started) {
      await auditTransfer(caller, 'data.transfer.apply', jobId, {
        resource: result.job.resource,
        fileName: result.job.fileName ?? null,
        summary: result.job.summary ?? null,
        acknowledged: result.job.acknowledged ?? [],
        resumed: result.resumed,
      })
    }
    const answer: TransferApplyResponse = { ok: true, job: result.job, progress: result.progress, done: result.done }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'apply')
  }
}

export const dynamic = 'force-dynamic'
/** `APPLY_BUDGET_MS` stops starting chunks; this is the ceiling past it. */
export const maxDuration = 60
export { handler as POST }
