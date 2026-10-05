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
 * THE IMPORT UPLOAD (AGL-3524): `POST /api/transfer/upload`.
 *
 * Stores a file to import — whole, or one part of a file sent in parts —
 * and makes the job (`draft`) on the first part. Each part, and then the
 * whole file, passes the upload structure check before it is stored, and
 * the file is counted against the resource's row and size limits. Body:
 * `TransferUploadRequest`; answer: `TransferUploadResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import type { TransferFormat, TransferUploadResponse } from '@aglyn/aglyn/data-transfer'
import { uploadTransferSource } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { transferErrorResponse, transferGate } from '../../../../utils/server/transfer-gate'

const optionalNumber = (value: unknown): number | undefined =>
  value === undefined || value === null ? undefined : Number(value)

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'upload')
  if (caller instanceof Response) return caller
  const { body } = caller
  try {
    const result = await uploadTransferSource(caller.deps, {
      orgId: caller.orgId,
      actorUid: caller.uid,
      resource: String(body['resource'] ?? ''),
      hostId: typeof body['hostId'] === 'string' ? body['hostId'] : null,
      fileName: String(body['fileName'] ?? ''),
      format: typeof body['format'] === 'string' ? (body['format'] as TransferFormat) : undefined,
      content: typeof body['content'] === 'string' ? body['content'] : '',
      part: optionalNumber(body['part']),
      parts: optionalNumber(body['parts']),
      jobId: typeof body['jobId'] === 'string' && body['jobId'] ? body['jobId'] : undefined,
    })
    const answer: TransferUploadResponse = { ok: true, ...result }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'upload')
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export { handler as POST }
