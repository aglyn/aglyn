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
 * THE IMPORT ANALYSIS (AGL-3524): `POST /api/transfer/analyze`.
 *
 * Reads the stored file and proposes a mapping: every column against the
 * resource's fields and aliases, the first rows as samples, and each mapped
 * picklist column's values against the workspace's list with a proposed
 * choice for every value it does not hold. Sending `mapping` re-reads the
 * picklist values under the person's mapping. Writes no record. Body:
 * `TransferAnalyzeRequest`; answer: `TransferAnalyzeResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import type { TransferAnalyzeResponse } from '@aglyn/aglyn/data-transfer'
import { analyzeTransferJob } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { transferErrorResponse, transferGate } from '../../../../utils/server/transfer-gate'

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'analyze')
  if (caller instanceof Response) return caller
  const { body } = caller
  try {
    const mapping = body['mapping'] && typeof body['mapping'] === 'object'
      ? (body['mapping'] as Record<number, string | null>)
      : undefined
    const result = await analyzeTransferJob(caller.deps, {
      orgId: caller.orgId,
      jobId: String(body['jobId'] ?? ''),
      actorUid: caller.uid,
      mapping,
    })
    const answer: TransferAnalyzeResponse = { ok: true, ...result }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'analyze')
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export { handler as POST }
