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
 * THE FIELD-SELECTABLE EXPORT (AGL-3525): `POST /api/transfer/export`.
 *
 * The chosen fields of the chosen records — the selection, the list's
 * filter, or every record — in the person's order, streamed as CSV (with an
 * optional byte-order mark), JSON or NDJSON through the resource's own
 * `readPage`. The row count rides in `X-Aglyn-Export-Rows` whenever it could
 * be counted before the first byte, for the client's shortfall check.
 *
 * Behind the transfer gate (`data.manage`, on the site for a site's
 * records), and scoped the way the CRM's export is: an org-wide member
 * reads everything, a collaborator scoped to some sites must reach the site
 * and is read through their own scope tokens — the Admin SDK passes the
 * rules, so the tokens ARE the enforcement. Audited as
 * `data.transfer.export` with counts, never content. Body:
 * `TransferExportRequest`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import {
  TRANSFER_EXPORT_ROWS_HEADER,
  type TransferExportScope,
  type TransferFormat,
} from '@aglyn/aglyn/data-transfer'
import {
  MAX_SCOPE_HOSTS,
  hostScopeToken,
  isOrgWideMember,
  memberCanSee,
  memberScopeTokens,
} from '@aglyn/aglyn/server'
import { streamTransferExport } from '@aglyn/tenant-data-admin/server/transfer-export'
import {
  auditTransferExport,
  transferErrorResponse,
  transferGate,
  transferRefusal,
} from '../../../../utils/server/transfer-gate'

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'export')
  if (caller instanceof Response) return caller
  const { body, member } = caller
  const hostId = typeof body['hostId'] === 'string' && body['hostId'].trim() ? body['hostId'].trim() : null

  // A collaborator reads only the sites they reach, and only through their own tokens.
  let scopeTokens: string[] | undefined
  if (!caller.staff && !isOrgWideMember(member)) {
    if (hostId && !memberCanSee(member, [hostScopeToken(hostId)])) return transferRefusal(404, 'notFound', 'No such site')
    scopeTokens = memberScopeTokens(member).slice(0, MAX_SCOPE_HOSTS)
    if (!scopeTokens.length) return transferRefusal(404, 'notFound', 'Nothing to export')
  }

  try {
    const scope = (body['scope'] && typeof body['scope'] === 'object' ? body['scope'] : {}) as TransferExportScope
    const file = await streamTransferExport(caller.deps, {
      orgId: caller.orgId,
      actorUid: caller.uid,
      resource: String(body['resource'] ?? ''),
      hostId,
      fieldIds: Array.isArray(body['fieldIds']) ? (body['fieldIds'] as string[]) : [],
      scope,
      format: String(body['format'] ?? 'csv') as TransferFormat,
      bom: body['bom'] === true,
      ...(body['headers'] && typeof body['headers'] === 'object' && !Array.isArray(body['headers'])
        ? { headers: body['headers'] as Record<string, string> }
        : {}),
      ...(scopeTokens ? { scopeTokens } : {}),
    })
    await auditTransferExport(caller, {
      resource: String(body['resource'] ?? ''),
      hostId,
      fields: file.fieldIds.length,
      scope: scope.kind,
      ...(scope.kind === 'selection' ? { selected: scope.ids.length } : {}),
      format: body['format'] ?? 'csv',
      rows: file.rows,
    }).catch((error: unknown) => console.error('[transfer/export] audit failed', error))
    return new Response(file.stream, {
      status: 200,
      headers: {
        'Content-Type': `${file.contentType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${file.fileName.replace(/["\\]/g, '')}"`,
        'Cache-Control': 'no-store',
        ...(file.rows === null ? {} : { [TRANSFER_EXPORT_ROWS_HEADER]: String(file.rows) }),
      },
    })
  } catch (error) {
    return transferErrorResponse(error, 'export')
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export { handler as POST }
