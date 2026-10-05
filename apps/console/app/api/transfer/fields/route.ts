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
 * WHAT A RESOURCE OFFERS (AGL-3539): `POST /api/transfer/fields`.
 *
 * The descriptor, every field and group, the match keys, the presets'
 * hints, the locked rules and the aliases — what the import wizard and the
 * export dialog open with — and the person's remembered choices
 * (`users/{uid}/transferPrefs/{resourceKey}`). Body:
 * `TransferFieldsRequest`; answer: `TransferFieldsResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import type { TransferFieldsResponse } from '@aglyn/aglyn/data-transfer'
import { readTransferPrefs } from '@aglyn/tenant-data-admin/server/transfer-export'
import { readTransferResourceInfo } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { transferErrorResponse, transferGate } from '../../../../utils/server/transfer-gate'

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'fields')
  if (caller instanceof Response) return caller
  const { body } = caller
  try {
    const info = await readTransferResourceInfo(caller.deps, {
      orgId: caller.orgId,
      actorUid: caller.uid,
      resource: String(body['resource'] ?? ''),
      hostId: typeof body['hostId'] === 'string' ? body['hostId'] : null,
      filter: body['filter'],
    })
    const prefs = await readTransferPrefs(caller.deps.firestore, caller.uid, info.resource.key)
    const answer: TransferFieldsResponse = { ok: true, ...info, prefs }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'fields')
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export { handler as POST }
