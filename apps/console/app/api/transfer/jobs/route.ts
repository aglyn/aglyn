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
 * THE WORKSPACE'S IMPORTS (AGL-3535): `POST /api/transfer/jobs`.
 *
 * Every import the workspace ran — rows and packages — newest first, a page
 * at a time, for the Import & export hub's history: what, who, when, the
 * counts, and whether its result file and its undo are still open. With
 * `sitePackages`, each site's own package imports too (AGL-3533's ledger,
 * `hosts/{hostId}/packageImports`, which no client may read), so an import
 * stays undoable from here after its backup card is closed. A route
 * rather than a client query, because what the hub shows is more than the
 * job document (undo's window, whether the file was cleared) and the people
 * behind each job are read from Auth. Body: `TransferJobsRequest`; answer:
 * `TransferJobsResponse`.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import {
  TRANSFER_PACKAGE_RESOURCE,
  TRANSFER_SITE_PACKAGE_IMPORTS_PER_SITE,
  type TransferJobsResponse,
  type TransferSitePackageImportSummary,
} from '@aglyn/aglyn/data-transfer'
import { listDeclaredTransferResources } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { listTransferJobs } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { transferErrorResponse, transferGate, type TransferCaller } from '../../../../utils/server/transfer-gate'
import {
  PACKAGE_IMPORTS_COLLECTION,
  PACKAGE_UNDO_WINDOW_MS,
  packageImportUndoable,
  type PackageImportRecord,
} from '../../_lib/site-package-ledger'

/** Auth answers at most this many accounts per call. */
const AUTH_LOOKUP_MAX = 100

/** Each member's sign-in address, by uid; an account that is gone is left out. */
async function emailsOf(uids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>()
  for (let at = 0; at < uids.length; at += AUTH_LOOKUP_MAX) {
    const { users } = await firebaseAdmin
      .app()
      .auth()
      .getUsers(uids.slice(at, at + AUTH_LOOKUP_MAX).map((uid) => ({ uid })))
    for (const user of users) if (user.email) found.set(user.uid, user.email)
  }
  return found
}

/** Each of the workspace's sites' latest package imports, newest first. */
async function sitePackageImports(caller: TransferCaller): Promise<TransferSitePackageImportSummary[]> {
  const firestore = caller.deps.firestore
  const hosts = await firestore.collection('hosts').where('orgId', '==', caller.orgId).get()
  const now = Date.now()
  const found: TransferSitePackageImportSummary[] = []
  for (const host of hosts.docs) {
    const imports = await host.ref
      .collection(PACKAGE_IMPORTS_COLLECTION)
      .orderBy('startedAtMs', 'desc')
      .limit(TRANSFER_SITE_PACKAGE_IMPORTS_PER_SITE)
      .get()
    for (const doc of imports.docs) {
      const record = doc.data() as PackageImportRecord
      const hostName = String(host.get('name') ?? '').trim()
      found.push({
        hostId: host.id,
        hostName: hostName || null,
        importId: doc.id,
        status: record.status,
        actorEmail: record.actorEmail ?? null,
        source: record.source ?? null,
        startedAt: record.startedAtMs,
        appliedAt: record.appliedAtMs ?? null,
        undoneAt: record.undoneAtMs ?? null,
        counts: record.counts ?? {},
        items: record.items?.length ?? 0,
        undo: {
          available: packageImportUndoable(record, now),
          expiresAt: typeof record.appliedAtMs === 'number' ? record.appliedAtMs + PACKAGE_UNDO_WINDOW_MS : null,
        },
        error: record.error ?? null,
      })
    }
  }
  return found.sort((a, b) => b.startedAt - a.startedAt)
}

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'jobs')
  if (caller instanceof Response) return caller
  const { body } = caller
  try {
    const labels: Record<string, string> = { [TRANSFER_PACKAGE_RESOURCE]: 'Package' }
    for (const one of listDeclaredTransferResources()) labels[one.key] = one.label
    const page = await listTransferJobs(caller.deps, {
      orgId: caller.orgId,
      limit: Number(body['limit'] ?? 20),
      after: typeof body['after'] === 'number' ? body['after'] : null,
      labels,
      emailsOf,
    })
    const answer: TransferJobsResponse = {
      ok: true,
      ...page,
      ...(body['sitePackages'] === true && body['after'] == null ? { sitePackageImports: await sitePackageImports(caller) } : {}),
    }
    return Response.json(answer, { status: 200 })
  } catch (error) {
    return transferErrorResponse(error, 'jobs')
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export { handler as POST }
