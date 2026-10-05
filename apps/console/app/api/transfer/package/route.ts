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
 * WORKSPACE PACKAGES (AGL-3535): `POST /api/transfer/package`.
 *
 * A workspace's sequences, campaigns, automations and email templates as
 * one `aglyn-package` file, each item owned by the plugin whose `package`
 * transfer resource its kind names. Only the resources of plugins the
 * workspace runs, and that its plan carries (AGL-3555: no CRM email
 * templates on Free), are offered. One body, five actions:
 *
 *  - `list` — each resource and its items, with what each names (read);
 *  - `export` — the file, the chosen items and, when asked, what they need
 *    (read; audited as `data.transfer.export`, counts only);
 *  - `plan` — the dry run; the first call carries the file and makes the
 *    job, later calls carry the person's choices (audited);
 *  - `apply` — write it, called until `done` (audited when it starts);
 *  - `undoPlan` / `undo` — for seven days (undo audited when it starts).
 *
 * The engine is `@aglyn/tenant-data-admin/server/transfer-packages`; the
 * gate, the job, the ledger and the lease are the row engine's.
 */

// lockdown-423: via apps/console/utils/server/transfer-gate.ts

import {
  transferExportFileName,
  type PackageItemDecision,
  type TransferPackageApplyResponse,
  type TransferPackageDependencyChoice,
  type TransferPackageExportResponse,
  type TransferPackageListResponse,
  type TransferPackagePlanResponse,
  type TransferPackageUndoPlanResponse,
  type TransferPackageUndoResponse,
  type TransferPackageWarningClass,
  type TransferUndoDecision,
} from '@aglyn/aglyn/data-transfer'
import { listTransferResourcesFor, transferPlanRefusal } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin'
import {
  applyTransferPackage,
  applyTransferPackageUndo,
  exportTransferPackage,
  listTransferPackageItems,
  planTransferPackageImport,
  planTransferPackageUndo,
} from '@aglyn/tenant-data-admin/server/transfer-packages'
import {
  auditTransfer,
  auditTransferExport,
  transferErrorResponse,
  transferGate,
  transferRefusal,
} from '../../../../utils/server/transfer-gate'

/** How long one request writes before it answers. */
const APPLY_BUDGET_MS = 45_000

const READ_ACTIONS = new Set(['list', 'export'])

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined

const record = <T,>(value: unknown): Record<string, T> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : undefined

async function handler(request: Request): Promise<Response> {
  const caller = await transferGate(request, 'package', {
    readsOnly: (body) => READ_ACTIONS.has(String(body['action'] ?? '')),
  })
  if (caller instanceof Response) return caller
  const { body } = caller
  const action = String(body['action'] ?? '')
  const jobId = String(body['jobId'] ?? '')
  // The workspace's own plugins decide what it can move — switched on and
  // released to it (AGL-3548), as the plugin dispatcher asks — and its
  // plan: a resource its plan does not carry is not in its packages (AGL-3555).
  const intent = READ_ACTIONS.has(action) ? 'export' : 'import'
  const packages = listTransferResourcesFor({ scope: 'org', org: caller.org as { enabledPlugins?: string[] } }).filter(
    (one) => one.kinds.includes('package'),
  )
  const released = new Set(
    await filterEnabledPluginsByReleaseFlags([...new Set(packages.map((one) => one.pluginId))], {
      orgId: caller.orgId,
      authorization: request.headers.get('authorization'),
    }),
  )
  const allowed: string[] = []
  for (const one of packages) {
    if (!released.has(one.pluginId)) continue
    const refused = await transferPlanRefusal({ resource: one.key, orgId: caller.orgId, hostId: null, org: caller.org }, intent)
    if (!refused) allowed.push(one.key)
  }
  const base = { orgId: caller.orgId, actorUid: caller.uid, allowed }
  try {
    if (action === 'list') {
      const resources = await listTransferPackageItems(caller.deps, { ...base, resources: strings(body['resources']) })
      const answer: TransferPackageListResponse = { ok: true, resources }
      return Response.json(answer, { status: 200 })
    }
    if (action === 'export') {
      const name = String(caller.org['name'] ?? '').trim()
      const file = await exportTransferPackage(caller.deps, {
        ...base,
        items: strings(body['items']),
        resources: strings(body['resources']),
        dependencies: body['dependencies'] === true,
        ...(name ? { source: `Workspace: ${name}` } : {}),
      })
      await auditTransferExport(caller, {
        resource: 'package',
        format: 'json',
        items: file.manifest.items.length,
        kinds: [...new Set(file.manifest.items.map((item) => item.kind))],
      })
      const answer: TransferPackageExportResponse = {
        ok: true,
        fileName: transferExportFileName('package', 'json', new Date()),
        package: file,
      }
      return Response.json(answer, { status: 200 })
    }
    if (action === 'plan') {
      const outcome = await planTransferPackageImport(caller.deps, {
        ...base,
        jobId: jobId || null,
        package: body['package'],
        fileName: typeof body['fileName'] === 'string' ? body['fileName'] : null,
        decisions: record<PackageItemDecision>(body['decisions']),
        dependencyChoices: record<TransferPackageDependencyChoice>(body['dependencyChoices']),
      })
      await auditTransfer(caller, 'data.transfer.plan', outcome.job.id, {
        resource: 'package',
        fileName: outcome.job.fileName ?? null,
        summary: outcome.plan.summary,
        unknownKinds: outcome.plan.unknownKinds,
      })
      const { plan } = outcome
      const answer: TransferPackagePlanResponse = {
        ok: true,
        job: outcome.job,
        items: plan.items,
        references: plan.references,
        unknownKinds: plan.unknownKinds,
        summary: plan.summary,
        blocking: plan.blocking,
        acknowledgementsRequired: plan.acknowledgementsRequired,
        resources: outcome.resources,
      }
      return Response.json(answer, { status: 200 })
    }
    if (action === 'apply') {
      const result = await applyTransferPackage(caller.deps, {
        orgId: caller.orgId,
        jobId,
        actorUid: caller.uid,
        acknowledged: strings(body['acknowledged']) as TransferPackageWarningClass[] | undefined,
        deadlineMs: caller.startedAt + APPLY_BUDGET_MS,
        driver: caller.driver,
      })
      if (result.started) {
        await auditTransfer(caller, 'data.transfer.apply', jobId, {
          resource: 'package',
          fileName: result.job.fileName ?? null,
          summary: result.job.package?.summary ?? null,
          acknowledged: result.job.package?.acknowledged ?? [],
          resumed: result.resumed,
        })
      }
      const answer: TransferPackageApplyResponse = { ok: true, job: result.job, done: result.done, results: result.results }
      return Response.json(answer, { status: 200 })
    }
    if (action === 'undoPlan') {
      const plan = await planTransferPackageUndo(caller.deps, { orgId: caller.orgId, jobId, actorUid: caller.uid })
      const answer: TransferPackageUndoPlanResponse = { ok: true, ...plan }
      return Response.json(answer, { status: 200 })
    }
    if (action === 'undo') {
      const result = await applyTransferPackageUndo(caller.deps, {
        orgId: caller.orgId,
        jobId,
        actorUid: caller.uid,
        decisions: record<TransferUndoDecision>(body['decisions']),
        otherwise: body['otherwise'] as TransferUndoDecision,
        deadlineMs: caller.startedAt + APPLY_BUDGET_MS,
        driver: caller.driver,
      })
      if (result.started) {
        await auditTransfer(caller, 'data.transfer.undo', jobId, {
          resource: 'package',
          fileName: result.job.fileName ?? null,
          otherwise: result.undo.otherwise,
          decisions: Object.keys(record(body['decisions']) ?? {}).length,
        })
      }
      const answer: TransferPackageUndoResponse = { ok: true, job: result.job, undo: result.undo, done: result.done }
      return Response.json(answer, { status: 200 })
    }
    return transferRefusal(400, 'invalid', 'Unknown action')
  } catch (error) {
    return transferErrorResponse(error, 'package')
  }
}

export const dynamic = 'force-dynamic'
/** `APPLY_BUDGET_MS` stops starting writes; this is the ceiling past it. */
export const maxDuration = 60
export { handler as POST }
