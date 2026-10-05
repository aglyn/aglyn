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
 * THE DRY RUN (AGL-3524): `POST /api/transfer/plan`.
 *
 * With the person's mapping, picklist choices, match keys and policy, plans
 * every row of the file — create, update, unchanged, skip or fail, with the
 * field-by-field diff and every warning — and stores it for Apply. No record
 * is written. `action: 'rows'` pages the stored plan instead. Audited.
 * Body: `TransferPlanRequest` or `TransferPlanRowsRequest`; answer:
 * `TransferPlanResponse` or `TransferPlanRowsResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import type {
  TransferPlanChoices,
  TransferPlanResponse,
  TransferPlanRowsResponse,
  TransferRowVerdict,
} from '@aglyn/aglyn/data-transfer'
import { planTransferJob, readTransferPlanRows } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { auditTransfer, transferErrorResponse, transferGate } from '../../../../utils/server/transfer-gate'

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'plan')
  if (caller instanceof Response) return caller
  const { body } = caller
  const jobId = String(body['jobId'] ?? '')
  try {
    if (body['action'] === 'rows') {
      const rows = await readTransferPlanRows(caller.deps, {
        orgId: caller.orgId,
        jobId,
        offset: Number(body['offset'] ?? 0),
        limit: Number(body['limit'] ?? 50),
        verdicts: Array.isArray(body['verdicts']) ? (body['verdicts'] as TransferRowVerdict[]) : undefined,
      })
      const answer: TransferPlanRowsResponse = { ok: true, rows }
      return Response.json(answer, { status: 200 })
    }
    const choices: TransferPlanChoices = {
      mapping: (body['mapping'] ?? {}) as TransferPlanChoices['mapping'],
      ...(Array.isArray(body['matchKeys']) ? { matchKeys: body['matchKeys'] as string[] } : {}),
      ...(body['policy'] && typeof body['policy'] === 'object' ? { policy: body['policy'] as TransferPlanChoices['policy'] } : {}),
      ...(body['picklistChoices'] && typeof body['picklistChoices'] === 'object'
        ? { picklistChoices: body['picklistChoices'] as TransferPlanChoices['picklistChoices'] }
        : {}),
      ...(body['derive'] && typeof body['derive'] === 'object' ? { derive: body['derive'] as TransferPlanChoices['derive'] } : {}),
      ...(body['dateOrders'] && typeof body['dateOrders'] === 'object'
        ? { dateOrders: body['dateOrders'] as TransferPlanChoices['dateOrders'] }
        : {}),
      ...(body['extras'] && typeof body['extras'] === 'object' ? { extras: body['extras'] as TransferPlanChoices['extras'] } : {}),
    }
    const result = await planTransferJob(caller.deps, { orgId: caller.orgId, jobId, actorUid: caller.uid, choices })
    await auditTransfer(caller, 'data.transfer.plan', jobId, {
      resource: result.job.resource,
      fileName: result.job.fileName ?? null,
      summary: result.summary,
    })
    const answer: TransferPlanResponse = { ok: true, ...result }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'plan')
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export { handler as POST }
